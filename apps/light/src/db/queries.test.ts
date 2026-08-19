/**
 * Tests for the four query modules and the statement builders behind them.
 *
 * These assert the RENDERED SQL and the bound parameters, not the source that
 * produced them. A builder that derives its column list from `TABLE_COLUMNS`
 * would pass a test that derived the expectation the same way no matter what it
 * got wrong, so the jobs statements are pinned to full string literals and the
 * placeholder numbering is re-parsed out of the finished SQL.
 *
 * No real database is involved: `@tauri-apps/plugin-sql` is mocked.
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

import { TABLE_COLUMNS, type TableName } from './rows';

const sql = vi.hoisted(() => {
  const execute = vi.fn<(query: string, values?: unknown[]) => Promise<{ rowsAffected: number }>>();
  const select = vi.fn<(query: string, values?: unknown[]) => Promise<unknown[]>>();
  const load = vi.fn<(url: string) => Promise<unknown>>();
  return { execute, select, load, db: { execute, select } };
});

vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: sql.load } }));

const PRAGMA = /^PRAGMA/i;

/** Everything `execute` was asked to run, minus the connection-time pragma. */
function writes(): { query: string; values: unknown[] | undefined }[] {
  return sql.execute.mock.calls
    .filter((call) => !PRAGMA.test(call[0]))
    .map((call) => ({ query: call[0], values: call[1] }));
}

function reads(): { query: string; values: unknown[] | undefined }[] {
  return sql.select.mock.calls.map((call) => ({ query: call[0], values: call[1] }));
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
  source: 'reed',
  external_id: '55512345',
  title: 'Senior Credit Risk Analyst',
  company: 'Barclays',
  location: 'London, EC2',
  salary_min: 457,
  salary_max: 550,
  salary_currency: 'GBP',
  salary_period: 'day',
  description: 'Inside IR35.',
  url: 'https://www.reed.co.uk/jobs/55512345',
  posted_date: '2026-08-12',
  created_at: '2026-08-19T09:00:00.000Z',
};

const APPLICATION: Application = {
  id: 'app-0001',
  job_id: 'job-0001',
  status: 'applied',
  applied_date: '2026-08-13',
  notes: null,
  next_action: 'Chase the recruiter',
  next_action_date: '2026-08-21',
  updated_at: '2026-08-19T09:10:00.000Z',
};

const CV: Cv = {
  id: 'cv-0001',
  name: 'Credit risk CV',
  file_path: null,
  extracted_text: 'SENIOR CREDIT RISK ANALYST',
  created_at: '2026-08-19T09:15:00.000Z',
};

const ANALYSIS: Analysis = {
  id: 'ana-0001',
  cv_id: 'cv-0001',
  job_id: null,
  provider: 'keyword',
  model: 'none',
  match_score: 61,
  result_json: {
    match_score: 61,
    verdict: 'possible',
    summary: 'Reasonable overlap.',
    matched_skills: ['IFRS 9'],
    missing_skills: ['Python'],
    keyword_gaps: [],
    matched_keywords: ['credit risk'],
    suggestions: [],
    ats_notes: [],
  },
  created_at: '2026-08-19T09:20:00.000Z',
};

// --- Statement builders -----------------------------------------------------

describe('statement builders', () => {
  it('renders the jobs SELECT with every column named, never SELECT *', async () => {
    const { selectFrom } = await import('./statements');

    expect(selectFrom('jobs')).toBe(
      'SELECT id, source, external_id, title, company, location, salary_min, salary_max, ' +
        'salary_currency, salary_period, description, url, posted_date, created_at FROM jobs',
    );
  });

  it('renders the jobs upsert exactly', async () => {
    const { upsertInto } = await import('./statements');

    expect(upsertInto('jobs')).toBe(
      'INSERT INTO jobs (id, source, external_id, title, company, location, salary_min, ' +
        'salary_max, salary_currency, salary_period, description, url, posted_date, created_at) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ' +
        'ON CONFLICT (id) DO UPDATE SET source = excluded.source, ' +
        'external_id = excluded.external_id, title = excluded.title, company = excluded.company, ' +
        'location = excluded.location, salary_min = excluded.salary_min, ' +
        'salary_max = excluded.salary_max, salary_currency = excluded.salary_currency, ' +
        'salary_period = excluded.salary_period, description = excluded.description, ' +
        'url = excluded.url, posted_date = excluded.posted_date, created_at = excluded.created_at',
    );
  });

  it('renders a delete keyed on the primary key', async () => {
    const { deleteFrom } = await import('./statements');

    expect(deleteFrom('analyses')).toBe('DELETE FROM analyses WHERE id = $1');
  });

  for (const table of Object.keys(TABLE_COLUMNS) as TableName[]) {
    it(`${table}: the upsert binds $1..$n in order, one per column`, async () => {
      const { upsertInto } = await import('./statements');
      const columns = TABLE_COLUMNS[table];

      // Parsed back OUT of the rendered SQL, so a builder that numbered its
      // placeholders wrongly cannot agree with itself into a pass.
      const placeholders = [...upsertInto(table).matchAll(/\$(\d+)/g)].map((match) =>
        Number(match[1]),
      );

      expect(placeholders).toEqual(columns.map((_, index) => index + 1));
    });

    it(`${table}: the upsert never overwrites the primary key with itself`, async () => {
      const { upsertInto } = await import('./statements');

      expect(upsertInto(table)).not.toMatch(/SET (?:.*, )?id = excluded\.id/);
    });
  }
});

// --- jobs -------------------------------------------------------------------

describe('jobs', () => {
  it('lists newest first with a deterministic tie-break', async () => {
    const { listJobs } = await import('./jobs');

    const result = await listJobs();

    expect(isOk(result) && result.value).toEqual([]);
    expect(reads()[0]?.query).toMatch(/FROM jobs ORDER BY created_at DESC, id$/);
  });

  it('maps the rows it gets back into domain objects', async () => {
    const { jobToValues, JOB_COLUMNS } = await import('./rows');
    const values = jobToValues(JOB);
    const row = Object.fromEntries(JOB_COLUMNS.map((column, index) => [column, values[index]]));
    sql.select.mockResolvedValue([row]);

    const { listJobs } = await import('./jobs');
    const result = await listJobs();

    expect(isOk(result) && result.value).toEqual([JOB]);
  });

  it('refuses the whole list when one row is malformed rather than dropping it', async () => {
    sql.select.mockResolvedValue([{ id: 'job-0001', source: 'monster' }]);

    const { listJobs } = await import('./jobs');
    const result = await listJobs();

    expect(isErr(result) && result.error.code).toBe('MALFORMED_ROW');
  });

  it('binds the id when fetching one job', async () => {
    const { getJob } = await import('./jobs');

    await getJob('job-0001');

    expect(reads()[0]?.query).toMatch(/FROM jobs WHERE id = \$1$/);
    expect(reads()[0]?.values).toEqual(['job-0001']);
  });

  it('reports a missing job as null, not as an error', async () => {
    sql.select.mockResolvedValue([]);

    const { getJob } = await import('./jobs');
    const result = await getJob('nope');

    expect(isOk(result) && result.value).toBeNull();
  });

  it('binds every column value in column order on upsert', async () => {
    const { jobToValues } = await import('./rows');
    const { upsertJob } = await import('./jobs');

    const result = await upsertJob(JOB);

    expect(isOk(result)).toBe(true);
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.query).toMatch(/^INSERT INTO jobs \(/);
    expect(writes()[0]?.values).toEqual(jobToValues(JOB));
  });

  it('surfaces a duplicate advert as a constraint violation, not a crash', async () => {
    sql.execute.mockImplementation(async (query: string) => {
      if (PRAGMA.test(query)) return { rowsAffected: 0 };
      throw new Error('UNIQUE constraint failed: jobs.source, jobs.external_id');
    });

    const { upsertJob } = await import('./jobs');
    const result = await upsertJob(JOB);

    expect(isErr(result) && result.error.code).toBe('CONSTRAINT_VIOLATION');
    expect(isErr(result) && result.error.table).toBe('jobs');
  });

  it('deletes by id', async () => {
    const { deleteJob } = await import('./jobs');

    const result = await deleteJob('job-0001');

    expect(isOk(result)).toBe(true);
    expect(writes()[0]?.query).toBe('DELETE FROM jobs WHERE id = $1');
    expect(writes()[0]?.values).toEqual(['job-0001']);
  });
});

// --- applications -----------------------------------------------------------

describe('applications', () => {
  it('binds every column value in column order on upsert', async () => {
    const { applicationToValues } = await import('./rows');
    const { upsertApplication } = await import('./applications');

    await upsertApplication(APPLICATION);

    expect(writes()[0]?.values).toEqual(applicationToValues(APPLICATION));
  });

  it('filters by status through a bound parameter, never string concatenation', async () => {
    const { listApplicationsByStatus } = await import('./applications');

    await listApplicationsByStatus('interviewing');

    expect(reads()[0]?.query).toMatch(/WHERE status = \$1 ORDER BY updated_at DESC, id$/);
    expect(reads()[0]?.values).toEqual(['interviewing']);
    expect(reads()[0]?.query).not.toContain('interviewing');
  });

  it('matches the partial index predicate when listing what is due', async () => {
    const { listApplicationsDueBy } = await import('./applications');

    await listApplicationsDueBy('2026-08-21');

    // `next_action_date IS NOT NULL` is not redundant with `<= $1`: it is what
    // makes the partial index idx_applications_next_action_date usable.
    expect(reads()[0]?.query).toMatch(
      /WHERE next_action_date IS NOT NULL AND next_action_date <= \$1 ORDER BY next_action_date, id$/,
    );
    expect(reads()[0]?.values).toEqual(['2026-08-21']);
  });

  it('surfaces a missing parent job as a constraint violation', async () => {
    sql.execute.mockImplementation(async (query: string) => {
      if (PRAGMA.test(query)) return { rowsAffected: 0 };
      throw new Error('FOREIGN KEY constraint failed');
    });

    const { upsertApplication } = await import('./applications');
    const result = await upsertApplication(APPLICATION);

    expect(isErr(result) && result.error.code).toBe('CONSTRAINT_VIOLATION');
    expect(isErr(result) && result.error.table).toBe('applications');
  });

  it('deletes by id', async () => {
    const { deleteApplication } = await import('./applications');

    await deleteApplication('app-0001');

    expect(writes()[0]?.query).toBe('DELETE FROM applications WHERE id = $1');
  });
});

// --- cvs --------------------------------------------------------------------

describe('cvs', () => {
  it('binds every column value in column order on upsert', async () => {
    const { cvToValues } = await import('./rows');
    const { upsertCv } = await import('./cvs');

    await upsertCv(CV);

    expect(writes()[0]?.values).toEqual(cvToValues(CV));
  });

  it('lists newest first', async () => {
    const { listCvs } = await import('./cvs');

    await listCvs();

    expect(reads()[0]?.query).toMatch(/FROM cvs ORDER BY created_at DESC, id$/);
  });

  it('deletes by id', async () => {
    const { deleteCv } = await import('./cvs');

    await deleteCv('cv-0001');

    expect(writes()[0]?.query).toBe('DELETE FROM cvs WHERE id = $1');
  });
});

// --- analyses ---------------------------------------------------------------

describe('analyses', () => {
  it('stores result_json as a JSON string', async () => {
    const { upsertAnalysis } = await import('./analyses');

    await upsertAnalysis(ANALYSIS);

    const values = writes()[0]?.values ?? [];
    const index = TABLE_COLUMNS.analyses.indexOf('result_json');
    expect(typeof values[index]).toBe('string');
    expect(JSON.parse(String(values[index]))).toEqual(ANALYSIS.result_json);
  });

  it('refuses to write an analysis it cannot serialise, without touching the database', async () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    const { upsertAnalysis } = await import('./analyses');
    const result = await upsertAnalysis({
      ...ANALYSIS,
      result_json: circular as unknown as Analysis['result_json'],
    });

    expect(isErr(result) && result.error.code).toBe('SERIALISE_FAILED');
    expect(writes()).toHaveLength(0);
  });

  it('lists the analyses for one cv through a bound parameter', async () => {
    const { listAnalysesForCv } = await import('./analyses');

    await listAnalysesForCv('cv-0001');

    expect(reads()[0]?.query).toMatch(/WHERE cv_id = \$1 ORDER BY created_at DESC, id$/);
    expect(reads()[0]?.values).toEqual(['cv-0001']);
  });

  it('reads result_json back as a real object', async () => {
    const { analysisToValues, ANALYSIS_COLUMNS } = await import('./rows');
    const values = analysisToValues(ANALYSIS);
    if (!isOk(values)) throw new Error('fixture failed to serialise');
    const row = Object.fromEntries(
      ANALYSIS_COLUMNS.map((column, index) => [column, values.value[index]]),
    );
    sql.select.mockResolvedValue([row]);

    const { listAnalyses } = await import('./analyses');
    const result = await listAnalyses();

    expect(isOk(result) && result.value).toEqual([ANALYSIS]);
  });

  it('deletes by id', async () => {
    const { deleteAnalysis } = await import('./analyses');

    await deleteAnalysis('ana-0001');

    expect(writes()[0]?.query).toBe('DELETE FROM analyses WHERE id = $1');
  });
});
