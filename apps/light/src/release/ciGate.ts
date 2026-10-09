/**
 * Whether a tagged commit has passed CI, so `release.yml` may bundle it (L-221).
 * Pure: it decides, and `checkCiGate.ts` is the shell that asks GitHub.
 *
 * ============================================================================
 * WHY A RELEASE HAS TO ASK
 * ============================================================================
 * `bundle` used to run on any pushed `light-v*` tag, with no `needs:` at all.
 * The tag push starts `ci.yml` too, but in PARALLEL, gating nothing — and
 * `smoke.yml` does not run on tags. So a tag pushed at a red commit produced a
 * signed draft, and the only thing standing between it and every installed
 * copy was a person remembering to look.
 *
 * A job in one workflow cannot `needs:` a job in another, so the gate asks the
 * check-runs API instead, for the exact SHA the tag points at.
 *
 * ============================================================================
 * THE RULES
 * ============================================================================
 *   * The commit must already be on `main`. Every required check runs on a
 *     push to `main`, so a commit that never got there has no results to ask
 *     about — and a release cut from a side branch skipped the review `main`
 *     is protected by.
 *   * Every name in REQUIRED_CHECKS needs at least one SUCCESS on that SHA. A
 *     failed attempt followed by a green re-run is a pass: the re-run is the
 *     answer a person chose to accept.
 *   * Nothing passed yet, but something is still running or has not started:
 *     WAIT. The tag is often pushed moments after the merge, while `main`'s own
 *     runs are still going.
 *   * Every attempt finished and none succeeded: FAIL. Waiting cannot fix it.
 *
 * A check that is absent counts as pending, never as passed. An empty list is
 * the input that makes "nothing failed" trivially true, and the caller gives
 * up after a deadline rather than waiting forever.
 */

/**
 * The checks a release needs, by the name GitHub shows for each job.
 *
 * The same four the `main` branch protection requires before a merge. A test
 * holds each one to a real job in `ci.yml` or `smoke.yml`, so renaming a job
 * cannot leave this waiting for a check that no longer exists.
 */
export const REQUIRED_CHECKS = [
  'verify',
  'drive pdf.js under WebKit',
  'secret-scan',
  'build the app and drive the real binary',
] as const;

/** One check run, as `GET /repos/{repo}/commits/{sha}/check-runs` returns it. */
export interface CheckRun {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
}

export type CiVerdict =
  | { readonly kind: 'pass' }
  | { readonly kind: 'wait'; readonly pending: readonly string[] }
  | { readonly kind: 'fail'; readonly reasons: readonly string[] };

/** The commit's position against `main`, as the compare API's `status` gives it. */
export function isOnMain(compareStatus: string): boolean {
  // `main...<sha>`: "behind" means <sha> is an ancestor of main, "identical"
  // means it IS main. "ahead" and "diverged" both mean commits main lacks.
  return compareStatus === 'behind' || compareStatus === 'identical';
}

export function judgeCiGate(
  onMain: boolean,
  runs: readonly CheckRun[],
  required: readonly string[] = REQUIRED_CHECKS,
): CiVerdict {
  if (!onMain) {
    return {
      kind: 'fail',
      reasons: [
        'the tagged commit is not on main. Every required check runs on a push to main, and a ' +
          'release cut from anywhere else skipped the review main is protected by. Merge first, ' +
          'then tag the merge commit.',
      ],
    };
  }

  const failed: string[] = [];
  const pending: string[] = [];

  for (const name of required) {
    const attempts = runs.filter((run) => run.name === name);
    if (attempts.some((run) => run.status === 'completed' && run.conclusion === 'success')) {
      continue;
    }
    if (attempts.length === 0 || attempts.some((run) => run.status !== 'completed')) {
      pending.push(name);
      continue;
    }
    const outcomes = attempts.map((run) => run.conclusion ?? 'none').join(', ');
    failed.push(`"${name}" finished without a success (${outcomes})`);
  }

  if (failed.length > 0) return { kind: 'fail', reasons: failed };
  if (pending.length > 0) return { kind: 'wait', pending };
  return { kind: 'pass' };
}

/** The JSON lines `gh api --paginate --jq '.check_runs[] | {name,status,conclusion}'` prints. */
export function parseCheckRuns(raw: string): CheckRun[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const value: unknown = JSON.parse(line);
      if (typeof value !== 'object' || value === null) {
        throw new Error(`a check run that is not an object: ${line}`);
      }
      const { name, status, conclusion } = value as Record<string, unknown>;
      if (typeof name !== 'string' || typeof status !== 'string') {
        throw new Error(`a check run without a name or a status: ${line}`);
      }
      return { name, status, conclusion: typeof conclusion === 'string' ? conclusion : null };
    });
}
