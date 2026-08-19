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
import { type Analysis, type Application, type Cv, type ExtraFields, type Job } from './entities';
import { type Result } from './result';

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

/**
 * Serialise a payload to the exact bytes that go on disk.
 *
 * Deterministic: the same data always produces the same string. Collections
 * are sorted by `id` and keys are emitted in a fixed order, so a user syncing
 * their export folder does not get a spurious diff every time.
 */
export function exportBackup(_payload: BackupPayload): string {
  throw new Error('NOT_IMPLEMENTED: exportBackup');
}

/**
 * Validate and load a backup. ATOMIC: on any failure nothing is imported, so a
 * half-good file can never leave the user with a half-populated database.
 */
export function importBackup(_raw: unknown): Result<BackupPayload, BackupError> {
  throw new Error('NOT_IMPLEMENTED: importBackup');
}
