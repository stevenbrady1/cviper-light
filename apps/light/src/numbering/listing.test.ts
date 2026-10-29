/**
 * The issue listing the L-number registry adjudicates must be the WHOLE listing
 * (L-328).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `checkLNumbers.ts` used to ask for `gh issue list --limit 200`. The
 * repository passed 200 issues, the oldest claims fell off the end of the
 * listing, and the duplicate check was suddenly adjudicating a fraction of the
 * registry. The named-label leg in `lNumbers.ts` caught it — L-80 to L-84 went
 * "missing from the listing" — which is the only reason it was noticed.
 *
 * A cap that is silently reached is the same failure as an empty list, one
 * size up: a duplicate among the issues that were NOT read is invisible. So the
 * listing is now paginated to the end, and its length is checked against a
 * SECOND, independent source — the repository's own issue count — and a
 * listing shorter than that count fails, naming both numbers.
 *
 * Pure and offline, for the reason `lNumbers.ts` gives: the half that holds the
 * judgement is the half that runs in `pnpm test`.
 */
import { describe, expect, it } from 'vitest';

import { PAGE_SIZE, completenessProblems, issuesFromPages, totalIssuesFrom } from './listing.ts';

/** One REST issue, as `GET /repos/{owner}/{repo}/issues` returns it. */
function issue(number: number): Record<string, unknown> {
  return { number, title: `[L-${number}] A work item`, state: 'closed' };
}

/** A pull request, which the same endpoint returns alongside issues. */
function pullRequest(number: number): Record<string, unknown> {
  return {
    number,
    title: `fix: something (L-${number})`,
    pull_request: { url: `https://example.invalid/pulls/${number}` },
  };
}

/** `count` issues, split into pages of `PAGE_SIZE` the way `--paginate --slurp` gives them. */
function pagesOf(count: number): Array<Array<Record<string, unknown>>> {
  const all = Array.from({ length: count }, (_, index) => issue(index + 1));
  const pages: Array<Array<Record<string, unknown>>> = [];
  for (let start = 0; start < all.length; start += PAGE_SIZE) {
    pages.push(all.slice(start, start + PAGE_SIZE));
  }
  return pages;
}

describe('issuesFromPages', () => {
  it('reads every issue across every page, past the old cap of 200', () => {
    const issues = issuesFromPages(pagesOf(215));

    expect(issues).toHaveLength(215);
    expect(issues[0]).toEqual({ number: 1, title: '[L-1] A work item' });
    expect(issues[214]).toEqual({ number: 215, title: '[L-215] A work item' });
  });

  it('drops pull requests, which the issues endpoint lists alongside issues', () => {
    const issues = issuesFromPages([[issue(1), pullRequest(2), issue(3)], [pullRequest(4)]]);
    expect(issues.map((entry) => entry.number)).toEqual([1, 3]);
  });

  it('negative: a response that is not a list of pages throws, never returns []', () => {
    // An empty list is the input that makes "no duplicates" trivially true.
    expect(() => issuesFromPages({ message: 'Bad credentials' })).toThrow(/not a list of pages/);
    expect(() => issuesFromPages([{ message: 'Bad credentials' }])).toThrow(/not a list/);
  });

  it('negative: an issue without a number and a title throws', () => {
    expect(() => issuesFromPages([[{ number: 1 }]])).toThrow(/number and a title/);
  });

  it('boundary: exactly two full pages is read whole', () => {
    expect(issuesFromPages(pagesOf(2 * PAGE_SIZE))).toHaveLength(2 * PAGE_SIZE);
  });
});

describe('totalIssuesFrom', () => {
  it('reads the count from the GraphQL response', () => {
    expect(totalIssuesFrom({ data: { repository: { issues: { totalCount: 216 } } } })).toBe(216);
  });

  it('negative: a response without a count throws, never returns 0', () => {
    expect(() => totalIssuesFrom({ errors: [{ message: 'Could not resolve' }] })).toThrow(
      /totalCount/,
    );
    expect(() => totalIssuesFrom({ data: { repository: null } })).toThrow(/totalCount/);
  });

  it('negative: a count that is not a whole, positive number throws', () => {
    for (const bad of [0, -1, 1.5, '216', null]) {
      expect(() =>
        totalIssuesFrom({ data: { repository: { issues: { totalCount: bad } } } }),
      ).toThrow(/totalCount/);
    }
  });
});

describe('completenessProblems', () => {
  it('is happy when the listing holds every issue the repository has', () => {
    expect(completenessProblems(215, 215)).toEqual([]);
  });

  it('negative: a listing cut off at the old cap of 200 fails, and says so', () => {
    // The exact failure of L-328: 200 read, 215 exist.
    const problems = completenessProblems(200, 215);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.what).toContain('truncated');
    expect(problems[0]?.why).toContain('200');
    expect(problems[0]?.why).toContain('215');
  });

  it('boundary: exactly at a page edge passes, one short of it fails', () => {
    expect(completenessProblems(2 * PAGE_SIZE, 2 * PAGE_SIZE)).toEqual([]);
    expect(completenessProblems(2 * PAGE_SIZE - 1, 2 * PAGE_SIZE)).toHaveLength(1);
  });

  it('boundary: an issue created between the count and the listing is not a truncation', () => {
    // The count is fetched FIRST, so the listing can only legitimately be the
    // same size or larger. Larger means somebody opened an issue in between.
    expect(completenessProblems(217, 216)).toEqual([]);
  });

  it('negative: an empty listing against a real count fails', () => {
    expect(completenessProblems(0, 216)).toHaveLength(1);
  });
});
