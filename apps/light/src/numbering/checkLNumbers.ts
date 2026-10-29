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
 *
 * The third half (L-328) is `listing.ts`: the listing is paginated to the end
 * and must not be shorter than the repository's own issue count. It used to be
 * capped at 200, and the repository outgrew it.
 */
import { execFileSync } from 'node:child_process';

import { registryProblems, claimsIn, type IssueTitle } from './lNumbers.ts';
import { PAGE_SIZE, completenessProblems, issuesFromPages, totalIssuesFrom } from './listing.ts';

function gh(args: readonly string[]): unknown {
  const raw = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(raw) as unknown;
}

/**
 * How many issues the repository holds, in every state — the second source the
 * listing is checked against. Fetched BEFORE the listing; see `listing.ts`.
 */
function fetchIssueCount(): number {
  return totalIssuesFrom(
    gh([
      'api',
      'graphql',
      '-F',
      'owner={owner}',
      '-F',
      'name={repo}',
      '-f',
      'query=query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { issues { totalCount } } }',
    ]),
  );
}

/**
 * The listing: EVERY issue, page by page to the end (L-328).
 *
 * `state=all` on purpose: a number claimed by a CLOSED issue is still
 * claimed. Reusing it would put two different pieces of work under one
 * identifier in the history, which is the thing this prevents.
 *
 * No `--limit` and no search: this used to be `gh issue list --limit 200`, and
 * the repository grew past it. `--paginate` follows GitHub's own next-page
 * links until there are none, and the result is checked against the count.
 */
function fetchIssues(): IssueTitle[] {
  return issuesFromPages(
    gh([
      'api',
      '--paginate',
      '--slurp',
      `repos/{owner}/{repo}/issues?state=all&per_page=${PAGE_SIZE}`,
    ]),
  );
}

function main(): void {
  const total = fetchIssueCount();
  const issues = fetchIssues();
  const claims = claimsIn(issues);
  const problems = [...completenessProblems(issues.length, total), ...registryProblems(issues)];

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
    `check-l-numbers: ${claims.length} work-item numbers in all ${total} issues, each claimed once - ` +
      `${claims.map((claim) => claim.label).join(', ')}`,
  );
}

main();
