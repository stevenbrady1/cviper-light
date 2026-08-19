/**
 * Export and import, from the view's side of the line.
 *
 * The pure half of the format lives in `@cviper/core-types` (`exportBackup` /
 * `importBackup`) and the I/O half in `src/db/backup.ts` (`readAll` /
 * `writeAll`). Neither is duplicated here. What this file owns is the part that
 * is neither: the SENTENCES, and the two constants that go on the file.
 */
import { readAll, writeAll, type DbError, type DbSnapshot } from '../../db';
import { type BackupErrorCode, type BackupError, type Result } from '@cviper/core-types';

/**
 * What goes in the file's `app` block.
 *
 * ============================================================================
 * METADATA ONLY. THE IMPORTER MUST NEVER READ IT.
 * ============================================================================
 * See the warning on `BACKUP_SCHEMA_VERSION` in `@cviper/core-types`:
 * compatibility is decided by `schemaVersion` alone. These two strings exist so
 * a human staring at a JSON file knows what wrote it, and for nothing else.
 *
 * `APP_VERSION` is hand-written and therefore drifts. `backup.test.ts` reads
 * `package.json` and asserts they agree, so it can only drift deliberately.
 */
export const APP_NAME = 'cviper-light';
export const APP_VERSION = '0.1.0';

/**
 * Every `BackupErrorCode`, as a value.
 *
 * The type is a union and unions do not exist at runtime, so a table keyed by
 * one can be complete and a LOOP over one cannot — without this, a test that
 * checks "every code has its own message" would silently check only the codes
 * somebody remembered to list. Typed as the union so a code added upstream
 * fails to compile here.
 */
export const BACKUP_ERROR_CODES = [
  'MALFORMED_JSON',
  'NOT_AN_OBJECT',
  'SCHEMA_VERSION_MISSING',
  'SCHEMA_VERSION_TOO_NEW',
  'INVALID_RECORD',
] as const satisfies readonly BackupErrorCode[];

/** What the user is told, in two parts: the headline, then the specifics. */
export interface BackupProblem {
  /** One sentence naming what went wrong. Never "invalid file". */
  readonly headline: string;
  /** The upstream explanation, plus what to do about it. */
  readonly detail: string;
}

/**
 * The headline for each code.
 *
 * ============================================================================
 * FIVE CODES, FIVE DIFFERENT SENTENCES, AND ONE OF THEM MATTERS MOST.
 * ============================================================================
 * `SCHEMA_VERSION_TOO_NEW` means the user's file is FINE and this build is old.
 * Reporting that as "the file is damaged" — which one generic message would —
 * invites somebody to delete the only copy of months of work. So it says
 * plainly that the file came from a newer version of CViper Light, and that the
 * fix is to update the app.
 *
 * Keyed by the union, so a code added upstream is a compile error rather than a
 * silent fall-through to a generic sentence.
 */
const HEADLINES: Record<BackupErrorCode, string> = {
  MALFORMED_JSON:
    'That file is damaged — it is not readable as JSON, so nothing in it could be recovered.',
  NOT_AN_OBJECT: 'That file is readable, but it is not shaped like a CViper backup at all.',
  SCHEMA_VERSION_MISSING:
    'That file has no format version in it, so it is probably not a CViper backup.',
  SCHEMA_VERSION_TOO_NEW:
    'That backup was written by a newer version of CViper Light than this one.',
  INVALID_RECORD: 'One of the records in that file could not be read.',
};

/** The advice for each code, appended after the upstream explanation. */
const ADVICE: Record<BackupErrorCode, string> = {
  MALFORMED_JSON:
    'If you have another copy, try that one. A file that was still being written when the ' +
    'machine shut down often ends up like this.',
  NOT_AN_OBJECT: 'Check you picked the file CViper exported, rather than another .json file.',
  SCHEMA_VERSION_MISSING:
    'Check you picked the file CViper exported, rather than another .json file.',
  SCHEMA_VERSION_TOO_NEW:
    'Update CViper Light and import it again. Your file is fine — do not delete it. ' +
    'Nothing has been imported.',
  INVALID_RECORD:
    'Nothing has been imported: an import is all-or-nothing, so your existing data is ' +
    'exactly as it was.',
};

export function describeBackupError(error: BackupError): BackupProblem {
  const upstream = error.message.trim();

  return {
    headline: HEADLINES[error.code],
    // The upstream message names the exact record and field that failed
    // (`applications[3].status`), which is the only way anyone could fix a
    // hand-edited file. Kept, and followed by what to do.
    detail: upstream === '' ? ADVICE[error.code] : `${upstream}\n\n${ADVICE[error.code]}`,
  };
}

/** How many of each thing a snapshot or payload holds. */
export interface BackupCounts {
  readonly jobs: number;
  readonly applications: number;
  readonly cvs: number;
  readonly analyses: number;
}

/** "3 jobs and 1 CV". Categories with nothing in them are left out entirely. */
export function describeCounts(counts: BackupCounts): string {
  const parts = [
    [counts.jobs, 'job', 'jobs'],
    [counts.applications, 'application', 'applications'],
    [counts.cvs, 'CV', 'CVs'],
    // Called "past checks" rather than "analyses", which is the word used
    // everywhere the user can see one.
    [counts.analyses, 'past check', 'past checks'],
  ] as const;

  const phrases = parts
    .filter(([count]) => count > 0)
    .map(([count, singular, plural]) => `${count} ${count === 1 ? singular : plural}`);

  // An empty file is a real thing to import — somebody exported before they had
  // entered anything — and "This will add ." is not a sentence.
  if (phrases.length === 0) return 'nothing at all';
  if (phrases.length === 1) return phrases[0] ?? '';

  const last = phrases[phrases.length - 1];
  return `${phrases.slice(0, -1).join(', ')} and ${last}`;
}

/** `cviper-backup-2026-08-19.json` — dated, so a folder of them sorts itself. */
export function defaultBackupFilename(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  // LOCAL date parts, not `toISOString()`. A user in Sydney saving at 09:00 on
  // the 19th must not get a file named the 18th.
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `cviper-backup-${stamp}.json`;
}

/**
 * The two things Settings does to storage.
 *
 * Same reasoning as the other feature ports: `src/db` needs a Tauri runtime a
 * Vitest process does not have, and naming the whole appetite in one place
 * keeps it small. Everything underneath — the single transaction, the
 * parents-first write order — belongs to `db/backup.ts` and is not repeated.
 */
export interface BackupPort {
  read(): Promise<Result<DbSnapshot, DbError>>;
  write(snapshot: DbSnapshot): Promise<Result<void, DbError>>;
}

export function createDbBackupPort(): BackupPort {
  return { read: readAll, write: writeAll };
}
