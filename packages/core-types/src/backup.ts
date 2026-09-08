/**
 * The CViper Light export/import format, version 1.
 *
 * ============================================================================
 * ADDITIVE CHANGES ONLY. FOREVER.
 * ============================================================================
 * This file is the user's only way to get their data out of the app, and the
 * contract with the future cloud app. Once v1 has shipped:
 *
 *   - NEVER rename a field.
 *   - NEVER remove a field.
 *   - NEVER change a field's type or its meaning.
 *   - NEVER make an existing optional field required.
 *   - Adding a new field is allowed. Anything else is not.
 *   - ANY shape change bumps `BACKUP_SCHEMA_VERSION`.
 *
 * A file a user exported today must still import in five years. There is no
 * migration story for a format the user keeps in their own Documents folder.
 * ============================================================================
 *
 * On-disk shape:
 *
 * {
 *   "schemaVersion": 1,
 *   "exportedAt": "2026-08-19T09:00:00.000Z",
 *   "app": { "name": "cviper-light", "version": "0.1.0" },
 *   "jobs": [...], "applications": [...], "cvs": [...], "analyses": [...]
 * }
 */
import { z } from 'zod';

import {
  AnalysisSchema,
  ApplicationSchema,
  CvSchema,
  JobSchema,
  type Analysis,
  type Application,
  type Cv,
  type ExtraFields,
  type Job,
} from './entities';
import { err, ok, type Result } from './result';

/**
 * The one and only version gate.
 *
 * ==========================================================================
 * THE IMPORTER MUST NEVER READ `app`.
 * ==========================================================================
 * `app.name` and `app.version` are METADATA — they exist so a human staring
 * at a JSON file knows what wrote it, and for nothing else. Branching on them
 * is precisely the mistake the next contributor will make, and it is a bug
 * every time:
 *
 *   - `app.version` is the APP's version. It moves every release, including
 *     releases that do not touch this format at all.
 *   - `app.name` will be `cviper-cloud` (or whatever comes next) the moment
 *     another product writes a compatible file, and refusing that file defeats
 *     the entire point of having an interchange format.
 *
 * Compatibility is decided by `schemaVersion` ALONE. If you need to know
 * something about the file, put it in the schema and bump the version.
 * ==========================================================================
 */
export const BACKUP_SCHEMA_VERSION = 1;

/** Metadata only. See the warning on `BACKUP_SCHEMA_VERSION`. */
export interface BackupApp {
  name: string;
  version: string;
  /** @internal forward-compatibility bag — see `ExtraFields`. */
  __extra?: ExtraFields;
}

export interface BackupPayload {
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  app: BackupApp;
  jobs: Job[];
  applications: Application[];
  cvs: Cv[];
  analyses: Analysis[];
  /** @internal forward-compatibility bag — see `ExtraFields`. */
  __extra?: ExtraFields;
}

export type BackupErrorCode =
  /** The input was a string but not parseable JSON. */
  | 'MALFORMED_JSON'
  /** The input parsed but is not a JSON object (array, number, null, ...). */
  | 'NOT_AN_OBJECT'
  /** No usable `schemaVersion` — absent, or not a positive integer. */
  | 'SCHEMA_VERSION_MISSING'
  /** `schemaVersion` is higher than this build understands. */
  | 'SCHEMA_VERSION_TOO_NEW'
  /** A record failed validation. Import is atomic: NOTHING was imported. */
  | 'INVALID_RECORD';

export interface BackupError {
  readonly code: BackupErrorCode;
  /** Legible enough to show a user without further translation. */
  readonly message: string;
  /** Where the problem was, e.g. `applications[3].status`. `null` if global. */
  readonly path: string | null;
}

// --- Internals --------------------------------------------------------------

/**
 * The reserved key for the forward-compatibility bag.
 *
 * It is stripped from input (nobody smuggles one in) and never written to
 * output. `__extra` is a carrier, not data.
 */
const EXTRA_KEY = '__extra';

/**
 * Shape-validated so the `BackupApp` type is honest. The VALUES are never
 * compared against anything — see the warning on `BACKUP_SCHEMA_VERSION`.
 */
const BackupAppSchema = z.object({
  name: z.string(),
  version: z.string(),
});

/** Canonical top-level key order. `schemaVersion` is first, deliberately. */
const TOP_LEVEL_FIELDS = [
  'schemaVersion',
  'exportedAt',
  'app',
  'jobs',
  'applications',
  'cvs',
  'analyses',
] as const;

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function describeJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/** The keys we did not recognise, or `undefined` if there were none. */
function splitExtras(
  record: Record<string, unknown>,
  known: readonly string[],
): ExtraFields | undefined {
  const extra: Record<string, unknown> = {};
  let found = false;
  for (const key of Object.keys(record)) {
    if (key === EXTRA_KEY || known.includes(key)) continue;
    extra[key] = record[key];
    found = true;
  }
  return found ? extra : undefined;
}

function attachExtras<T extends object>(value: T, extra: ExtraFields | undefined): T {
  return extra === undefined ? value : { ...value, __extra: extra };
}

/**
 * Spread the bag back out at the level it came from.
 *
 * Extra keys are emitted in sorted order and never allowed to shadow a known
 * field, so the output is stable and a stray `id` in someone's extras cannot
 * corrupt a record.
 *
 * Known caveat: JavaScript orders integer-like keys ahead of everything else
 * in an object, so an extra field literally named `"0"` at the top level would
 * be serialised before `schemaVersion`. No real producer emits such a field,
 * and defending against it would mean hand-rolling the serialiser.
 */
function withExtras(
  known: Record<string, unknown>,
  extra: ExtraFields | undefined,
): Record<string, unknown> {
  if (extra === undefined) return known;
  const merged: Record<string, unknown> = { ...known };
  for (const key of Object.keys(extra).sort()) {
    if (key === EXTRA_KEY || key in known) continue;
    merged[key] = extra[key];
  }
  return merged;
}

/**
 * Sort by `id` with a plain codepoint comparison.
 *
 * NOT `localeCompare`: that is locale-dependent, so the same data would export
 * in a different order on a machine set to a different language, and
 * "deterministic" would quietly stop being true.
 */
function byId<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    if (left.id < right.id) return -1;
    return left.id > right.id ? 1 : 0;
  });
}

// Each emitter lists its entity's fields explicitly, in canonical order. A
// field added to an entity but not to its emitter would silently vanish from
// every export, so a test asserts these lists match the Zod schemas exactly.

function emitJob(job: Job): Record<string, unknown> {
  return withExtras(
    {
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
    },
    job.__extra,
  );
}

function emitApplication(application: Application): Record<string, unknown> {
  return withExtras(
    {
      id: application.id,
      job_id: application.job_id,
      status: application.status,
      applied_date: application.applied_date,
      notes: application.notes,
      next_action: application.next_action,
      next_action_date: application.next_action_date,
      updated_at: application.updated_at,
    },
    application.__extra,
  );
}

function emitCv(cv: Cv): Record<string, unknown> {
  return withExtras(
    {
      id: cv.id,
      name: cv.name,
      file_path: cv.file_path,
      extracted_text: cv.extracted_text,
      created_at: cv.created_at,
      json_resume: cv.json_resume,
    },
    cv.__extra,
  );
}

function emitAnalysis(analysis: Analysis): Record<string, unknown> {
  return withExtras(
    {
      id: analysis.id,
      cv_id: analysis.cv_id,
      job_id: analysis.job_id,
      provider: analysis.provider,
      model: analysis.model,
      match_score: analysis.match_score,
      result_json: analysis.result_json,
      created_at: analysis.created_at,
    },
    analysis.__extra,
  );
}

// --- Export -----------------------------------------------------------------

/**
 * Serialise a payload to the exact bytes that go on disk.
 *
 * Deterministic: the same data always produces the same string. Collections
 * are sorted by `id` and keys are emitted in a fixed order, so a user syncing
 * their export folder does not get a spurious diff every time.
 *
 * `exportedAt` is taken from the payload rather than read off the clock —
 * otherwise no two exports could ever be identical and the guarantee above
 * would be meaningless.
 */
export function exportBackup(payload: BackupPayload): string {
  const document = withExtras(
    {
      schemaVersion: payload.schemaVersion,
      exportedAt: payload.exportedAt,
      app: withExtras(
        { name: payload.app.name, version: payload.app.version },
        payload.app.__extra,
      ),
      jobs: byId(payload.jobs).map(emitJob),
      applications: byId(payload.applications).map(emitApplication),
      cvs: byId(payload.cvs).map(emitCv),
      analyses: byId(payload.analyses).map(emitAnalysis),
    },
    payload.__extra,
  );

  return `${JSON.stringify(document, null, 2)}\n`;
}

// --- Import -----------------------------------------------------------------

function toDocument(raw: unknown): Result<Record<string, unknown>, BackupError> {
  let value = raw;

  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch (cause) {
      return err({
        code: 'MALFORMED_JSON',
        message: `This file is not valid JSON, so it cannot be read: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        path: null,
      });
    }
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return err({
      code: 'NOT_AN_OBJECT',
      message: `A backup must be a JSON object, but this file contains ${describeJsonType(value)}.`,
      path: null,
    });
  }

  return ok(value as Record<string, unknown>);
}

function readSchemaVersion(value: unknown): Result<number, BackupError> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return err({
      code: 'SCHEMA_VERSION_MISSING',
      message: `This file has no usable "schemaVersion" (found ${describeJsonType(
        value,
      )}). It may not be a CViper backup.`,
      path: 'schemaVersion',
    });
  }

  if (value > BACKUP_SCHEMA_VERSION) {
    return err({
      code: 'SCHEMA_VERSION_TOO_NEW',
      message: `This backup was written in format version ${value}, but this build of CViper Light understands version ${BACKUP_SCHEMA_VERSION}. Update the app, then import it again.`,
      path: 'schemaVersion',
    });
  }

  return ok(value);
}

/**
 * Validate one collection. Returns on the FIRST bad record without keeping any
 * of the good ones — the caller relies on that for atomicity.
 */
function readCollection<TSchema extends z.ZodObject>(
  document: Record<string, unknown>,
  key: string,
  schema: TSchema,
): Result<Array<z.infer<TSchema>>, BackupError> {
  const raw = document[key];

  if (!Array.isArray(raw)) {
    return err({
      code: 'INVALID_RECORD',
      message: `A backup must contain a "${key}" array, but this file has ${describeJsonType(raw)}.`,
      path: key,
    });
  }

  // Derived from the schema, so the extras split can never drift from the
  // fields the validator actually knows about.
  const known = Object.keys(schema.shape);
  const records: Array<z.infer<TSchema>> = [];

  for (const [index, item] of raw.entries()) {
    const parsed = schema.safeParse(item);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const suffix = issue && issue.path.length > 0 ? `.${issue.path.join('.')}` : '';
      return err({
        code: 'INVALID_RECORD',
        message: `${key}[${index}] could not be read:\n${z.prettifyError(parsed.error)}`,
        path: `${key}[${index}]${suffix}`,
      });
    }

    records.push(attachExtras(parsed.data, splitExtras(toRecord(item), known)));
  }

  return ok(records);
}

/**
 * Validate and load a backup. ATOMIC: on any failure nothing is imported, so a
 * half-good file can never leave the user with a half-populated database. The
 * whole payload is built before anything is returned, and a failure returns an
 * `Err` that carries no partial data at all.
 */
export function importBackup(raw: unknown): Result<BackupPayload, BackupError> {
  const document = toDocument(raw);
  if (!document.ok) return err(document.error);

  // THE VERSION GATE RUNS FIRST, before a single record is looked at. A file
  // from the future must be refused, not partially understood.
  const version = readSchemaVersion(document.value['schemaVersion']);
  if (!version.ok) return err(version.error);

  const exportedAt = z.iso.datetime().safeParse(document.value['exportedAt']);
  if (!exportedAt.success) {
    return err({
      code: 'INVALID_RECORD',
      message: '"exportedAt" must be an ISO-8601 UTC timestamp such as 2026-08-19T09:00:00.000Z.',
      path: 'exportedAt',
    });
  }

  const rawApp = document.value['app'];
  const parsedApp = BackupAppSchema.safeParse(rawApp);
  if (!parsedApp.success) {
    return err({
      code: 'INVALID_RECORD',
      message: '"app" must be an object with a "name" and a "version" string.',
      path: 'app',
    });
  }
  const app = attachExtras(
    parsedApp.data,
    splitExtras(toRecord(rawApp), Object.keys(BackupAppSchema.shape)),
  );

  const jobs = readCollection(document.value, 'jobs', JobSchema);
  if (!jobs.ok) return err(jobs.error);

  const applications = readCollection(document.value, 'applications', ApplicationSchema);
  if (!applications.ok) return err(applications.error);

  const cvs = readCollection(document.value, 'cvs', CvSchema);
  if (!cvs.ok) return err(cvs.error);

  const analyses = readCollection(document.value, 'analyses', AnalysisSchema);
  if (!analyses.ok) return err(analyses.error);

  const extra = splitExtras(document.value, TOP_LEVEL_FIELDS);

  return ok({
    // `readSchemaVersion` accepts exactly one value, so this is that value.
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: exportedAt.data,
    app,
    jobs: jobs.value,
    applications: applications.value,
    cvs: cvs.value,
    analyses: analyses.value,
    ...(extra === undefined ? {} : { __extra: extra }),
  });
}
