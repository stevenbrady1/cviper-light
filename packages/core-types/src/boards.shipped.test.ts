/**
 * The shipped board file may say which countries a board is for (L-422).
 *
 * One entry can stand for one board per country: `{country}` in its id marks
 * it, and each country's board gets its own id, so a choice made for one
 * country's board is never a choice about another's.
 */
import { describe, expect, it } from 'vitest';

import { parseShippedBoards } from './boards';

const PLAIN = {
  id: 'linkedin',
  label: 'LinkedIn',
  urlTemplate: 'https://a.invalid/jobs?q={keyword}',
  encoding: 'plus',
} as const;

function parsed(raw: unknown) {
  const result = parseShippedBoards(raw);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('parseShippedBoards', () => {
  it('reads a board that names no country as a board for everywhere', () => {
    expect(parsed([PLAIN])).toEqual([PLAIN]);
  });

  it('keeps the countries a single board is for', () => {
    const [board] = parsed([{ ...PLAIN, id: 'reed', countries: ['gb'] }]);
    expect(board).toEqual({ ...PLAIN, id: 'reed', countries: ['gb'] });
  });

  it('makes one board per country from a `{country}` entry, each with its own id', () => {
    const boards = parsed([
      {
        ...PLAIN,
        id: 'google-jobs-{country}',
        urlTemplate: 'https://g.invalid/search?q={keyword}&gl={country}',
        countries: ['ca', 'de'],
      },
    ]);

    expect(boards).toEqual([
      {
        ...PLAIN,
        id: 'google-jobs-ca',
        urlTemplate: 'https://g.invalid/search?q={keyword}&gl=ca',
        countries: ['ca'],
      },
      {
        ...PLAIN,
        id: 'google-jobs-de',
        urlTemplate: 'https://g.invalid/search?q={keyword}&gl=de',
        countries: ['de'],
      },
    ]);
  });

  it('gives each country its own site from `sites`, and keeps the filters', () => {
    const filters = { radius: { unit: 'km', steps: [5, 10] } } as const;
    const boards = parsed([
      {
        ...PLAIN,
        id: 'indeed-{country}',
        urlTemplate: '{site}/jobs?q={keyword}&l={location}',
        filters,
        sites: { at: 'https://at.b.invalid', au: 'https://au.b.invalid' },
      },
    ]);

    expect(boards.map((board) => [board.id, board.urlTemplate, board.countries])).toEqual([
      ['indeed-at', 'https://at.b.invalid/jobs?q={keyword}&l={location}', ['at']],
      ['indeed-au', 'https://au.b.invalid/jobs?q={keyword}&l={location}', ['au']],
    ]);
    expect(boards.map((board) => board.filters)).toEqual([filters, filters]);
  });

  it('keeps the order of the file, a per-country entry expanding in place', () => {
    const boards = parsed([
      PLAIN,
      { ...PLAIN, id: 'x-{country}', countries: ['us', 'ca'] },
      { ...PLAIN, id: 'last' },
    ]);
    expect(boards.map((board) => board.id)).toEqual(['linkedin', 'x-us', 'x-ca', 'last']);
  });
});

describe('parseShippedBoards — a file that must not ship', () => {
  const refused = (raw: unknown) => parseShippedBoards(raw).ok;

  it('negative: something that is not a list of boards', () => {
    expect(refused({})).toBe(false);
    expect(refused([{ id: 'x' }])).toBe(false);
  });

  it('negative: a `{country}` entry that names no country', () => {
    expect(refused([{ ...PLAIN, id: 'x-{country}' }])).toBe(false);
  });

  it('negative: `{site}` or `{country}` left in an address with nothing to fill it', () => {
    expect(refused([{ ...PLAIN, urlTemplate: '{site}/jobs?q={keyword}' }])).toBe(false);
    expect(refused([{ ...PLAIN, urlTemplate: 'https://a.invalid/{country}?q={keyword}' }])).toBe(
      false,
    );
    expect(
      refused([
        {
          ...PLAIN,
          id: 'x-{country}',
          urlTemplate: '{site}/jobs?q={keyword}',
          countries: ['us'],
        },
      ]),
    ).toBe(false);
  });

  it('negative: an entry that names its countries twice', () => {
    expect(
      refused([
        { ...PLAIN, id: 'x-{country}', countries: ['us'], sites: { us: 'https://a.invalid' } },
      ]),
    ).toBe(false);
  });

  it('negative: a country that is not a two-letter code, and a site that is not https', () => {
    expect(refused([{ ...PLAIN, countries: ['GB'] }])).toBe(false);
    expect(refused([{ ...PLAIN, countries: [] }])).toBe(false);
    expect(refused([{ ...PLAIN, id: 'x-{country}', sites: { us: 'http://a.invalid' } }])).toBe(
      false,
    );
    expect(
      refused([{ ...PLAIN, id: 'x-{country}', sites: { us: 'https://a.invalid/path' } }]),
    ).toBe(false);
  });

  it('negative: two boards that end up with the same id', () => {
    expect(refused([PLAIN, PLAIN])).toBe(false);
    expect(
      refused([
        { ...PLAIN, id: 'x-us' },
        { ...PLAIN, id: 'x-{country}', countries: ['us'] },
      ]),
    ).toBe(false);
  });

  it('boundary: an empty list is a list', () => {
    expect(parsed([])).toEqual([]);
  });
});
