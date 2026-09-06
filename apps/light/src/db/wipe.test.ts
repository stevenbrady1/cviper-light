/**
 * `wipeAll` deletes every table, children first, in one transaction, then
 * compacts the file — and cannot forget a table.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isErr, isOk } from '@cviper/core-types';

const sql = vi.hoisted(() => {
  const execute = vi.fn<(query: string, values?: unknown[]) => Promise<{ rowsAffected: number }>>();
  const select = vi.fn<(query: string, values?: unknown[]) => Promise<unknown[]>>();
  const load = vi.fn<(url: string) => Promise<unknown>>();
  return { execute, select, load, db: { execute, select } };
});

vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: sql.load } }));

const PRAGMA = /^PRAGMA/i;

function statements(): string[] {
  return sql.execute.mock.calls.map((call) => call[0]).filter((query) => !PRAGMA.test(query));
}

beforeEach(() => {
  vi.resetModules();
  sql.execute.mockReset();
  sql.select.mockReset();
  sql.load.mockReset();

  sql.execute.mockResolvedValue({ rowsAffected: 1 });
  sql.select.mockResolvedValue([]);
  sql.load.mockResolvedValue(sql.db);
});

describe('WIPE_ORDER covers the whole schema', () => {
  it('names every table in TABLE_COLUMNS exactly once, children before parents', async () => {
    const { WIPE_ORDER } = await import('./wipe');
    const { TABLE_COLUMNS } = await import('./rows');

    // The anti-drift half: a table added to the schema and not to the wipe
    // makes "delete everything" false, and this is where that fails.
    expect([...WIPE_ORDER].sort()).toEqual(Object.keys(TABLE_COLUMNS).sort());
    expect(new Set(WIPE_ORDER).size).toBe(WIPE_ORDER.length);

    // Applications reference jobs; analyses reference CVs. Parents last.
    expect(WIPE_ORDER.indexOf('applications')).toBeLessThan(WIPE_ORDER.indexOf('jobs'));
    expect(WIPE_ORDER.indexOf('analyses')).toBeLessThan(WIPE_ORDER.indexOf('cvs'));
  });
});

describe('wipeAll', () => {
  it('deletes every table inside one immediate transaction, then vacuums', async () => {
    const { wipeAll, WIPE_ORDER } = await import('./wipe');

    const result = await wipeAll();
    expect(isOk(result)).toBe(true);

    expect(statements()).toEqual([
      'BEGIN IMMEDIATE;',
      ...WIPE_ORDER.map((table) => `DELETE FROM ${table};`),
      'COMMIT;',
      'VACUUM;',
    ]);
    // Nothing is read on the way out.
    expect(sql.select).not.toHaveBeenCalled();
  });

  it('rolls back and reports the original error when a delete fails', async () => {
    const { wipeAll } = await import('./wipe');

    sql.execute.mockImplementation(async (query) => {
      if (query.startsWith('DELETE FROM cvs')) throw new Error('database is locked');
      return { rowsAffected: 1 };
    });

    const result = await wipeAll();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).toContain('database is locked');

    const issued = statements();
    expect(issued).toContain('ROLLBACK;');
    expect(issued).not.toContain('COMMIT;');
    // No VACUUM after a failed wipe: compacting a database that still holds
    // the data would only rewrite the file the user was told is gone.
    expect(issued).not.toContain('VACUUM;');
  });

  it('still reports the delete error when the rollback itself fails', async () => {
    const { wipeAll } = await import('./wipe');

    sql.execute.mockImplementation(async (query) => {
      if (query.startsWith('DELETE FROM jobs')) throw new Error('constraint failed');
      if (query === 'ROLLBACK;') throw new Error('no transaction is active');
      return { rowsAffected: 1 };
    });

    const result = await wipeAll();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).toContain('constraint failed');
  });
});
