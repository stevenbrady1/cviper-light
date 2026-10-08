/**
 * Every Microsoft Store upload, recorded, and the rule that the next one is
 * higher (L-170).
 *
 * ============================================================================
 * WHY EQUALITY IS NOT ENOUGH
 * ============================================================================
 * `appxManifestVersion.ts` (L-168, L-169) pins the manifest's
 * `Identity/@Version` to `tauri.conf.json`: EQUAL. The Store's rule is a
 * different one — each upload must be STRICTLY GREATER than every version it
 * has already been sent. Equality alone would actively demand a Store-fatal
 * value in the two normal ways a release history bends:
 *
 *   - a ROLLBACK: the app version reverted to one already uploaded — the
 *     manifest follows it down, and the Store refuses it as not-higher;
 *   - a RESUBMISSION: an upload rejected at certification, fixed without a
 *     version bump — the same version again, refused the same way.
 *
 * ============================================================================
 * THE RECORD, AND THE TWO MOMENTS IT IS READ
 * ============================================================================
 * `store-submissions.json` lists every version uploaded to Partner Center,
 * oldest first. The owner adds a line the day they upload (see
 * docs/STORE-SUBMISSION.md) — a rejected upload included, because the Store
 * remembers it too. It is a committed file, not a value read back from a
 * workflow run: the record has to outlive the 90 days Actions keeps a run.
 *
 *   - EVERY COMMIT (`storeSubmissions.contract.test.ts`): the record is well
 *     formed and in order, and the app version is never BELOW the last
 *     upload. Equal is allowed — that is the state right after an upload.
 *   - PACK TIME (`checkAppxManifestVersion.ts`, run by `msix.yml`): the
 *     manifest about to be packed is strictly ABOVE the last upload. The
 *     package the workflow builds is the one that gets submitted, so packing
 *     a version the Store has already seen is refused here, not at Partner
 *     Center.
 *
 * A record that cannot be read never counts as "no uploads yet": that would
 * turn a broken file into a silently passing check.
 */
import {
  MAX_SEGMENT_VALUE,
  checkStagedManifest,
  type StagedManifestInput,
} from './appxManifestVersion.ts';

export const SUBMISSIONS_PATH = 'apps/light/src-tauri/msix/store-submissions.json';

export interface StoreSubmission {
  /** The manifest `Identity/@Version` uploaded: four parts, the last `0`. */
  readonly version: string;
  /** The day it was uploaded, `YYYY-MM-DD`. */
  readonly date: string;
}

export type SubmissionsResult =
  | { readonly ok: true; readonly submissions: readonly StoreSubmission[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Four segments, the last exactly `0`, no leading zeros — what the Store takes. */
const STORE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.0$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function segments(version: string): number[] {
  return version.split('.').map(Number);
}

/** -1, 0 or 1, comparing segment by segment as numbers: `0.10` is above `0.9`. */
export function compareManifestVersions(left: string, right: string): -1 | 0 | 1 {
  const a = segments(left);
  const b = segments(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function versionProblem(version: unknown, where: string): string | null {
  if (typeof version !== 'string' || !STORE_VERSION.test(version)) {
    return (
      `${SUBMISSIONS_PATH}: ${where} has version ${JSON.stringify(version)}, which is not a ` +
      'Store version — four numbers, the last 0, no leading zeros (e.g. "0.6.0.0").'
    );
  }
  if (segments(version).some((segment) => segment > MAX_SEGMENT_VALUE)) {
    return (
      `${SUBMISSIONS_PATH}: ${where} has version "${version}", with a number above ` +
      `${MAX_SEGMENT_VALUE}, which MSIX cannot hold.`
    );
  }
  return null;
}

/** The record, checked: well formed, every version Store-shaped, oldest first, each higher. */
export function parseSubmissions(json: string): SubmissionsResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    return {
      ok: false,
      problems: [
        `${SUBMISSIONS_PATH} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      ],
    };
  }
  const list = (parsed as { submissions?: unknown } | null)?.submissions;
  if (typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(list)) {
    return {
      ok: false,
      problems: [`${SUBMISSIONS_PATH} must be an object with a "submissions" list.`],
    };
  }

  const problems: string[] = [];
  const submissions: StoreSubmission[] = [];
  list.forEach((entry: unknown, index) => {
    const where = `entry ${index + 1}`;
    const { version, date } = (entry ?? {}) as { version?: unknown; date?: unknown };
    const versionIssue = versionProblem(version, where);
    if (versionIssue !== null) problems.push(versionIssue);
    if (typeof date !== 'string' || !DAY.test(date)) {
      problems.push(
        `${SUBMISSIONS_PATH}: ${where} has date ${JSON.stringify(date)}; write the upload day ` +
          'as YYYY-MM-DD.',
      );
    }
    if (versionIssue !== null || typeof version !== 'string' || typeof date !== 'string') return;

    const previous = submissions.at(-1);
    if (previous !== undefined && compareManifestVersions(version, previous.version) <= 0) {
      problems.push(
        `${SUBMISSIONS_PATH}: ${where} (${version}) is not above the upload before it ` +
          `(${previous.version}). The Store never accepted that order; add new uploads at the end.`,
      );
    }
    submissions.push({ version, date });
  });

  return problems.length > 0 ? { ok: false, problems } : { ok: true, submissions };
}

function last(submissions: readonly StoreSubmission[]): StoreSubmission | null {
  return submissions.at(-1) ?? null;
}

/**
 * EVERY COMMIT: the app's manifest version is never below the last upload.
 * Equal is fine — that is the state right after an upload.
 */
export function checkAppNotBelowSubmissions(
  manifestVersion: string,
  submissions: readonly StoreSubmission[],
): string[] {
  const latest = last(submissions);
  if (latest === null || compareManifestVersions(manifestVersion, latest.version) >= 0) return [];
  return [
    `The app version maps to manifest version ${manifestVersion}, which is BELOW ` +
      `${latest.version}, uploaded to the Store on ${latest.date} (${SUBMISSIONS_PATH}). The ` +
      'Store will never accept a lower version again; a rollback has to go forward to a new ' +
      'version above it (L-170).',
  ];
}

/**
 * PACK TIME: the manifest about to be packed is strictly above the last
 * upload, because the package this run builds is the one that gets submitted.
 */
export function checkPackAboveSubmissions(
  manifestVersion: string,
  submissions: readonly StoreSubmission[],
): string[] {
  const latest = last(submissions);
  if (latest === null || compareManifestVersions(manifestVersion, latest.version) > 0) return [];
  const same = compareManifestVersions(manifestVersion, latest.version) === 0;
  return [
    `The manifest version ${manifestVersion} is ${same ? 'the SAME as' : 'BELOW'} ` +
      `${latest.version}, uploaded to the Store on ${latest.date} (${SUBMISSIONS_PATH}). The ` +
      'Store only accepts a version above every one it has been sent — a rejected upload ' +
      'included — so this package could not be submitted. Bump the app version first ' +
      '(tauri.conf.json, Cargo.toml and apps/light/package.json together) (L-170).',
  ];
}

export interface PackingInput extends StagedManifestInput {
  /** The text of `store-submissions.json`. */
  readonly submissionsJson: string;
}

export type PackingVerdict =
  | {
      readonly ok: true;
      readonly appVersion: string;
      readonly manifestVersion: string;
      /** The last version uploaded, or `null` when nothing has been yet. */
      readonly lastSubmitted: string | null;
    }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Everything that must hold before `winapp pack`: the L-169 check (the
 * staged manifest matches the app version, the Store fragment carries no
 * version) AND this one (above every upload). Every problem from both is
 * listed, so one red run names everything wrong.
 */
export function checkForPacking(input: PackingInput): PackingVerdict {
  const staged = checkStagedManifest(input);
  const record = parseSubmissions(input.submissionsJson);

  const problems = [...(staged.ok ? [] : staged.problems), ...(record.ok ? [] : record.problems)];
  if (staged.ok && record.ok) {
    problems.push(...checkPackAboveSubmissions(staged.manifestVersion, record.submissions));
  }

  if (problems.length > 0 || !staged.ok || !record.ok) return { ok: false, problems };
  return {
    ok: true,
    appVersion: staged.appVersion,
    manifestVersion: staged.manifestVersion,
    lastSubmitted: last(record.submissions)?.version ?? null,
  };
}
