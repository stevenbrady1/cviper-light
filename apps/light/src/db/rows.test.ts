/**
 * Coercion tests for `rows.ts` — the single SQLite <-> TypeScript boundary.
 *
 * The load-bearing test in here is `every migration column is mapped in
 * rows.ts`. A column added to the schema but not to `rows.ts` would be silently
 * dropped from every read, and nothing else in the codebase would notice. That
 * guard is only worth having if it can actually fail, so the SQL parser it
 * relies on is itself tested — both that it reads real columns, and that it
 * refuses input it cannot classify instead of quietly returning fewer columns.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  isErr,
  isOk,
  type Analysis,
  type Application,
  type Cv,
  type CvAnalysis,
  type Job,
} from '@cviper/core-types';

import {
  TABLE_COLUMNS,
  analysisFromRow,
  analysisToValues,
  applicationFromRow,
  applicationToValues,
  cvFromRow,
  cvToValues,
  jobFromRow,
  jobToValues,
  type SqlValue,
} from './rows';

// --- The migration, read from disk ------------------------------------------

const MIGRATION_SQL = readFileSync(
  new URL('../../src-tauri/migrations/0001_init.sql', import.meta.url),
  'utf8',
);

/** A table-level constraint line, which declares no column of its own. */
const TABLE_CONSTRAINT = /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i;

/**
 * Pull the declared column names out of every `CREATE TABLE` in a migration.
 *
 * Deliberately strict: a line it cannot classify THROWS. A lenient parser that
 * skipped what it did not understand would make the coverage guard below pass
 * for the wrong reason — it would compare rows.ts against a shorter list.
 */
function columnsFromMigration(sql: string): Record<string, string[]> {
  const tables: Record<string, string[]> = {};
  const createTable = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g;

  for (const match of sql.matchAll(createTable)) {
    const name = match[1];
    const body = match[2];
    if (name === undefined || body === undefined) continue;

    const columns: string[] = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/--.*$/, '').trim();
      if (line === '') continue;
      if (TABLE_CONSTRAINT.test(line)) continue;

      const identifier = /^([a-z_][a-z0-9_]*)\b/.exec(line);
      if (identifier === null || identifier[1] === undefined) {
        throw new Error(`Unparseable column line in "${name}": ${line}`);
      }
      columns.push(identifier[1]);
    }

    if (columns.length === 0) throw new Error(`Table "${name}" declared no columns`);
    tables[name] = columns;
  }

  return tables;
}

// --- Fixtures ---------------------------------------------------------------

/** A Reed contract role: the case `salary_period` exists for. */
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
  description: 'Contract role \u2014 \u00a3457/day inside IR35.',
  url: 'https://www.reed.co.uk/jobs/55512345',
  posted_date: '2026-08-12',
  created_at: '2026-08-19T09:00:00.000Z',
};

/** Hand-entered: every nullable column is actually null. */
const MANUAL_JOB: Job = {
  id: 'job-0002',
  source: 'manual',
  external_id: null,
  title: 'Quant Developer',
  company: 'Man Group',
  location: null,
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  description: null,
  url: null,
  posted_date: null,
  created_at: '2026-08-19T09:05:00.000Z',
};

const APPLICATION: Application = {
  id: 'app-0001',
  job_id: 'job-0001',
  status: 'interviewing',
  applied_date: '2026-08-13',
  notes: 'Second stage with the CRO.',
  next_action: 'Send the case study back',
  next_action_date: '2026-08-21',
  updated_at: '2026-08-19T09:10:00.000Z',
};

const CV: Cv = {
  id: 'cv-0001',
  name: 'Credit risk CV',
  file_path: 'C:\\Users\\steve\\Documents\\cv.pdf',
  extracted_text: 'SENIOR CREDIT RISK ANALYST \u2014 \u00a385,000',
  created_at: '2026-08-19T09:15:00.000Z',
};

const CV_ANALYSIS: CvAnalysis = {
  match_score: 72,
  verdict: 'possible',
  summary: 'Strong credit risk background, thin on Python.',
  matched_skills: ['IFRS 9', 'IRB modelling'],
  missing_skills: ['Python'],
  keyword_gaps: ['stress testing'],
  matched_keywords: ['credit risk', 'PD models'],
  suggestions: [
    {
      section: 'Skills',
      issue: 'Python is not mentioned.',
      recommendation: 'Add the Python work from the IRB project.',
      priority: 'high',
    },
  ],
  ats_notes: ['Two-column layout may not parse.'],
};

const ANALYSIS: Analysis = {
  id: 'ana-0001',
  cv_id: 'cv-0001',
  job_id: 'job-0001',
  provider: 'ollama',
  model: 'llama3.2:3b',
  match_score: 72,
  result_json: CV_ANALYSIS,
  created_at: '2026-08-19T09:20:00.000Z',
};

// --- Helpers ----------------------------------------------------------------

/** Rebuild the row object SQLite would hand back for a set of bound values. */
function rowOf(columns: readonly string[], values: readonly SqlValue[]): Record<string, SqlValue> {
  expect(values).toHaveLength(columns.length);
  const row: Record<string, SqlValue> = {};
  columns.forEach((column, index) => {
    row[column] = values[index] ?? null;
  });
  return row;
}

function jobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...rowOf(TABLE_COLUMNS.jobs, jobToValues(JOB)), ...overrides };
}

function applicationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...rowOf(TABLE_COLUMNS.applications, applicationToValues(APPLICATION)), ...overrides };
}

function analysisRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const values = analysisToValues(ANALYSIS);
  if (!isOk(values)) throw new Error('fixture analysis failed to serialise');
  return { ...rowOf(TABLE_COLUMNS.analyses, values.value), ...overrides };
}

// --- The schema-coverage guard ----------------------------------------------

describe('the migration column parser', () => {
  it('reads column names and ignores comments and blank lines', () => {
    const parsed = columnsFromMigration(
      [
        '-- a leading comment',
        'CREATE TABLE IF NOT EXISTS widgets (',
        '  id      TEXT PRIMARY KEY NOT NULL,',
        '',
        '  -- why this column exists',
        '  label   TEXT NOT NULL, -- trailing comment',
        '  weight  REAL',
        ');',
      ].join('\n'),
    );

    expect(parsed).toEqual({ widgets: ['id', 'label', 'weight'] });
  });

  it('throws on a line it cannot classify rather than skipping it', () => {
    expect(() =>
      columnsFromMigration('CREATE TABLE IF NOT EXISTS widgets (\n  "quoted col" TEXT\n);'),
    ).toThrow(/Unparseable column line/);
  });
});

describe('every migration column is mapped in rows.ts', () => {
  const parsed = columnsFromMigration(MIGRATION_SQL);

  it('creates exactly the four tables rows.ts knows about', () => {
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(TABLE_COLUMNS).sort());
  });

  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    it(`${table}: the SQL columns and the rows.ts columns are identical, in order`, () => {
      expect(parsed[table]).toEqual([...columns]);
    });
  }
});

// --- Round trips ------------------------------------------------------------

describe('round trips through a row', () => {
  it('carries a fully populated job out and back unchanged', () => {
    const back = jobFromRow(rowOf(TABLE_COLUMNS.jobs, jobToValues(JOB)));
    expect(isOk(back) && back.value).toEqual(JOB);
  });

  it('carries an all-null manual job out and back unchanged', () => {
    const back = jobFromRow(rowOf(TABLE_COLUMNS.jobs, jobToValues(MANUAL_JOB)));
    expect(isOk(back) && back.value).toEqual(MANUAL_JOB);
  });

  it('carries an application out and back unchanged', () => {
    const back = applicationFromRow(
      rowOf(TABLE_COLUMNS.applications, applicationToValues(APPLICATION)),
    );
    expect(isOk(back) && back.value).toEqual(APPLICATION);
  });

  it('carries a cv out and back unchanged', () => {
    const back = cvFromRow(rowOf(TABLE_COLUMNS.cvs, cvToValues(CV)));
    expect(isOk(back) && back.value).toEqual(CV);
  });

  it('carries an analysis out and back with result_json as a real object', () => {
    const values = analysisToValues(ANALYSIS);
    expect(isOk(values)).toBe(true);
    if (!isOk(values)) return;

    const back = analysisFromRow(rowOf(TABLE_COLUMNS.analyses, values.value));
    expect(isOk(back) && back.value).toEqual(ANALYSIS);
    expect(isOk(back) && typeof back.value.result_json).toBe('object');
  });
});

describe('result_json crosses the boundary as TEXT', () => {
  it('is written as a JSON string, never as an object', () => {
    const values = analysisToValues(ANALYSIS);
    expect(isOk(values)).toBe(true);
    if (!isOk(values)) return;

    const written = rowOf(TABLE_COLUMNS.analyses, values.value)['result_json'];
    expect(typeof written).toBe('string');
    expect(JSON.parse(String(written))).toEqual(CV_ANALYSIS);
  });

  it('refuses a result_json that cannot be serialised', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    const result = analysisToValues({
      ...ANALYSIS,
      result_json: circular as unknown as CvAnalysis,
    });
    expect(isErr(result) && result.error.code).toBe('SERIALISE_FAILED');
  });

  it('refuses a result_json column that is not text', () => {
    const result = analysisFromRow(analysisRow({ result_json: 42 }));
    expect(isErr(result) && result.error.code).toBe('MALFORMED_ROW');
  });

  it('refuses a result_json column that is not valid JSON', () => {
    const result = analysisFromRow(analysisRow({ result_json: '{not json' }));
    expect(isErr(result) && result.error.code).toBe('MALFORMED_ROW');
  });

  it('refuses the literal string "null", which parses but is not an object', () => {
    const result = analysisFromRow(analysisRow({ result_json: 'null' }));
    expect(isErr(result) && result.error.code).toBe('MALFORMED_ROW');
  });
});

// --- Null and absence -------------------------------------------------------

describe('null handling', () => {
  it('reads a missing nullable column as null, not undefined', () => {
    const row = jobRow();
    delete row['location'];

    const result = jobFromRow(row);
    expect(isOk(result) && result.value.location).toBeNull();
    expect(isOk(result) && 'location' in result.value).toBe(true);
  });

  it('refuses a missing NOT NULL column instead of inventing a value', () => {
    const row = jobRow();
    delete row['title'];

    const result = jobFromRow(row);
    expect(isErr(result) && result.error.code).toBe('MALFORMED_ROW');
    expect(isErr(result) && result.error.table).toBe('jobs');
  });

  it('keeps an empty string distinct from null', () => {
    const back = jobFromRow(jobRow({ description: '' }));
    expect(isOk(back) && back.value.description).toBe('');
  });

  it('keeps a zero salary distinct from null', () => {
    const back = jobFromRow(jobRow({ salary_min: 0 }));
    expect(isOk(back) && back.value.salary_min).toBe(0);
  });

  it('refuses a row that is not an object at all', () => {
    expect(isErr(jobFromRow(null))).toBe(true);
    expect(isErr(jobFromRow([]))).toBe(true);
    expect(isErr(jobFromRow('jobs'))).toBe(true);
  });
});

// --- Negative and boundary --------------------------------------------------

describe('values the schema forbids', () => {
  it('refuses a source outside the closed set', () => {
    const result = jobFromRow(jobRow({ source: 'monster' }));
    expect(isErr(result) && result.error.code).toBe('MALFORMED_ROW');
  });

  it('refuses a status outside the five board columns', () => {
    const result = applicationFromRow(applicationRow({ status: 'ghosted' }));
    expect(isErr(result) && result.error.code).toBe('MALFORMED_ROW');
    expect(isErr(result) && result.error.table).toBe('applications');
  });

  it('refuses a salary_period outside year/day/hour', () => {
    expect(isErr(jobFromRow(jobRow({ salary_period: 'month' })))).toBe(true);
  });

  it('refuses a timestamp carrying a local offset instead of UTC', () => {
    expect(isErr(jobFromRow(jobRow({ created_at: '2026-08-19T09:00:00+01:00' })))).toBe(true);
  });

  it('refuses a date that is not strict YYYY-MM-DD', () => {
    expect(isErr(jobFromRow(jobRow({ posted_date: '2026-8-9' })))).toBe(true);
  });

  it('refuses an impossible calendar date', () => {
    expect(isErr(jobFromRow(jobRow({ posted_date: '2026-02-30' })))).toBe(true);
  });
});

describe('match_score boundaries', () => {
  it('accepts the lowest and highest legal scores', () => {
    for (const score of [0, 100]) {
      const result = analysisFromRow(analysisRow({ match_score: score }));
      expect(isOk(result) && result.value.match_score).toBe(score);
    }
  });

  it('refuses a score just outside the legal range', () => {
    for (const score of [-1, 101]) {
      expect(isErr(analysisFromRow(analysisRow({ match_score: score })))).toBe(true);
    }
  });

  it('refuses a fractional score, which SQLite would happily store', () => {
    expect(isErr(analysisFromRow(analysisRow({ match_score: 72.5 })))).toBe(true);
  });
});

describe('nullable foreign keys', () => {
  it('accepts a job-agnostic analysis with a null job_id', () => {
    const result = analysisFromRow(analysisRow({ job_id: null }));
    expect(isOk(result) && result.value.job_id).toBeNull();
  });

  it('refuses an analysis with no cv_id, which is not nullable', () => {
    expect(isErr(analysisFromRow(analysisRow({ cv_id: null })))).toBe(true);
  });
});
