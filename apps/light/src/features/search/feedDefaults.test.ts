// @vitest-environment jsdom
/**
 * Which free feed a search starts with (L-219, then L-419).
 *
 * Arbeitnow is mostly Germany and the rest of Europe, so it starts switched
 * off for a United Kingdom search that names a place. Whether a search IS a
 * United Kingdom one is the Country setting (L-417) and nothing else: the app
 * no longer guesses it from the words typed in Location (L-419). A choice the
 * user made themselves wins, in every country, and is remembered.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { type CountryChoice } from './country';
import {
  FEED_CHOICE_KEY,
  chosenFeeds,
  defaultFeeds,
  isUkPlaceSearch,
  readFeedChoice,
  rememberFeedChoice,
  tickFeeds,
  tickFeedsLabel,
  type FeedChoice,
} from './feedDefaults';

beforeEach(() => localStorage.clear());

/** The feeds a search of this country and place reads. */
const feeds = (choice: FeedChoice, country: CountryChoice | null, location: string) => [
  ...chosenFeeds(choice, isUkPlaceSearch(country, location)),
];

const NOT_THE_UK: readonly CountryChoice[] = ['us', 'de', 'au', 'other'];

describe('isUkPlaceSearch (L-419): the Country setting, never a guess from the place', () => {
  // "Berlin" and "Skegness" are the point: the old place list knew neither,
  // and the setting does not need to.
  it.each(['London', 'SW1A 1AA', 'Berlin', 'Skegness', ' York '])(
    'happy: a United Kingdom search with "%s" typed',
    (location) => {
      expect(isUkPlaceSearch('gb', location)).toBe(true);
    },
  );

  it('happy: a United Kingdom search with no place typed is not one', () => {
    expect(isUkPlaceSearch('gb', '')).toBe(false);
  });

  it('boundary: a place of only spaces counts as no place', () => {
    expect(isUkPlaceSearch('gb', '   ')).toBe(false);
    expect(isUkPlaceSearch('gb', ' \t ')).toBe(false);
  });

  it.each(NOT_THE_UK)('negative: a "%s" search of "York" is not a UK place', (country) => {
    expect(isUkPlaceSearch(country, 'York')).toBe(false);
    expect(isUkPlaceSearch(country, 'London, UK')).toBe(false);
  });

  it('boundary: with no country chosen there is nothing to decide', () => {
    expect(isUkPlaceSearch(null, 'London')).toBe(false);
  });
});

describe('chosenFeeds: the three rules (L-419)', () => {
  it('the United Kingdom with a place typed: no free feed (Guardian Jobs closed, L-336)', () => {
    expect(feeds({}, 'gb', 'London')).toEqual([]);
    // The one change a UK user can see: a place outside the UK is still a UK search.
    expect(feeds({}, 'gb', 'Berlin')).toEqual([]);
  });

  it('the United Kingdom with no place typed: Arbeitnow, as it always was', () => {
    expect(feeds({}, 'gb', '')).toEqual(['arbeitnow']);
    expect(feeds({}, 'gb', '  ')).toEqual(['arbeitnow']);
  });

  it.each(NOT_THE_UK)('any other country ("%s"): Arbeitnow, whatever is typed', (country) => {
    expect(feeds({}, country, '')).toEqual(['arbeitnow']);
    expect(feeds({}, country, 'Berlin')).toEqual(['arbeitnow']);
  });

  it('negative: a US search of "York" keeps the feed on (the old guess switched it off)', () => {
    expect(feeds({}, 'us', 'York')).toEqual(['arbeitnow']);
  });

  it.each<CountryChoice>(['gb', ...NOT_THE_UK])(
    'edge: the user’s own tick wins in "%s", either way',
    (country) => {
      expect(feeds({ arbeitnow: true }, country, 'London')).toEqual(['arbeitnow']);
      expect(feeds({ arbeitnow: false }, country, '')).toEqual([]);
      expect(feeds({ arbeitnow: false }, country, 'Berlin')).toEqual([]);
    },
  );
});

describe('remembering the choice', () => {
  it('happy: a choice survives a restart', () => {
    rememberFeedChoice({}, 'arbeitnow', true);
    expect(readFeedChoice()).toEqual({ arbeitnow: true });
  });

  it('negative: an unreadable store is no choice at all', () => {
    localStorage.setItem(FEED_CHOICE_KEY, '{not json');
    expect(readFeedChoice()).toEqual({});
    localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ arbeitnow: 'yes', unknown: true }));
    expect(readFeedChoice()).toEqual({});
  });
});

describe('a stored choice that names a feed which no longer exists (L-336)', () => {
  it('negative: an unknown key is ignored and the known ones are kept', () => {
    // Guardian Jobs closed on 2 Sep 2026 and its feed was removed. A machine
    // that once unticked it still has `guardian` in the store. Throwing the
    // whole object away would quietly lose the Arbeitnow tick beside it.
    localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ guardian: false, arbeitnow: true }));
    expect(readFeedChoice()).toEqual({ arbeitnow: true });
  });

  it('negative: an unknown key is ignored whatever its value', () => {
    localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ guardian: 'yes', arbeitnow: false }));
    expect(readFeedChoice()).toEqual({ arbeitnow: false });
  });

  it('boundary: a store holding only unknown keys is no choice at all', () => {
    localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ guardian: true }));
    expect(readFeedChoice()).toEqual({});
  });

  it('boundary: the next tick does not write the unknown key back', () => {
    localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ guardian: false }));
    rememberFeedChoice(readFeedChoice(), 'arbeitnow', true);
    expect(JSON.parse(localStorage.getItem(FEED_CHOICE_KEY) ?? '{}')).toEqual({ arbeitnow: true });
  });
});

describe('defaultFeeds and tickFeedsLabel (L-335)', () => {
  it('negative: a UK search with a place — nothing to tick (Guardian Jobs closed, L-336), never Arbeitnow', () => {
    expect(defaultFeeds(true)).toEqual([]);
    // No button may say "Tick 0 free feeds": there is no label at all.
    expect(tickFeedsLabel(defaultFeeds(true))).toBeNull();
  });

  it('boundary: any other search — Arbeitnow', () => {
    expect(defaultFeeds(false)).toEqual(['arbeitnow']);
    expect(tickFeedsLabel(defaultFeeds(false))).toBe('Tick Arbeitnow');
  });

  it('the default ignores a stored choice — it is what an empty store would tick', () => {
    rememberFeedChoice({}, 'arbeitnow', false);
    expect(defaultFeeds(false)).toEqual(['arbeitnow']);
  });

  it('tickFeeds records every one as the user’s own tick, keeping the rest', () => {
    const next = tickFeeds({ arbeitnow: false }, ['arbeitnow']);
    expect(next).toEqual({ arbeitnow: true });
    expect(readFeedChoice()).toEqual({ arbeitnow: true });
  });

  it('boundary: ticking nothing changes nothing', () => {
    expect(tickFeeds({ arbeitnow: false }, [])).toEqual({ arbeitnow: false });
  });
});
