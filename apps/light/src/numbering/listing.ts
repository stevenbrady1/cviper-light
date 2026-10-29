/**
 * The issue listing, read whole and proved whole (L-328).
 *
 * ============================================================================
 * WHAT WENT WRONG
 * ============================================================================
 * The listing used to be `gh issue list --limit 200`. The repository passed 200
 * issues and the oldest claims fell off the end, so the duplicate check was
 * adjudicating a fraction of the registry while believing it saw all of it.
 * A cap that is silently reached is the empty-list failure one size up: a
 * duplicate among the issues that were not read cannot be seen.
 *
 * ============================================================================
 * WHAT THIS DOES INSTEAD
 * ============================================================================
 * Two independent sources, and the first must not be shorter than the second:
 *
 *   1. The LISTING, from `GET /repos/{owner}/{repo}/issues?state=all`, followed
 *      page by page to the end (`gh api --paginate --slurp`). No `--limit`,
 *      so there is no number for the repository to grow past. That endpoint
 *      returns pull requests too; they are dropped here, because a pull
 *      request references a number and never claims one.
 *   2. The COUNT, from GraphQL `repository.issues.totalCount` — every issue in
 *      every state, as GitHub itself tallies it.
 *
 * The count is fetched FIRST. A listing the same size or larger is whole
 * (larger means an issue was opened in between). A listing SMALLER than the
 * count is truncated, whatever the cause — a pagination bug, a changed
 * endpoint, a cap somebody puts back — and fails, naming both numbers.
 *
 * Every parse here THROWS on a shape it does not recognise rather than
 * returning `[]` or `0`, for the reason `checkLNumbers.ts` gives: an empty
 * answer is the specific input that makes "no duplicates" trivially true.
 */
import type { IssueTitle, RegistryProblem } from './lNumbers.ts';

/** Issues per page requested from the REST endpoint — GitHub's maximum. */
export const PAGE_SIZE = 100;

/**
 * Every ISSUE in the pages `gh api --paginate --slurp` returns, in order.
 *
 * Pull requests are dropped: the issues endpoint lists them alongside issues,
 * marked by a `pull_request` field.
 */
export function issuesFromPages(pages: unknown): IssueTitle[] {
  if (!Array.isArray(pages)) {
    throw new Error(
      `gh returned something that is not a list of pages: ${JSON.stringify(pages).slice(0, 200)}`,
    );
  }

  return pages.flatMap((page: unknown) => {
    if (!Array.isArray(page)) {
      throw new Error(
        `gh returned a page that is not a list of issues: ${JSON.stringify(page).slice(0, 200)}`,
      );
    }
    return page.flatMap((entry: unknown) => {
      const record = entry as { number?: unknown; title?: unknown; pull_request?: unknown };
      if (typeof record.number !== 'number' || typeof record.title !== 'string') {
        throw new Error(
          `gh returned an issue without a number and a title: ${JSON.stringify(entry)}`,
        );
      }
      if (record.pull_request !== undefined && record.pull_request !== null) return [];
      return [{ number: record.number, title: record.title }];
    });
  });
}

/** The repository's issue count, from the GraphQL `totalCount` response. */
export function totalIssuesFrom(response: unknown): number {
  const total = (response as { data?: { repository?: { issues?: { totalCount?: unknown } } } })
    ?.data?.repository?.issues?.totalCount;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 1) {
    throw new Error(
      'gh returned no usable issues totalCount, so the listing cannot be proved whole: ' +
        JSON.stringify(response).slice(0, 200),
    );
  }
  return total;
}

/** Why a listing of `listed` issues cannot be the whole of a repository holding `total`. */
export function completenessProblems(listed: number, total: number): RegistryProblem[] {
  if (listed >= total) return [];
  return [
    {
      what: 'the issue listing is truncated',
      why:
        `${listed} issues were listed but the repository holds ${total}. A duplicate among the ` +
        `${total - listed} that were not read would be invisible, so this check cannot pass. ` +
        'Fix the listing — a cap or a pagination fault — not this comparison.',
    },
  ];
}
