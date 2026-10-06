/**
 * The `job_workflow` data layer (L-199): one row per job's work in progress.
 *
 * The SQL driver is mocked, as in `queries.test.ts`; the migration itself is
 * run for real by `migration.jobWorkflow.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const ROW = {
  id: 'job-1',
  step: 'tailor',
  cv_id: 'cv-1',
  ai_option: 'ollama:llama3.1:8b',
  advert: 'Credit Risk Analyst. SQL and Python.',
  draft_json: '{"result":null}',
  updated_at: '2026-10-06T09:00:00.000Z',
} as const;

describe('listJobWorkflows', () => {
  it('happy: reads every row, naming its columns', async () => {
    sql.select.mockResolvedValue([ROW]);
    const { listJobWorkflows } = await import('./workflow');

    const listed = await listJobWorkflows();

    expect(listed).toEqual({ ok: true, value: [ROW] });
    const query = sql.select.mock.calls[0]?.[0] ?? '';
    expect(query).toMatch(
      /^SELECT id, step, cv_id, ai_option, advert, draft_json, updated_at FROM job_workflow/,
    );
  });

  it('boundary: the optional columns may all be NULL', async () => {
    sql.select.mockResolvedValue([{ ...ROW, cv_id: null, ai_option: null, draft_json: null }]);
    const { listJobWorkflows } = await import('./workflow');
    const listed = await listJobWorkflows();
    expect(listed.ok && listed.value[0]).toMatchObject({
      cv_id: null,
      ai_option: null,
      draft_json: null,
    });
  });

  it('negative: a row with a missing advert is refused, not read as empty', async () => {
    sql.select.mockResolvedValue([{ ...ROW, advert: null }]);
    const { listJobWorkflows } = await import('./workflow');
    const listed = await listJobWorkflows();
    expect(listed.ok).toBe(false);
    expect(!listed.ok && listed.error.code).toBe('MALFORMED_ROW');
  });

  it('negative: a failed read is reported as a failure, never as "no work in progress"', async () => {
    sql.select.mockRejectedValue(new Error('database is locked'));
    const { listJobWorkflows } = await import('./workflow');
    const listed = await listJobWorkflows();
    expect(listed.ok).toBe(false);
  });
});

describe('upsertJobWorkflow', () => {
  it('writes every column in order, as one upsert keyed on the job id', async () => {
    const { upsertJobWorkflow } = await import('./workflow');

    const written = await upsertJobWorkflow(ROW);

    expect(written.ok).toBe(true);
    const [write] = writes();
    expect(write?.query).toMatch(
      /^INSERT INTO job_workflow \(id, step, cv_id, ai_option, advert, draft_json, updated_at\)/,
    );
    expect(write?.query).toContain('ON CONFLICT (id) DO UPDATE SET');
    expect(write?.values).toEqual([
      'job-1',
      'tailor',
      'cv-1',
      'ollama:llama3.1:8b',
      'Credit Risk Analyst. SQL and Python.',
      '{"result":null}',
      '2026-10-06T09:00:00.000Z',
    ]);
  });

  it('negative: a refused write is passed back as the failure it was', async () => {
    sql.execute.mockImplementation(async (query) => {
      if (PRAGMA.test(query)) return { rowsAffected: 0 };
      throw new Error('disk I/O error');
    });
    const { upsertJobWorkflow } = await import('./workflow');
    const written = await upsertJobWorkflow(ROW);
    expect(written.ok).toBe(false);
  });
});
