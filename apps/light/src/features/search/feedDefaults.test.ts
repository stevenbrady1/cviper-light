// @vitest-environment jsdom
/**
 * L-219: Arbeitnow is mostly Germany and the rest of Europe, so it starts
 * switched off for a search whose location is in the UK — and a choice the
 * user made themselves wins, and is remembered.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FEED_CHOICE_KEY,
  chosenFeeds,
  isUkLocation,
  readFeedChoice,
  rememberFeedChoice,
} from './feedDefaults';

beforeEach(() => localStorage.clear());

describe('isUkLocation', () => {
  it.each([
    'London',
    'london',
    ' Greater London ',
    'Manchester',
    'Milton Keynes',
    'Leeds, West Yorkshire',
    'Edinburgh',
    'Cardiff',
    'Belfast',
    'SW1A 1AA',
    'sw1a1aa',
    'EC2',
    'M1',
    'UK',
    'United Kingdom',
    'England',
    'Remote, UK',
  ])('happy: "%s" is in the UK', (location) => {
    expect(isUkLocation(location)).toBe(true);
  });

  it.each(['Berlin', 'Germany', 'Munich', 'Paris', 'Amsterdam', 'Dublin', 'Remote', 'Europe'])(
    'negative: "%s" is not',
    (location) => {
      expect(isUkLocation(location)).toBe(false);
    },
  );

  it('boundary: an empty location says nothing about the UK', () => {
    expect(isUkLocation('')).toBe(false);
    expect(isUkLocation('   ')).toBe(false);
  });

  it('edge: a word merely containing a UK place is not one', () => {
    expect(isUkLocation('Londoners')).toBe(false);
    expect(isUkLocation('New York')).toBe(false);
    expect(isUkLocation('Perth, WA')).toBe(false);
    expect(isUkLocation('Dublin, Ireland')).toBe(false);
  });
});

describe('chosenFeeds', () => {
  it('a UK location: no free feed (Guardian Jobs closed, L-336)', () => {
    expect([...chosenFeeds({}, 'London')]).toEqual([]);
  });

  it('a European or empty location: Arbeitnow', () => {
    expect([...chosenFeeds({}, 'Berlin')]).toEqual(['arbeitnow']);
    expect([...chosenFeeds({}, '')]).toEqual(['arbeitnow']);
  });

  it('the user’s own choice wins over the default, either way', () => {
    expect([...chosenFeeds({ arbeitnow: true }, 'London')]).toEqual(['arbeitnow']);
    expect([...chosenFeeds({ arbeitnow: false }, 'Berlin')]).toEqual([]);
  });
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
