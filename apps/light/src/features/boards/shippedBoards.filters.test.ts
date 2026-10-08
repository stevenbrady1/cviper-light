/**
 * L-219: every shipped job board, every combination of the search filters.
 *
 * For each board and each of the 48 combinations — distance, minimum salary
 * and location each set or empty, contract type Any / Permanent / Contract,
 * with the keyword set (the button needs one) — the link:
 *
 *   * is a valid https URL on the board's own site;
 *   * carries a filter ONLY when the board's template has a place for it, and
 *     ALWAYS when it does and the value is usable (contract: when the board
 *     has a word for that type);
 *   * never carries a parameter with an empty value;
 *   * is the same every time for the same form (no randomness, no clock).
 *
 * The exact link for the worked example sits in `defaults.test.ts` and below.
 */
import { boardFilterSupport, buildBoardUrl, type BrowserSearchInput } from '@cviper/job-apis';
import { describe, expect, it } from 'vitest';

import { SHIPPED_BOARDS } from './defaults';

const DISTANCES = ['', '10'] as const;
const SALARIES = ['', '60000'] as const;
const LOCATIONS = ['', 'London'] as const;
const CONTRACTS = ['any', 'permanent', 'contract'] as const;

const COMBINATIONS: BrowserSearchInput[] = DISTANCES.flatMap((distanceMiles) =>
  SALARIES.flatMap((salaryMin) =>
    LOCATIONS.flatMap((location) =>
      CONTRACTS.map((contract) => ({
        keywords: 'software tester',
        location,
        distanceMiles,
        salaryMin,
        contract,
      })),
    ),
  ),
);

/** The link with every filter left out: what a board's own filters add is the rest. */
function bare(board: (typeof SHIPPED_BOARDS)[number], input: BrowserSearchInput): string {
  return buildBoardUrl(board, { keywords: input.keywords, location: input.location });
}

describe('every shipped board × every filter combination (L-219)', () => {
  it('there are boards and combinations to check', () => {
    expect(SHIPPED_BOARDS.length).toBeGreaterThanOrEqual(9);
    expect(COMBINATIONS).toHaveLength(24);
  });

  describe.each(SHIPPED_BOARDS.map((board) => [board.id, board] as const))('%s', (_id, board) => {
    const support = boardFilterSupport(board);
    const host = new URL(board.urlTemplate.replace(/\{\w+\}/g, 'x')).host;

    it.each(COMBINATIONS.map((input) => [JSON.stringify(input), input] as const))(
      '%s',
      (_label, input) => {
        const url = buildBoardUrl(board, input);
        const parsed = new URL(url);
        expect(parsed.protocol).toBe('https:');
        expect(parsed.host).toBe(host);
        expect(url).not.toMatch(/[{}]/);

        for (const [name, value] of parsed.searchParams) {
          expect(value, `${name} is empty`).not.toBe('');
        }

        const filtersAdded = url !== bare(board, input);
        const wantsFilter =
          (support.radius && input.distanceMiles !== '') ||
          (support.salaryMin && input.salaryMin !== '') ||
          (support.contract &&
            input.contract !== 'any' &&
            (board.filters?.contract === undefined ||
              board.filters.contract[input.contract as 'permanent' | 'contract'] !== undefined));
        expect(filtersAdded, 'a filter appears exactly when the board can take one').toBe(
          wantsFilter,
        );

        expect(buildBoardUrl(board, input)).toBe(url);
      },
    );
  });
});

describe('every shipped board declares how it takes each filter it uses (L-219)', () => {
  it.each(SHIPPED_BOARDS.map((board) => [board.id, board] as const))('%s', (_id, board) => {
    const support = boardFilterSupport(board);
    // A shipped board never falls back to the plain word or the bare miles a
    // user's own board gets: its rules are written down, from its site.
    if (support.radius) expect(board.filters?.radius).toBeDefined();
    if (support.contract) expect(board.filters?.contract).toBeDefined();
  });
});
