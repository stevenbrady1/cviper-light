/**
 * The UK place guess is gone, and nothing keeps a private copy of it (L-419).
 *
 * Whether a search is a United Kingdom one is the Country setting (L-417).
 * `isUkLocation()` and its list of about 200 place names were deleted; this
 * is a forbid-list over every shipped file, comments stripped, so neither the
 * function nor a copy of its list can come back under another name.
 */
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, shippedText, stripComments, walk } from '../../lib/repo-scan';

/** The guess, by the names it had. */
const GUESS = /\bisUkLocation\b|\bUK_PLACES\b/;

/** Towns from the deleted list that nothing else in the app has a reason to quote. */
const TOWNS = [
  'milton keynes',
  'tunbridge wells',
  'hemel hempstead',
  'stoke-on-trent',
  'west bromwich',
  'leamington spa',
];

/** How many of those towns the text quotes, in lower case, as the list did. */
function townsQuoted(text: string): number {
  return TOWNS.filter((town) => text.includes(`'${town}'`) || text.includes(`"${town}"`)).length;
}

function offends(text: string): boolean {
  return GUESS.test(text) || townsQuoted(text) >= 2;
}

describe('the UK place guess is gone', () => {
  it('contract: no shipped file names the guess or carries its place list', () => {
    const files = ['apps/light/src', 'apps/light/e2e', 'packages'].flatMap((directory) =>
      walk(`${REPO_ROOT}${directory}`, { extensions: ['.ts', '.tsx'] }),
    );
    // A walk that finds nothing would pass for the wrong reason.
    expect(files.length).toBeGreaterThan(200);

    expect(files.filter((file) => offends(shippedText(file))).map(displayPath)).toEqual([]);
  });

  it('the contract sees the guess and a copy of its list, and is not fooled by a comment', () => {
    expect(offends('if (isUkLocation(form.location)) return [];')).toBe(true);
    expect(offends("const PLACES = new Set(['milton keynes', 'tunbridge wells']);")).toBe(true);
    expect(offends("const town = 'milton keynes';")).toBe(false);
    expect(
      offends(stripComments('// isUkLocation() is gone\n/* UK_PLACES too */ const a = 1;')),
    ).toBe(false);
  });
});
