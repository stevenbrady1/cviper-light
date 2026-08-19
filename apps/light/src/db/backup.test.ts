/**
 * Tests for `readAll` / `writeAll` — the I/O counterparts to the pure
 * `exportBackup` / `importBackup` in `@cviper/core-types`.
 *
 * The properties that matter here are ORDERING and ATOMICITY, so most of these
 * assert the sequence of statements the database was asked to run rather than
 * a returned value. A `writeAll` that inserted the right rows in the wrong
 * order, or committed half of them, would return `ok` either way.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isErr,
  isOk,
  type Analysis,
  type Application,
  type Cv,
  type Job,
} from '@cviper/core-types';

const sql = vi.hoisted(() => {
  const execute = vi.fn<(query: string, values?: unknown[]) => Promise<{ rowsAffected: number }>>();
  const select = vi.fn<(query: string, values?: unknown[]) => Promise<unknown[]>>();
  const load = vi.fn<(url: string) => Promise<unknown>>();
  return { execute, select, load, db: { execute, select } };
});

vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: sql.load } }));

const PRAGMA = /^PRAGMA/i;

/** Statements sent to `execute`, minus the connection-time pragma. */
function statements(): string[] {
  return sql.execute.mock.calls.map((call) => call[0]).filter((query) => !PRAGMA.test(query));
}

/** The table each INSERT targeted, in the order the inserts were issued. */
function insertedTables(): string[] {
  return statements()
    .map((query) => /^INSERT INTO (\w+)/.exec(query)?.[1])
    .filter((table): table is string => table !== undefined);
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

// --- Fixtures ---------------------------------------------------------------

const JOB: Job = {
  id: 'job-0001',
  source: 'adzuna',
  external_id: 'ADZ-1',
  title: 'Risk Analyst',
  company: 'HSBC',
  location: 'London',
  salary_min: 65000,
  salary_max: 80000,
  salary_currency: 'GBP',
  salary_period: 'year',
  description: null,
  url: null,
  posted_date: '2026-08-10',
  created_at: '2026-08-19T09:00:00.000Z',
};

const CV: Cv = {
  id: 'cv-0001',
  name: 'Main CV',
  file_path: null,
  extracted_text: null,
  created_at: '2026-08-19T09:01:00.000Z',
};

const APPLICATION: Application = {
  id: 'app-0001',
  job_id: 'job-0001',
  status: 'saved',
  applied_date: null,
  notes: null,
  next_action: null,
  next_action_date: null,
  updated_at: '2026-08-19T09:02:00.000Z',
};

const ANALYSIS: Analysis = {
  id: 'ana-0001',
  cv_id: 'cv-0001',
  job_id: 'job-0001',
  provider: 'keyword',
  model: 'none',
  match_score: 44,
  result_json: {
    match_score: 44,
    verdict: 'weak',
    summary: 'Thin overlap.',
    matched_skills: [],
    missing_skills: ['Python'],
    keyword_gaps: ['stress testing'],
    matched_keywords: [],
    suggestions: [],
    ats_notes: [],
  },
  created_at: '2026-08-19T09:03:00.000Z',
};

const EMPTY = { jobs: [], applications: [], cvs: [], analyses: [] };
const FULL = { jobs: [JOB], applications: [APPLICATION], cvs: [CV], analyses: [ANALYSIS] };

// --- readAll ----------------------------------------------------------------

describe('readAll', () => {
  it('reads all four tables in a fixed, deterministic order', async () => {
    const { readAll } = await import('./backup');

    const result = await readAll();

    expect(isOk(result)).toBe(true);
    const queries = sql.select.mock.calls.map((call) => call[0]);
    expect(queries).toHaveLength(4);
    expect(queries[0]).toMatch(/FROM jobs ORDER BY id$/);
    expect(queries[1]).toMatch(/FROM cvs ORDER BY id$/);
    expect(queries[2]).toMatch(/FROM applications ORDER BY id$/);
    expect(queries[3]).toMatch(/FROM analyses ORDER BY id$/);
  });

  it('returns an empty snapshot when the database is empty', async () => {
    const { readAll } = await import('./backup');

    const result = await readAll();

    expect(isOk(result) && result.value).toEqual(EMPTY);
  });

  it('maps every table back into domain objects', async () => {
    const rows = await import('./rows');
    const analysisValues = rows.analysisToValues(ANALYSIS);
    if (!isOk(analysisValues)) throw new Error('fixture failed to serialise');

    const asRow = (columns: readonly string[], values: readonly (string | number | null)[]) =>
      Object.fromEntries(columns.map((column, index) => [column, values[index]]));

    sql.select
      .mockResolvedValueOnce([asRow(rows.JOB_COLUMNS, rows.jobToValues(JOB))])
      .mockResolvedValueOnce([asRow(rows.CV_COLUMNS, rows.cvToValues(CV))])
      .mockResolvedValueOnce([
        asRow(rows.APPLICATION_COLUMNS, rows.applicationToValues(APPLICATION)),
      ])
      .mockResolvedValueOnce([asRow(rows.ANALYSIS_COLUMNS, analysisValues.value)]);

    const { readAll } = await import('./backup');
    const result = await readAll();

    expect(isOk(result) && result.value).toEqual(FULL);
  });

  it('refuses the whole snapshot when one row is unreadable', async () => {
    sql.select.mockResolvedValueOnce([{ id: 'job-0001', source: 'monster' }]);

    const { readAll } = await import('./backup');
    const result = await readAll();

    expect(isErr(result) && result.error.code).toBe('MALFORMED_ROW');
    expect(isErr(result) && result.error.table).toBe('jobs');
  });

  it('does not let another operation slip between its four reads', async () => {
    const order: string[] = [];
    sql.select.mockImplementation(async () => {
      order.push('read');
      return [];
    });
    sql.execute.mockImplementation(async (query: string) => {
      if (!PRAGMA.test(query)) order.push('write');
      return { rowsAffected: 1 };
    });

    const { readAll } = await import('./backup');
    const { upsertJob } = await import('./jobs');

    const snapshot = readAll();
    const write = upsertJob(JOB);
    await Promise.all([snapshot, write]);

    expect(order).toEqual(['read', 'read', 'read', 'read', 'write']);
  });

  it('reports a failed read as an error rather than an empty export', async () => {
    sql.select.mockRejectedValue(new Error('no such table: analyses'));

    const { readAll } = await import('./backup');
    const result = await readAll();

    expect(isErr(result) && result.error.code).toBe('QUERY_FAILED');
  });
});

// --- writeAll ---------------------------------------------------------------

describe('writeAll', () => {
  it('wraps everything in one transaction', async () => {
    const { writeAll } = await import('./backup');

    const result = await writeAll(FULL);

    expect(isOk(result)).toBe(true);
    expect(statements()[0]).toBe('BEGIN IMMEDIATE;');
    expect(statements().at(-1)).toBe('COMMIT;');
    expect(statements()).not.toContain('ROLLBACK;');
  });

  it('writes parents before children so the foreign keys hold', async () => {
    const { writeAll } = await import('./backup');

    await writeAll(FULL);

    expect(insertedTables()).toEqual(['jobs', 'cvs', 'applications', 'analyses']);
  });

  it('still opens and closes a transaction for an empty payload', async () => {
    const { writeAll } = await import('./backup');

    const result = await writeAll(EMPTY);

    expect(isOk(result)).toBe(true);
    expect(statements()).toEqual(['BEGIN IMMEDIATE;', 'COMMIT;']);
  });

  it('rolls back and never commits when a row is rejected', async () => {
    sql.execute.mockImplementation(async (query: string) => {
      if (/^INSERT INTO applications/.test(query)) {
        throw new Error('FOREIGN KEY constraint failed');
      }
      return { rowsAffected: 1 };
    });

    const { writeAll } = await import('./backup');
    const result = await writeAll(FULL);

    expect(isErr(result) && result.error.code).toBe('CONSTRAINT_VIOLATION');
    expect(statements()).toContain('ROLLBACK;');
    expect(statements()).not.toContain('COMMIT;');
  });

  it('reports the original failure even when the rollback also fails', async () => {
    sql.execute.mockImplementation(async (query: string) => {
      if (/^INSERT INTO jobs/.test(query)) throw new Error('UNIQUE constraint failed: jobs.id');
      if (query === 'ROLLBACK;') throw new Error('cannot rollback - no transaction is active');
      return { rowsAffected: 1 };
    });

    const { writeAll } = await import('./backup');
    const result = await writeAll(FULL);

    expect(isErr(result) && result.error.message).toBe('UNIQUE constraint failed: jobs.id');
  });

  it('writes nothing at all when a record cannot be serialised', async () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    const { writeAll } = await import('./backup');
    const result = await writeAll({
      ...FULL,
      analyses: [{ ...ANALYSIS, result_json: circular as unknown as Analysis['result_json'] }],
    });

    expect(isErr(result) && result.error.code).toBe('SERIALISE_FAILED');
    // Not even BEGIN: the failure is detected before the transaction opens.
    expect(statements()).toEqual([]);
  });

  it('cannot be interrupted by another operation mid-transaction', async () => {
    const order: string[] = [];
    sql.execute.mockImplementation(async (query: string) => {
      if (!PRAGMA.test(query)) order.push(query.split(' ').slice(0, 3).join(' '));
      return { rowsAffected: 1 };
    });

    const { writeAll } = await import('./backup');
    const { deleteJob } = await import('./jobs');

    const importing = writeAll(FULL);
    const competing = deleteJob('job-0001');
    await Promise.all([importing, competing]);

    expect(order.at(-1)).toBe('DELETE FROM jobs');
    expect(order.indexOf('COMMIT;')).toBeLessThan(order.length - 1);
  });
});
