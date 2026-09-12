/**
 * The L-number registry: who has claimed which work-item number.
 *
 * ============================================================================
 * HOW A NUMBER IS CLAIMED
 * ============================================================================
 * By creating a GitHub issue titled `[L-NNN] <one line>`. That is the whole
 * mechanism. The issue's OWN number is not the L-number — issue #38 carries
 * `[L-103]` — because GitHub hands issue numbers out in the order things
 * happen and shares them with pull requests, while L-numbers are planning
 * identifiers chosen by a person.
 *
 * A pull request REFERENCES a number in its title, as `(L-92)`, and does not
 * claim one. Only the bracketed form at the START of an issue title is a claim,
 * which is why `labelOf` refuses both `(L-92)` and a mention in passing: if a
 * reference counted, every merged pull request would look like a duplicate of
 * the issue it closed.
 *
 * ============================================================================
 * THIS IS A RECORD, NOT A LOCK
 * ============================================================================
 * Nothing here prevents a collision. Two sessions can create `[L-104]` seconds
 * apart and BOTH calls succeed: there is nowhere to take a lock, GitHub accepts
 * duplicate titles, and no amount of checking before creating closes the window
 * between the check and the create.
 *
 * What this does is make a collision VISIBLE and fail the build, so it is found
 * in minutes by CI instead of in a week by somebody wondering why two branches
 * both say L-104. The loser renames. Saying that plainly is the point — a
 * registry described as preventing races, which does not, is worse than no
 * registry, because people stop looking.
 *
 * ============================================================================
 * WHY THE `gh` CALL IS NOT IN HERE
 * ============================================================================
 * This module is pure and offline, and `checkLNumbers.ts` is the thin shell
 * that asks GitHub for the titles. The reason is that the question "is this
 * registry healthy" needs a network, a token and the `gh` binary, and none of
 * those belongs in `pnpm test`:
 *
 *   * The CI `verify` job has no token, so a test would fail for a reason
 *     unrelated to the change under review.
 *   * A developer machine may have no `gh`, so the test would fail spuriously
 *     or — far worse — SKIP, which is a guard reporting green while inspecting
 *     nothing.
 *
 * Everything that holds a judgement is therefore here, where it is unit-tested
 * offline and runs in the loop on every change.
 */

/** An issue as GitHub reports it. Only the two fields this needs. */
export interface IssueTitle {
  readonly number: number;
  readonly title: string;
}

/** One number claimed more than once. */
export interface DuplicateClaim {
  readonly label: string;
  /** The issues that claim it, in the order they were listed. */
  readonly issues: readonly number[];
}

/** Something wrong with the registry as a whole. */
export interface RegistryProblem {
  readonly what: string;
  readonly why: string;
}

/**
 * The fewest labels a healthy listing can contain.
 *
 * ============================================================================
 * WHY A FLOOR AT ALL
 * ============================================================================
 * "No duplicates among zero issues" is trivially true. A changed search syntax,
 * an expired token, a rate limit or a renamed JSON field all produce an EMPTY
 * LIST, and an empty list walks through a duplicate check looking exactly like
 * a healthy registry. An alarm that cannot see is not an alarm that says
 * everything is fine.
 *
 * ============================================================================
 * WHY THIS NUMBER, AND NOT A HIGHER ONE
 * ============================================================================
 * It is MEASURED, not guessed. At the time of writing this repository contains
 * exactly TEN issues carrying an `[L-NNN]` label, and ten issues in total —
 * `gh issue list --state all --limit 200` returns ten. The other twenty-eight
 * numbers below #38 are pull requests, which share the numbering and are not
 * claims.
 *
 * A floor set above the true count is not a stricter guard, it is a RED BUILD
 * on every commit, and a check that is always red is a check somebody deletes
 * or bypasses within a week. So it sits at the measured count and is expected
 * to be raised as items accumulate.
 *
 * This is the weak leg on its own, which is why it is not the only one: see
 * `LABELS_THAT_MUST_EXIST`.
 */
export const MINIMUM_LABELS = 10;

/**
 * Labels known to exist, asserted BY NAME.
 *
 * A count can be satisfied by any ten strings. These cannot: they are
 * long-standing issues in this repository, and if the query starts returning a
 * DIFFERENT set rather than a smaller one — a changed search, a filter applied
 * by accident, the wrong repository — the count leg stays green and this one
 * does not.
 */
export const LABELS_THAT_MUST_EXIST: readonly string[] = ['L-80', 'L-81', 'L-82', 'L-83', 'L-84'];

/**
 * A claim at the start of an issue title, normalised.
 *
 * Anchored, so a reference in passing is not a claim. Case-insensitive and
 * normalised to an upper-case `L` with a lower-case suffix, so `[l-20B]` and
 * `[L-20b]` collide rather than hiding from each other.
 */
export function labelOf(title: string): string | null {
  const match = /^\s*\[\s*l-(\d+)([a-z]?)\s*\]/i.exec(title);
  if (match === null) return null;
  return `L-${match[1] ?? ''}${(match[2] ?? '').toLowerCase()}`;
}

/** Every claim in a listing, in the order the listing gave them. */
export function claimsIn(
  issues: readonly IssueTitle[],
): ReadonlyArray<{ readonly label: string; readonly number: number }> {
  return issues.flatMap((issue) => {
    const label = labelOf(issue.title);
    return label === null ? [] : [{ label, number: issue.number }];
  });
}

/** Every number claimed more than once. */
export function duplicatesIn(issues: readonly IssueTitle[]): DuplicateClaim[] {
  const byLabel = new Map<string, number[]>();
  for (const claim of claimsIn(issues)) {
    const existing = byLabel.get(claim.label);
    if (existing === undefined) byLabel.set(claim.label, [claim.number]);
    else existing.push(claim.number);
  }

  return [...byLabel.entries()]
    .filter(([, numbers]) => numbers.length > 1)
    .map(([label, numbers]) => ({ label, issues: numbers }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

/** Every way this listing says the registry is unhealthy. */
export function registryProblems(issues: readonly IssueTitle[]): RegistryProblem[] {
  const problems: RegistryProblem[] = [];
  const claims = claimsIn(issues);

  if (claims.length < MINIMUM_LABELS) {
    problems.push({
      what: `the floor of ${MINIMUM_LABELS} labels`,
      why:
        `only ${claims.length} \`[L-NNN]\` labels were found, and at least ${MINIMUM_LABELS} are ` +
        'expected. A changed search syntax, an expired token or a rate limit returns an empty ' +
        'or short list, and a duplicate check over one is green while inspecting nothing. Fix ' +
        'the query, not this number — unless items really have been removed.',
    });
  }

  const found = new Set(claims.map((claim) => claim.label));
  for (const required of LABELS_THAT_MUST_EXIST) {
    if (found.has(required)) continue;
    problems.push({
      what: `${required} is missing from the listing`,
      why:
        `${required} is a known issue in this repository. Its absence means the listing is not ` +
        'the set of issues this check believes it is adjudicating — a different query, a ' +
        'different repository, or a filter applied by accident.',
    });
  }

  for (const duplicate of duplicatesIn(issues)) {
    problems.push({
      what: `${duplicate.label} is claimed by more than one issue`,
      why:
        `issues ${duplicate.issues.join(' and ')} both claim ${duplicate.label}. Two sessions ` +
        'picked the same number — this registry is a record, not a lock, and cannot stop that ' +
        'happening. Rename the later one and move its branch and pull request with it.',
    });
  }

  return problems;
}
