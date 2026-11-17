/**
 * The built-in boards follow the country (L-422).
 *
 * The United Kingdom's list is the regression lock: exactly the nine boards it
 * had before there was a Country setting, same ids, same order. Every stored
 * choice a UK user has made is keyed by those ids.
 */
import { describe, expect, it } from 'vitest';

import { boardsFor, shippedBoardsFor } from './defaults';
import { NO_PREFERENCES, type BoardPreferences } from './model';

/** Copied from main on 17 November 2026, before this change. */
const UK_NINE = [
  'linkedin',
  'indeed',
  'totaljobs',
  'cv-library',
  'reed',
  'adzuna',
  'google-jobs',
  'jobserve',
  'gov-uk-find-a-job',
];

const UK_ONLY = UK_NINE.filter((id) => id !== 'linkedin');

const ids = (country: string | null) => shippedBoardsFor(country).map((board) => board.id);

const OWN_BOARD = {
  id: 'custom-efinancialcareers',
  label: 'eFinancialCareers',
  urlTemplate: 'https://www.example.com/jobs?q={keyword}',
  encoding: 'plus',
} as const;

describe('the built-in boards for a country', () => {
  it('the UK list is exactly today’s nine, in today’s order', () => {
    expect(ids('gb')).toEqual(UK_NINE);
  });

  it('Canada gets LinkedIn, Indeed and Google for Canada and no UK-only board', () => {
    expect(ids('ca')).toEqual(['linkedin', 'indeed-ca', 'google-jobs-ca']);
    for (const id of UK_ONLY) expect(ids('ca')).not.toContain(id);
  });

  it('Germany gets LinkedIn, Indeed, Adzuna and Google for Germany', () => {
    expect(ids('de')).toEqual(['linkedin', 'indeed-de', 'adzuna-de', 'google-jobs-de']);
  });

  it('every country gets LinkedIn first and its own Indeed second', () => {
    for (const country of ['us', 'at', 'au', 'be', 'br', 'nz', 'pl', 'sg', 'za']) {
      expect(ids(country).slice(0, 2), country).toEqual(['linkedin', `indeed-${country}`]);
    }
    // The shortest list: New Zealand's Adzuna site and Google Jobs were not proved.
    expect(ids('nz')).toEqual(['linkedin', 'indeed-nz']);
  });

  it('negative: no board for another country appears in the UK list', () => {
    expect(ids('gb').filter((id) => /-[a-z]{2}$/.test(id) && !UK_NINE.includes(id))).toEqual([]);
    expect(ids('gb')).not.toContain('indeed-us');
    expect(ids('gb')).not.toContain('adzuna-de');
  });

  it('boundary: “Another country” and “not chosen” get only the worldwide boards', () => {
    expect(ids('other')).toEqual(['linkedin']);
    expect(ids(null)).toEqual(['linkedin']);
  });

  it('negative: a country that is not on the list gets only the worldwide boards', () => {
    expect(ids('GB')).toEqual(['linkedin']);
    expect(ids('')).toEqual(['linkedin']);
    expect(ids('xx')).toEqual(['linkedin']);
  });
});

describe('a person’s own choices, across countries', () => {
  const preferences: BoardPreferences = {
    disabled: ['indeed'],
    order: ['reed', 'linkedin'],
    custom: [OWN_BOARD],
  };

  it('a board they added shows in every country', () => {
    for (const country of ['gb', 'de', 'ca', 'other', null]) {
      const own = boardsFor(country, preferences).find((board) => board.id === OWN_BOARD.id);
      expect(own?.userAdded, String(country)).toBe(true);
      expect(own?.enabled, String(country)).toBe(true);
    }
  });

  it('switching off the UK’s Indeed does not switch off Germany’s', () => {
    const enabled = (country: string, id: string) =>
      boardsFor(country, preferences).find((board) => board.id === id)?.enabled;

    expect(enabled('gb', 'indeed')).toBe(false);
    expect(enabled('de', 'indeed-de')).toBe(true);
  });

  it('a UK user’s stored order and switched-off boards read exactly as before', () => {
    expect(boardsFor('gb', preferences).map((board) => board.id)).toEqual([
      'reed',
      'linkedin',
      'indeed',
      'totaljobs',
      'cv-library',
      'adzuna',
      'google-jobs',
      'jobserve',
      'gov-uk-find-a-job',
      OWN_BOARD.id,
    ]);
  });

  it('with nothing stored, a country’s list is its built-in boards, all on', () => {
    const boards = boardsFor('de', NO_PREFERENCES);
    expect(boards.map((board) => board.id)).toEqual(ids('de'));
    expect(boards.every((board) => board.enabled && !board.userAdded)).toBe(true);
  });
});
