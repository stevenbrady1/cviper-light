/**
 * The interview sub-stage queries (L-205), and how the new column and table sit
 * in the row layer. SQL driver mocked, like its neighbours: what matters here
 * is the statements and their order, and `migration.interviewSubstages.test.ts`
 * is where the SQL itself meets a real SQLite.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isErr, isOk, type Application, type InterviewSubstage } from '@cviper/core-types';

const sql = vi.hoisted(() => {
  const execute = vi.fn<(query: string, values?: unknown[]) => Promise<{ rowsAffected: number }>>();
  const select = vi.fn<(query: string, values?: unknown[]) => Promise<unknown[]>>();
  const load = vi.fn<(url: string) => Promise<unknown>>();
  return { execute, select, load, db: { execute, select } };
});

vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: sql.load } }));

const PRAGMA = /^PRAGMA/i;

function writes(): { query: string; values: unknown[] | undefined }[] {
  return sql.execute.mock.calls
    .filter((call) => !PRAGMA.test(call[0]))
    .map((call) => ({ query: call[0], values: call[1] }));
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

const STAGES: InterviewSubstage[] = [
  { id: 'sub-a', name: 'HR Screen', position: 0 },
  { id: 'sub-b', name: 'Technical Test', position: 1 },
];

const APPLICATION: Application = {
  id: 'app-1',
  job_id: 'job-1',
  status: 'interviewing',
  applied_date: null,
  notes: null,
  next_action: null,
  next_action_date: null,
  updated_at: '2026-10-05T09:00:00.000Z',
  interview_substage_id: 'sub-b',
};

describe('the row layer', () => {
  it('puts interview_substage_id last in the applications columns, as the migration appended it', async () => {
    const { APPLICATION_COLUMNS, INTERVIEW_SUBSTAGE_COLUMNS } = await import('./rows');
    expect(APPLICATION_COLUMNS.at(-1)).toBe('interview_substage_id');
    expect([...INTERVIEW_SUBSTAGE_COLUMNS]).toEqual(['id', 'name', 'position']);
  });

  it('writes a card with no sub-stage as NULL, never undefined', async () => {
    const { applicationToValues } = await import('./rows');
    const { interview_substage_id: _omitted, ...bare } = APPLICATION;
    const values = applicationToValues(bare);
    expect(values.at(-1)).toBeNull();
    expect(applicationToValues(APPLICATION).at(-1)).toBe('sub-b');
  });

  it('reads an old row that has no such column at all as "no sub-stage"', async () => {
    const { applicationFromRow } = await import('./rows');
    const result = applicationFromRow({
      id: 'app-1',
      job_id: 'job-1',
      status: 'saved',
      applied_date: null,
      notes: null,
      next_action: null,
      next_action_date: null,
      updated_at: '2026-10-05T09:00:00.000Z',
    });
    expect(isOk(result) && (result.value.interview_substage_id ?? null)).toBeNull();
  });

  it('round-trips a card with a sub-stage through its row', async () => {
    const { APPLICATION_COLUMNS, applicationFromRow, applicationToValues } = await import('./rows');
    const values = applicationToValues(APPLICATION);
    const row = Object.fromEntries(APPLICATION_COLUMNS.map((column, i) => [column, values[i]]));
    const back = applicationFromRow(row);
    expect(isOk(back) && back.value).toEqual(APPLICATION);
  });

  it('refuses a row whose sub-stage is not text', async () => {
    const { applicationFromRow } = await import('./rows');
    const result = applicationFromRow({ ...APPLICATION, interview_substage_id: 7 });
    expect(isErr(result) && result.error.code).toBe('MALFORMED_ROW');
  });

  it('refuses a sub-stage row with an empty name', async () => {
    const { interviewSubstageFromRow } = await import('./rows');
    const result = interviewSubstageFromRow({ id: 'sub-a', name: '  ', position: 0 });
    expect(isErr(result) && result.error.table).toBe('interview_substages');
  });
});

describe('listInterviewSubstages', () => {
  it('reads in display order, naming its columns', async () => {
    sql.select.mockResolvedValueOnce(STAGES);
    const { listInterviewSubstages } = await import('./interviewSubstages');

    const result = await listInterviewSubstages();

    expect(isOk(result) && result.value).toEqual(STAGES);
    expect(sql.select.mock.calls[0]?.[0]).toBe(
      'SELECT id, name, position FROM interview_substages ORDER BY position, id',
    );
  });
});

describe('replaceInterviewSubstages', () => {
  it('upserts each in one transaction, then deletes everything not in the list', async () => {
    const { replaceInterviewSubstages } = await import('./interviewSubstages');

    const result = await replaceInterviewSubstages(STAGES);

    expect(isOk(result)).toBe(true);
    const issued = writes();
    expect(issued[0]?.query).toBe('BEGIN IMMEDIATE;');
    expect(issued[1]?.query).toMatch(
      /^INSERT INTO interview_substages .* ON CONFLICT \(id\) DO UPDATE/,
    );
    expect(issued[1]?.values).toEqual(['sub-a', 'HR Screen', 0]);
    expect(issued[2]?.values).toEqual(['sub-b', 'Technical Test', 1]);
    // Ids are BOUND, never interpolated.
    expect(issued[3]).toEqual({
      query: 'DELETE FROM interview_substages WHERE id NOT IN ($1, $2)',
      values: ['sub-a', 'sub-b'],
    });
    expect(issued[4]?.query).toBe('COMMIT;');
  });

  it('boundary: an empty list deletes every sub-stage and binds nothing', async () => {
    const { replaceInterviewSubstages } = await import('./interviewSubstages');

    await replaceInterviewSubstages([]);

    expect(writes().map((w) => w.query)).toEqual([
      'BEGIN IMMEDIATE;',
      'DELETE FROM interview_substages',
      'COMMIT;',
    ]);
  });

  it('rolls back and reports the original error when a write fails', async () => {
    sql.execute.mockImplementation(async (query) => {
      if (query.startsWith('INSERT')) throw new Error('database is locked');
      return { rowsAffected: 1 };
    });
    const { replaceInterviewSubstages } = await import('./interviewSubstages');

    const result = await replaceInterviewSubstages(STAGES);

    expect(isErr(result) && result.error.message).toContain('database is locked');
    const issued = writes().map((w) => w.query);
    expect(issued).toContain('ROLLBACK;');
    expect(issued).not.toContain('COMMIT;');
  });
});

describe('wipeAll', () => {
  it('deletes cards before sub-stages, and lists the new table at all', async () => {
    const { WIPE_ORDER } = await import('./wipe');
    expect(WIPE_ORDER).toContain('interview_substages');
    expect(WIPE_ORDER.indexOf('applications')).toBeLessThan(
      WIPE_ORDER.indexOf('interview_substages'),
    );
  });
});
