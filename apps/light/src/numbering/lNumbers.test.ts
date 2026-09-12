/**
 * The L-number registry (L-92): no two work items may claim the same number.
 *
 * ============================================================================
 * WHAT THE REGISTRY IS, AND WHAT IT IS NOT
 * ============================================================================
 * An item number is claimed by creating a GitHub issue titled `[L-NNN] <one
 * line>`. The issue's OWN number is not the L-number — issue #38 carries
 * `[L-103]` — because issue numbers are shared with pull requests and are
 * handed out by GitHub in the order things happen, not in the order work is
 * planned.
 *
 * This is a RECORD, NOT A LOCK. Nothing here prevents two sessions creating
 * `[L-104]` seconds apart; both calls succeed, because there is no place to
 * take a lock and GitHub will happily accept two issues with the same title.
 * What this does is make the collision VISIBLE and fail the build, so it is
 * found in minutes by CI rather than in a week by a human wondering why two
 * branches both say L-104. The loser renames.
 *
 * Saying that plainly is the point. A registry that is described as preventing
 * races, and does not, is worse than one that admits what it is: people stop
 * checking, because they believe something is holding the door.
 *
 * ============================================================================
 * WHY THE LOGIC IS HERE AND THE `gh` CALL IS IN CI
 * ============================================================================
 * The check needs a network, a GitHub token and the `gh` binary. None of the
 * three belongs in `pnpm test`:
 *
 *   * In the CI `verify` job there is no token, so a test would fail for a
 *     reason that has nothing to do with the change under review.
 *   * On a developer machine `gh` may not be installed or authenticated, so the
 *     test would either fail spuriously or — far worse — SKIP, which is a guard
 *     that reports green while inspecting nothing.
 *
 * So the split is: everything that can be decided from a list of titles lives
 * here, is pure, and is unit-tested offline in the loop; the thin shell that
 * asks GitHub for that list lives in `checkLNumbers.ts` and runs in its own CI
 * job with a token. The half that holds the judgement is the half that is
 * tested.
 *
 * ============================================================================
 * WHY THERE IS A FLOOR, AND WHY IT IS NOT ZERO
 * ============================================================================
 * "No duplicates among zero issues" is trivially true. A changed search syntax,
 * an expired token, a rate limit or a renamed field all produce an EMPTY LIST,
 * and an empty list sails through a duplicate check looking exactly like a
 * healthy registry. That is the single most repeated way a guard in this
 * repository has gone quietly inert.
 *
 * Two floors, because a bare count is not enough on its own:
 *
 *   1. A MINIMUM NUMBER of labels must be found.
 *   2. NAMED labels that are known to exist must be among them. A count can be
 *      satisfied by any old rubbish; a named label cannot.
 */
import { describe, expect, it } from 'vitest';

import {
  LABELS_THAT_MUST_EXIST,
  MINIMUM_LABELS,
  duplicatesIn,
  labelOf,
  registryProblems,
  type IssueTitle,
} from './lNumbers.ts';

/** A registry that is healthy: every known label, each claimed exactly once. */
function healthyRegistry(): IssueTitle[] {
  const known = LABELS_THAT_MUST_EXIST.map((label, index) => ({
    number: 100 + index,
    title: `${`[${label}]`} A real work item`,
  }));
  const filler = Array.from({ length: Math.max(0, MINIMUM_LABELS - known.length) }, (_, index) => ({
    number: 500 + index,
    title: `[L-${900 + index}] Filler work item`,
  }));
  return [...known, ...filler];
}

describe('labelOf', () => {
  it('reads the label a claim is made with', () => {
    expect(labelOf('[L-92] Updater and release workflow')).toBe('L-92');
  });

  it('reads a suffixed number, which this project actually uses', () => {
    // `[L-20b]` is a real issue in this repository. A pattern that only
    // accepted digits would silently stop seeing it.
    expect(labelOf('[L-20b] Export a CV as a JSON Resume file')).toBe('L-20b');
  });

  it('normalises case, so a lower-case claim still collides', () => {
    expect(labelOf('[l-92] written in a hurry')).toBe('L-92');
  });

  it('negative: a pull-request style reference is not a claim', () => {
    // PR titles end `(L-92)`. They reference a number somebody else claimed;
    // treating them as claims would report a duplicate for every merged PR.
    expect(labelOf('feat(updater): stable manifest URL (L-92)')).toBeNull();
  });

  it('negative: a title with no label at all', () => {
    expect(labelOf('Fix the thing that was broken')).toBeNull();
  });

  it('boundary: a label that is not at the start is not a claim', () => {
    expect(labelOf('Something about [L-92] in passing')).toBeNull();
  });

  it('boundary: empty and malformed titles', () => {
    expect(labelOf('')).toBeNull();
    expect(labelOf('[L-] no number')).toBeNull();
    expect(labelOf('[X-92] wrong letter')).toBeNull();
  });
});

describe('duplicatesIn', () => {
  it('finds a number claimed twice, and names both issues', () => {
    const duplicates = duplicatesIn([
      { number: 10, title: '[L-80] iOS build target' },
      { number: 11, title: '[L-81] Mobile layout' },
      { number: 12, title: '[L-80] Something else entirely' },
    ]);

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.label).toBe('L-80');
    expect(duplicates[0]?.issues).toEqual([10, 12]);
  });

  it('finds a duplicate written in a different case', () => {
    const duplicates = duplicatesIn([
      { number: 1, title: '[L-92] One' },
      { number: 2, title: '[l-92] Two' },
    ]);
    expect(duplicates).toHaveLength(1);
  });

  it('finds none in a healthy registry', () => {
    expect(duplicatesIn(healthyRegistry())).toEqual([]);
  });

  it('boundary: an empty list has no duplicates — which is why the floor exists', () => {
    expect(duplicatesIn([])).toEqual([]);
  });
});

describe('registryProblems', () => {
  it('is happy with a healthy registry', () => {
    const problems = registryProblems(healthyRegistry());
    expect(
      problems.map((problem) => problem.why),
      JSON.stringify(problems),
    ).toEqual([]);
  });

  it('negative: reports a duplicate claim', () => {
    const registry = [...healthyRegistry(), { number: 999, title: '[L-80] A second claim' }];
    const problems = registryProblems(registry);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.what).toContain('L-80');
    expect(problems[0]?.why).toContain('999');
  });

  it('negative: an EMPTY list fails the floor rather than passing', () => {
    // The failure this floor exists for: an auth failure, a rate limit or a
    // changed search syntax returns nothing, and "no duplicates among zero" is
    // true. Without this leg the check would be green while inspecting nothing.
    const problems = registryProblems([]);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.map((problem) => problem.why).join(' ')).toContain('inspecting nothing');
  });

  it('negative: too few labels fails the floor', () => {
    const problems = registryProblems([{ number: 1, title: '[L-80] Only one' }]);
    expect(problems.map((problem) => problem.what).join(' ')).toContain('floor');
  });

  it('negative: a known label going missing fails, even when the count is fine', () => {
    // A count can be satisfied by anything. This is the leg that notices the
    // query started returning a DIFFERENT set rather than a smaller one.
    const registry = healthyRegistry().map((issue, index) =>
      index === 0 ? { number: issue.number, title: '[L-777] Substituted' } : issue,
    );
    const problems = registryProblems(registry);

    expect(problems.map((problem) => problem.what).join(' ')).toContain(
      LABELS_THAT_MUST_EXIST[0] ?? '',
    );
  });

  it('the floor is a real number and the named labels are real', () => {
    // Anti-inert on the guard's own configuration: a floor of zero, or an empty
    // list of named labels, would make two of the three legs above vacuous.
    expect(MINIMUM_LABELS).toBeGreaterThan(0);
    expect(LABELS_THAT_MUST_EXIST.length).toBeGreaterThan(0);
    for (const label of LABELS_THAT_MUST_EXIST) {
      expect(label).toMatch(/^L-\d+[a-z]?$/);
    }
  });
});
