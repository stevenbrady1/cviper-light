/**
 * The CViper Light data model — four entities.
 *
 * TWO ABSOLUTE CONVENTIONS:
 *
 *   1. Every timestamp is an ISO-8601 UTC string: `2026-08-19T09:00:00.000Z`.
 *   2. Every date is a `YYYY-MM-DD` string: `2026-08-19`.
 *
 * THERE ARE NO `Date` OBJECTS ANYWHERE in the persisted or exported layer. A
 * `Date` does not survive `JSON.stringify` -> `JSON.parse` as a `Date`, and
 * SQLite has no date type at all, so a `Date` that leaks in here comes back out
 * as a string on one path and an object on another. That mismatch is the
 * number-one cause of round-trip failures, so the type system forbids it and
 * the import validators reject anything that is not the exact string form.
 *
 * NULLABILITY: absent values are `| null`, never optional `?`. A field that is
 * always present but sometimes empty is easier to store, serialise and diff
 * than one that may or may not exist. The single exception is `__extra`, which
 * is a forward-compatibility mechanism rather than data — see `ExtraFields`.
 */
import { z } from 'zod';

import { CvAnalysisSchema, type CvAnalysis } from './analysis';

/** ISO-8601 UTC instant, e.g. `2026-08-19T09:00:00.000Z`. Never a `Date`. */
export type IsoTimestamp = string;

/** Calendar date, `YYYY-MM-DD`, e.g. `2026-08-19`. Never a `Date`. */
export type IsoDate = string;

/**
 * Unrecognised fields carried through a backup round-trip untouched.
 *
 * INTERNAL. Populated only by `importBackup` and consumed only by
 * `exportBackup`. It is never written to the database, never shown to the
 * user, and `__extra` never appears as a key in an exported file — the
 * exporter spreads its contents back out at the level they came from.
 *
 * This is what lets a user move a file between CViper Light and the cloud app
 * without the smaller of the two silently eating the other's fields.
 */
export type ExtraFields = Readonly<Record<string, unknown>>;

export type JobSource = 'adzuna' | 'reed' | 'manual' | 'linkedin' | 'indeed';

/**
 * The unit `salary_min` / `salary_max` are quoted in.
 *
 * DELIBERATE ADDITION to the original spec. Reed returns salary figures with
 * no period unit attached, so a contract advertised at GBP 457-550 is a DAY
 * RATE that is byte-for-byte indistinguishable from an insulting annual
 * salary. Without this field the app confidently shows a good contract role as
 * a terrible permanent one. `null` means the source did not say — show the
 * figures unqualified rather than guessing.
 */
export type SalaryPeriod = 'year' | 'day' | 'hour';

/**
 * Application pipeline state. EXACTLY THESE FIVE STRINGS — no more.
 *
 * These map 1:1 onto the CViper web app's five board columns:
 *
 *   saved        -> not_applied
 *   applied      -> applied
 *   interviewing -> in_progress
 *   offer        -> offer
 *   rejected     -> rejected
 *
 * so an export from Light folds into the cloud app without a translation
 * table. Adding a sixth status here breaks that property and needs a
 * `schemaVersion` bump plus a decision on the cloud side. Do not change these
 * strings.
 */
export type ApplicationStatus = 'saved' | 'applied' | 'interviewing' | 'offer' | 'rejected';

export interface Job {
  id: string;
  source: JobSource;
  /** The provider's own id. `null` for `source: 'manual'`. */
  external_id: string | null;
  title: string;
  company: string;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  /** ISO-4217, e.g. `GBP`. */
  salary_currency: string | null;
  /** See `SalaryPeriod` — `null` means the source did not say. */
  salary_period: SalaryPeriod | null;
  description: string | null;
  url: string | null;
  posted_date: IsoDate | null;
  created_at: IsoTimestamp;
  /** @internal forward-compatibility bag — see `ExtraFields`. */
  __extra?: ExtraFields;
}

export interface Application {
  id: string;
  job_id: string;
  status: ApplicationStatus;
  applied_date: IsoDate | null;
  notes: string | null;
  next_action: string | null;
  next_action_date: IsoDate | null;
  updated_at: IsoTimestamp;
  /** @internal forward-compatibility bag — see `ExtraFields`. */
  __extra?: ExtraFields;
}

export interface Cv {
  id: string;
  name: string;
  /** Absolute path on this machine. `null` if the text was pasted in. */
  file_path: string | null;
  /** `null` until parsing has run. */
  extracted_text: string | null;
  created_at: IsoTimestamp;
  /** @internal forward-compatibility bag — see `ExtraFields`. */
  __extra?: ExtraFields;
}

export interface Analysis {
  id: string;
  cv_id: string;
  /** `null` for a job-agnostic CV review. */
  job_id: string | null;
  /** e.g. `ollama`, `anthropic`, `keyword`. */
  provider: string;
  /** e.g. `llama3.2:3b`. */
  model: string;
  match_score: number;
  /**
   * Stored as a JSON TEXT column in SQLite (hence the name) but modelled and
   * exported as a structured object, so the export file stays queryable
   * instead of carrying a double-escaped string.
   */
  result_json: CvAnalysis;
  created_at: IsoTimestamp;
  /** @internal forward-compatibility bag — see `ExtraFields`. */
  __extra?: ExtraFields;
}

// --- Zod representations ----------------------------------------------------
// The import validators, and the single source of truth for "which fields does
// this entity have" — the exporter is checked against these shapes by a test,
// so a column added here can never be silently dropped on the way out.

/**
 * `z.iso.datetime()` accepts `2026-08-19T09:00:00Z` and `...T09:00:00.000Z`
 * and REJECTS an offset such as `+01:00`. That is the point: UTC-only is the
 * stated convention, and quietly accepting a local-time string would give the
 * cloud app a timestamp it cannot compare against the rest.
 */
const isoTimestamp = z.iso.datetime();

/** Strict `YYYY-MM-DD`. Rejects `2026-8-9` and impossible dates like `2026-02-30`. */
const isoDate = z.iso.date();

export const JobSchema = z.object({
  id: z.string(),
  source: z.enum(['adzuna', 'reed', 'manual', 'linkedin', 'indeed']),
  external_id: z.string().nullable(),
  title: z.string(),
  company: z.string(),
  location: z.string().nullable(),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  salary_currency: z.string().nullable(),
  salary_period: z.enum(['year', 'day', 'hour']).nullable(),
  description: z.string().nullable(),
  url: z.string().nullable(),
  posted_date: isoDate.nullable(),
  created_at: isoTimestamp,
});

export const ApplicationSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  status: z.enum(['saved', 'applied', 'interviewing', 'offer', 'rejected']),
  applied_date: isoDate.nullable(),
  notes: z.string().nullable(),
  next_action: z.string().nullable(),
  next_action_date: isoDate.nullable(),
  updated_at: isoTimestamp,
});

export const CvSchema = z.object({
  id: z.string(),
  name: z.string(),
  file_path: z.string().nullable(),
  extracted_text: z.string().nullable(),
  created_at: isoTimestamp,
});

export const AnalysisSchema = z.object({
  id: z.string(),
  cv_id: z.string(),
  job_id: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
  match_score: z.number().int().min(0).max(100),
  result_json: CvAnalysisSchema,
  created_at: isoTimestamp,
});

/** Fails to compile if a schema and its hand-written interface drift apart. */
type AssertAssignable<TActual extends TExpected, TExpected> = TActual;

export type _JobSchemaMatchesType = AssertAssignable<z.infer<typeof JobSchema>, Job>;
export type _JobTypeMatchesSchema = AssertAssignable<Job, z.infer<typeof JobSchema>>;
export type _ApplicationSchemaMatchesType = AssertAssignable<
  z.infer<typeof ApplicationSchema>,
  Application
>;
export type _ApplicationTypeMatchesSchema = AssertAssignable<
  Application,
  z.infer<typeof ApplicationSchema>
>;
export type _CvSchemaMatchesType = AssertAssignable<z.infer<typeof CvSchema>, Cv>;
export type _CvTypeMatchesSchema = AssertAssignable<Cv, z.infer<typeof CvSchema>>;
export type _AnalysisSchemaMatchesType = AssertAssignable<z.infer<typeof AnalysisSchema>, Analysis>;
export type _AnalysisTypeMatchesSchema = AssertAssignable<Analysis, z.infer<typeof AnalysisSchema>>;
