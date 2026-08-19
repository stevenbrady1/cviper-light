/**
 * Tests for the connection singleton and the serialised operation queue.
 *
 * `@tauri-apps/plugin-sql` is mocked throughout: there is no Tauri runtime in a
 * Vitest process, and `Database.load()` would try to open a real file under
 * `%APPDATA%`. What is asserted here is the contract with the plugin — the
 * exact URL string, the pragma, the caching behaviour — not SQLite itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isErr, isOk } from '@cviper/core-types';

import { DB_URL } from './constants';

const sql = vi.hoisted(() => {
  const execute = vi.fn<(query: string, values?: unknown[]) => Promise<{ rowsAffected: number }>>();
  const select = vi.fn<(query: string, values?: unknown[]) => Promise<unknown[]>>();
  const load = vi.fn<(url: string) => Promise<unknown>>();
  return { execute, select, load, db: { execute, select } };
});

vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: sql.load } }));

/** Fresh module registry per test: the client caches its connection forever. */
async function loadClient() {
  vi.resetModules();
  return import('./client');
}

function executedQueries(): string[] {
  return sql.execute.mock.calls.map((call) => call[0]);
}

beforeEach(() => {
  sql.execute.mockReset();
  sql.select.mockReset();
  sql.load.mockReset();

  sql.execute.mockResolvedValue({ rowsAffected: 0 });
  sql.select.mockResolvedValue([]);
  sql.load.mockResolvedValue(sql.db);
});

describe('getDb', () => {
  it('loads the database at exactly the shared DB_URL', async () => {
    const { getDb } = await loadClient();

    const result = await getDb();

    expect(isOk(result)).toBe(true);
    expect(sql.load).toHaveBeenCalledTimes(1);
    expect(sql.load).toHaveBeenCalledWith(DB_URL);
    // Not just "some sqlite url" — the plugin looks its migrations up under
    // this exact key, and a near-miss silently skips every migration.
    expect(sql.load.mock.calls[0]?.[0]).toBe('sqlite:cviper.db');
  });

  it('turns foreign key enforcement on before anything else runs', async () => {
    const { getDb } = await loadClient();

    await getDb();

    expect(executedQueries()[0]).toMatch(/PRAGMA\s+foreign_keys\s*=\s*ON/i);
  });

  it('opens the database once and reuses it', async () => {
    const { getDb } = await loadClient();

    await getDb();
    await getDb();
    await getDb();

    expect(sql.load).toHaveBeenCalledTimes(1);
    expect(executedQueries().filter((query) => /PRAGMA/i.test(query))).toHaveLength(1);
  });

  it('opens the database once when several callers race for it', async () => {
    const { getDb } = await loadClient();

    await Promise.all([getDb(), getDb(), getDb()]);

    expect(sql.load).toHaveBeenCalledTimes(1);
  });

  it('reports a failed open as an error instead of throwing', async () => {
    sql.load.mockRejectedValue(new Error('database is locked'));
    const { getDb } = await loadClient();

    const result = await getDb();

    expect(isErr(result) && result.error.code).toBe('CONNECTION_FAILED');
    expect(isErr(result) && result.error.message).toContain('database is locked');
  });

  it('does not cache a failed open, so a later attempt can succeed', async () => {
    sql.load.mockRejectedValueOnce(new Error('database is locked'));
    const { getDb } = await loadClient();

    const first = await getDb();
    const second = await getDb();

    expect(isErr(first)).toBe(true);
    expect(isOk(second)).toBe(true);
    expect(sql.load).toHaveBeenCalledTimes(2);
  });

  it('treats a failed pragma as a failed connection', async () => {
    sql.execute.mockRejectedValueOnce(new Error('disk I/O error'));
    const { getDb } = await loadClient();

    const result = await getDb();

    expect(isErr(result) && result.error.code).toBe('CONNECTION_FAILED');
  });

  it('survives a rejection that is not an Error at all', async () => {
    sql.load.mockRejectedValue('boom');
    const { getDb } = await loadClient();

    const result = await getDb();

    expect(isErr(result) && result.error.code).toBe('CONNECTION_FAILED');
    expect(isErr(result) && result.error.message).toContain('boom');
  });
});

describe('withDb', () => {
  it('hands the operation a connected database and returns its value', async () => {
    const { withDb } = await loadClient();

    const result = await withDb(async (db) => {
      await db.execute('SELECT 1');
      return 'done';
    });

    expect(isOk(result) && result.value).toBe('done');
  });

  it('runs the pragma before the operation, never after', async () => {
    const { withDb } = await loadClient();

    await withDb(async (db) => db.execute('DELETE FROM jobs'));

    expect(executedQueries()).toEqual([
      expect.stringMatching(/PRAGMA\s+foreign_keys\s*=\s*ON/i),
      'DELETE FROM jobs',
    ]);
  });

  it('never lets two operations interleave', async () => {
    const { withDb } = await loadClient();
    const order: string[] = [];

    const slow = withDb(async () => {
      order.push('slow:start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('slow:end');
    });
    const quick = withDb(async () => {
      order.push('quick:start');
      order.push('quick:end');
    });

    await Promise.all([slow, quick]);

    expect(order).toEqual(['slow:start', 'slow:end', 'quick:start', 'quick:end']);
  });

  it('keeps the queue running after an operation fails', async () => {
    const { withDb } = await loadClient();

    const failed = await withDb(async () => {
      throw new Error('no such table: jobs');
    });
    const after = await withDb(async () => 'still working');

    expect(isErr(failed)).toBe(true);
    expect(isOk(after) && after.value).toBe('still working');
  });

  it('classifies a constraint failure separately from any other query failure', async () => {
    const { withDb } = await loadClient();

    const unique = await withDb(async () => {
      throw new Error('UNIQUE constraint failed: jobs.source, jobs.external_id');
    }, 'jobs');
    const other = await withDb(async () => {
      throw new Error('no such column: salary_period');
    }, 'jobs');

    expect(isErr(unique) && unique.error.code).toBe('CONSTRAINT_VIOLATION');
    expect(isErr(unique) && unique.error.table).toBe('jobs');
    expect(isErr(other) && other.error.code).toBe('QUERY_FAILED');
  });

  it('carries the database message through verbatim so nothing is swallowed', async () => {
    const { withDb } = await loadClient();

    const result = await withDb(async () => {
      throw new Error('FOREIGN KEY constraint failed');
    }, 'applications');

    expect(isErr(result) && result.error.message).toBe('FOREIGN KEY constraint failed');
  });

  it('fails the operation when the database cannot be opened at all', async () => {
    sql.load.mockRejectedValue(new Error('no such file or directory'));
    const { withDb } = await loadClient();

    const result = await withDb(async () => 'never runs');

    expect(isErr(result) && result.error.code).toBe('CONNECTION_FAILED');
  });
});
