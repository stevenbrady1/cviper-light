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
  it('a UK location: Guardian Jobs only', () => {
    expect([...chosenFeeds({}, 'London')]).toEqual(['guardian']);
  });

  it('a European or empty location: both feeds', () => {
    expect([...chosenFeeds({}, 'Berlin')]).toEqual(['arbeitnow', 'guardian']);
    expect([...chosenFeeds({}, '')]).toEqual(['arbeitnow', 'guardian']);
  });

  it('the user’s own choice wins over the default, either way', () => {
    expect([...chosenFeeds({ arbeitnow: true }, 'London')]).toEqual(['arbeitnow', 'guardian']);
    expect([...chosenFeeds({ arbeitnow: false }, 'Berlin')]).toEqual(['guardian']);
    expect([...chosenFeeds({ guardian: false }, 'Berlin')]).toEqual(['arbeitnow']);
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
