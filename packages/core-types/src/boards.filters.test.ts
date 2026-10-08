/**
 * L-219: a board's filter rules are data, read from our JSON or the user's
 * store — and the parts used as written cannot reshape a URL.
 */
import { describe, expect, it } from 'vitest';

import { parseBoardTemplates } from './boards';

function board(filters: unknown) {
  return [
    {
      id: 'b',
      label: 'B',
      urlTemplate: 'https://example.co.uk/{keyword}?{contract}',
      encoding: 'plus',
      filters,
    },
  ];
}

describe('board filters (L-219)', () => {
  it('happy: reads every rule', () => {
    const parsed = parseBoardTemplates(
      board({
        radius: { unit: 'km', steps: [5, 10] },
        salaryMin: { steps: [20000], with: '&salarytype=annum' },
        contract: { permanent: 'perm=true', contract: 'C' },
      }),
    );
    expect(parsed.ok).toBe(true);
  });

  it('a board with no filters is still a board', () => {
    expect(parseBoardTemplates(board(undefined)).ok).toBe(true);
  });

  it.each([
    ['a contract word with a slash', { contract: { permanent: 'a/b' } }],
    ['a contract word with an ampersand', { contract: { permanent: 'a=1&b=2' } }],
    ['a contract word with a space', { contract: { permanent: 'full time' } }],
    ['a contract word with a #', { contract: { contract: 'x#y' } }],
    ['an empty contract word', { contract: { contract: '' } }],
    ['a salary companion without its &', { salaryMin: { with: 'salarytype=annum' } }],
    ['a salary companion with two parameters', { salaryMin: { with: '&a=1&b=2' } }],
    ['steps out of order', { radius: { unit: 'miles', steps: [10, 5] } }],
    ['a zero step', { radius: { unit: 'miles', steps: [0, 5] } }],
    ['an unknown unit', { radius: { unit: 'furlongs' } }],
  ])('negative: refuses %s', (_why, filters) => {
    expect(parseBoardTemplates(board(filters)).ok).toBe(false);
  });
});
