/**
 * The ONLY place SQLite values and domain objects are converted into each
 * other.
 *
 * Everything above this file works with `Job`, `Application`, `Cv` and
 * `Analysis` from `@cviper/core-types`. Everything below it works with the
 * flat, nullable, text-and-number values SQLite can actually hold. Two
 * mismatches make that boundary worth isolating rather than spreading around:
 *
 *   1. **null vs undefined.** SQLite has NULL and nothing else; the data model
 *      spells absence as `| null`, never an optional property. A driver that
 *      omits a column hands back `undefined`, and `exactOptionalPropertyTypes`
 *      is on, so `undefined` is not quietly interchangeable with `null`. Every
 *      row is normalised through `normalise()` before it is validated.
 *   2. **`analyses.result_json`.** It is a TEXT column in the database and a
 *      real nested object in the app and in the export file. It is
 *      `JSON.parse`d on the way out and `JSON.stringify`d on the way in, here
 *      and nowhere else. Storing it as a double-escaped string in the export
 *      would make the user's backup unqueryable.
 *
 * Rows are validated with the Zod schemas from `@cviper/core-types` on the way
 * out. That is not paranoia about our own writes: a database file survives app
 * upgrades, hand-edits and half-finished imports, and a `source` of `"monster"`
 * or a `created_at` in local time would otherwise flow silently into the
 * export format the cloud app has to read.
 */
import {
  AnalysisSchema,
  ApplicationSchema,
  CvSchema,
  JobSchema,
  err,
  ok,
  type Analysis,
  type Application,
  type Cv,
  type Err,
  type Job,
  type Result,
} from '@cviper/core-types';

import { dbError, describeUnknown, type DbError } from './errors';

/** Everything SQLite can hand back for the columns this schema declares. */
export type SqlValue = string | number | null;

// --- Column lists -----------------------------------------------------------
//
// These are the load-bearing constants of this file. They are:
//
//   * the parameter order for every INSERT the query modules build,
//   * the key set every `*ToValues` is type-checked against (see the
//     `Record<(typeof X_COLUMNS)[number], SqlValue>` annotations below — adding
//     a column here and forgetting the value is a COMPILE error), and
//   * what `rows.test.ts` compares against the columns it parses out of
//     `0001_init.sql`, so a column added to the schema and not here fails the
//     suite instead of vanishing from every read.
//
// The order must match `0001_init.sql` exactly. The test asserts that too.

export const JOB_COLUMNS = [
  'id',
  'source',
  'external_id',
  'title',
  'company',
  'location',
  'salary_min',
  'salary_max',
  'salary_currency',
  'salary_period',
  'description',
  'url',
  'posted_date',
  'created_at',
] as const;

export const APPLICATION_COLUMNS = [
  'id',
  'job_id',
  'status',
  'applied_date',
  'notes',
  'next_action',
  'next_action_date',
  'updated_at',
] as const;

export const CV_COLUMNS = ['id', 'name', 'file_path', 'extracted_text', 'created_at'] as const;

export const ANALYSIS_COLUMNS = [
  'id',
  'cv_id',
  'job_id',
  'provider',
  'model',
  'match_score',
  'result_json',
  'created_at',
] as const;

export const TABLE_COLUMNS = {
  jobs: JOB_COLUMNS,
  applications: APPLICATION_COLUMNS,
  cvs: CV_COLUMNS,
  analyses: ANALYSIS_COLUMNS,
} as const;

export type TableName = keyof typeof TABLE_COLUMNS;

// --- Internals --------------------------------------------------------------

/**
 * The shape of a Zod failure, described structurally.
 *
 * `zod` is a dependency of `@cviper/core-types` and NOT of this app, so it
 * cannot be imported here — under pnpm's strict layout the import would not
 * even resolve. Matching the shape keeps the message formatting without
 * reaching for the package.
 */
interface SchemaFailure {
  readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
}

function describeIssues(failure: SchemaFailure): string {
  return failure.issues
    .map((issue) => {
      const where = issue.path.length > 0 ? issue.path.map(String).join('.') : '(row)';
      return `${where}: ${issue.message}`;
    })
    .join('; ');
}

function malformed(table: TableName, detail: string): Err<DbError> {
  return err(dbError('MALFORMED_ROW', `A row in "${table}" could not be read — ${detail}`, table));
}

/**
 * Reduce whatever the driver handed back to exactly the declared columns, with
 * absence spelled `null`.
 *
 * `?? null` collapses `undefined` and `null` together and NOTHING else: `0`,
 * `''` and `false` survive untouched. A salary of zero and an empty description
 * are real values, and turning either into `null` would be a silent data loss
 * that no other layer could detect.
 */
function normalise(
  raw: unknown,
  columns: readonly string[],
  table: TableName,
): Result<Record<string, unknown>, DbError> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return malformed(table, `expected a row object, got ${raw === null ? 'null' : typeof raw}.`);
  }

  const source = raw as Record<string, unknown>;
  const row: Record<string, unknown> = {};
  for (const column of columns) {
    row[column] = source[column] ?? null;
  }
  return ok(row);
}

/** `analyses.result_json`, TEXT -> object. */
function decodeResultJson(value: unknown): Result<unknown, DbError> {
  if (typeof value !== 'string') {
    return malformed(
      'analyses',
      `result_json is stored as TEXT but this row holds ${value === null ? 'null' : typeof value}.`,
    );
  }

  try {
    return ok(JSON.parse(value));
  } catch (cause) {
    return malformed('analyses', `result_json is not valid JSON: ${describeUnknown(cause)}`);
  }
}

/** `analyses.result_json`, object -> TEXT. */
function encodeResultJson(value: unknown): Result<string, DbError> {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch (cause) {
    return err(
      dbError(
        'SERIALISE_FAILED',
        `This analysis result cannot be saved — ${describeUnknown(cause)}`,
        'analyses',
      ),
    );
  }

  // `JSON.stringify` returns `undefined` — not a string, and not a throw — for
  // `undefined`, a function or a symbol. Storing that would put the literal
  // text "undefined" in a NOT NULL column.
  if (typeof text !== 'string') {
    return err(
      dbError(
        'SERIALISE_FAILED',
        'This analysis result cannot be saved — it did not serialise to JSON.',
        'analyses',
      ),
    );
  }

  return ok(text);
}

// --- Reads ------------------------------------------------------------------

export function jobFromRow(raw: unknown): Result<Job, DbError> {
  const row = normalise(raw, JOB_COLUMNS, 'jobs');
  if (!row.ok) return row;

  const parsed = JobSchema.safeParse(row.value);
  return parsed.success ? ok(parsed.data) : malformed('jobs', describeIssues(parsed.error));
}

export function applicationFromRow(raw: unknown): Result<Application, DbError> {
  const row = normalise(raw, APPLICATION_COLUMNS, 'applications');
  if (!row.ok) return row;

  const parsed = ApplicationSchema.safeParse(row.value);
  return parsed.success ? ok(parsed.data) : malformed('applications', describeIssues(parsed.error));
}

export function cvFromRow(raw: unknown): Result<Cv, DbError> {
  const row = normalise(raw, CV_COLUMNS, 'cvs');
  if (!row.ok) return row;

  const parsed = CvSchema.safeParse(row.value);
  return parsed.success ? ok(parsed.data) : malformed('cvs', describeIssues(parsed.error));
}

export function analysisFromRow(raw: unknown): Result<Analysis, DbError> {
  const row = normalise(raw, ANALYSIS_COLUMNS, 'analyses');
  if (!row.ok) return row;

  const result = decodeResultJson(row.value['result_json']);
  if (!result.ok) return result;

  const parsed = AnalysisSchema.safeParse({ ...row.value, result_json: result.value });
  return parsed.success ? ok(parsed.data) : malformed('analyses', describeIssues(parsed.error));
}

// --- Writes -----------------------------------------------------------------
//
// Each returns the bound parameters in `X_COLUMNS` order. The `Record<...>`
// annotation is the guard: TypeScript requires a value for every column and
// rejects one that is not a column, so the array and the SQL cannot drift.
//
// Three of the four cannot fail and so return the array directly. Only
// `analysisToValues` returns a `Result`, because it is the only one that has to
// serialise anything. Wrapping the other three in a `Result` for symmetry would
// add an `Err` branch that no input can reach and no test can cover.

export function jobToValues(job: Job): SqlValue[] {
  const row: Record<(typeof JOB_COLUMNS)[number], SqlValue> = {
    id: job.id,
    source: job.source,
    external_id: job.external_id,
    title: job.title,
    company: job.company,
    location: job.location,
    salary_min: job.salary_min,
    salary_max: job.salary_max,
    salary_currency: job.salary_currency,
    salary_period: job.salary_period,
    description: job.description,
    url: job.url,
    posted_date: job.posted_date,
    created_at: job.created_at,
  };
  return JOB_COLUMNS.map((column) => row[column]);
}

export function applicationToValues(application: Application): SqlValue[] {
  const row: Record<(typeof APPLICATION_COLUMNS)[number], SqlValue> = {
    id: application.id,
    job_id: application.job_id,
    status: application.status,
    applied_date: application.applied_date,
    notes: application.notes,
    next_action: application.next_action,
    next_action_date: application.next_action_date,
    updated_at: application.updated_at,
  };
  return APPLICATION_COLUMNS.map((column) => row[column]);
}

export function cvToValues(cv: Cv): SqlValue[] {
  const row: Record<(typeof CV_COLUMNS)[number], SqlValue> = {
    id: cv.id,
    name: cv.name,
    file_path: cv.file_path,
    extracted_text: cv.extracted_text,
    created_at: cv.created_at,
  };
  return CV_COLUMNS.map((column) => row[column]);
}

export function analysisToValues(analysis: Analysis): Result<SqlValue[], DbError> {
  const encoded = encodeResultJson(analysis.result_json);
  if (!encoded.ok) return encoded;

  const row: Record<(typeof ANALYSIS_COLUMNS)[number], SqlValue> = {
    id: analysis.id,
    cv_id: analysis.cv_id,
    job_id: analysis.job_id,
    provider: analysis.provider,
    model: analysis.model,
    match_score: analysis.match_score,
    result_json: encoded.value,
    created_at: analysis.created_at,
  };
  return ok(ANALYSIS_COLUMNS.map((column) => row[column]));
}

// --- Collections ------------------------------------------------------------

/**
 * Map a whole result set, refusing the LOT if any single row is unreadable.
 *
 * Deliberately all-or-nothing, matching `importBackup`'s atomicity: silently
 * skipping the bad row would show the user a list that is quietly missing an
 * application they know they saved, with nothing anywhere to say why.
 */
export function mapRows<T>(
  raw: unknown,
  fromRow: (row: unknown) => Result<T, DbError>,
): Result<T[], DbError> {
  if (!Array.isArray(raw)) {
    return err(dbError('MALFORMED_ROW', `Expected a list of rows, got ${typeof raw}.`));
  }

  const items: T[] = [];
  for (const row of raw) {
    const item = fromRow(row);
    if (!item.ok) return item;
    items.push(item.value);
  }
  return ok(items);
}
