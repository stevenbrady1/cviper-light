/**
 * Ask GitHub for the L-number claims and fail the run on a duplicate.
 *
 * Usage, from the repository root:
 *
 *     node apps/light/src/numbering/checkLNumbers.ts
 *
 * Run in CI as `pnpm check:l-numbers`, in a job of its own with a token. The
 * judgement lives in `lNumbers.ts`, which is pure and unit-tested offline; this
 * file is the shell that fetches the titles and sets an exit code. See that
 * module for why the split exists.
 *
 * ============================================================================
 * A FAILED LOOKUP IS NEVER A PASS
 * ============================================================================
 * There is deliberately no `|| echo '[]'` and no `catch { return [] }` on the
 * `gh` call. If the listing cannot be fetched — no token, a rate limit, a
 * network error, `gh` missing — this THROWS and the job goes red.
 *
 * That shape matters more than it looks. `2>/dev/null || echo` on a health
 * query makes a broken alarm indistinguishable from a healthy system, and an
 * empty list is the specific input that makes "no duplicates" trivially true.
 * A check that cannot see must say so, not say everything is fine.
 *
 * The floor in `lNumbers.ts` is the second half of the same idea, for the case
 * where the call SUCCEEDS and returns fewer rows than it should — a search
 * syntax that stopped matching, or a filter applied by accident.
 */
import { execFileSync } from 'node:child_process';

import { registryProblems, claimsIn, type IssueTitle } from './lNumbers.ts';

/**
 * The listing, from `gh`.
 *
 * `--state all` on purpose: a number claimed by a CLOSED issue is still
 * claimed. Reusing it would put two different pieces of work under one
 * identifier in the history, which is the thing this prevents.
 */
function fetchIssues(): IssueTitle[] {
  const raw = execFileSync(
    'gh',
    [
      'issue',
      'list',
      '--state',
      'all',
      '--search',
      '[L-',
      '--limit',
      '200',
      '--json',
      'number,title',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );

  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`gh returned something that is not a list of issues: ${raw.slice(0, 200)}`);
  }

  return parsed.map((entry) => {
    const record = entry as { number?: unknown; title?: unknown };
    if (typeof record.number !== 'number' || typeof record.title !== 'string') {
      throw new Error(
        `gh returned an issue without a number and a title: ${JSON.stringify(entry)}`,
      );
    }
    return { number: record.number, title: record.title };
  });
}

function main(): void {
  const issues = fetchIssues();
  const claims = claimsIn(issues);
  const problems = registryProblems(issues);

  if (problems.length > 0) {
    console.error('');
    console.error('check-l-numbers: the work-item registry is not healthy.');
    console.error('');
    for (const problem of problems) {
      console.error(`  ${problem.what}`);
      console.error(`    ${problem.why}`);
      console.error('');
    }
    console.error(
      `  (${claims.length} labels were read from ${issues.length} issues: ` +
        `${claims.map((claim) => claim.label).join(', ')})`,
    );
    process.exit(1);
  }

  console.log(
    `check-l-numbers: ${claims.length} work-item numbers, each claimed once - ` +
      `${claims.map((claim) => claim.label).join(', ')}`,
  );
}

main();
