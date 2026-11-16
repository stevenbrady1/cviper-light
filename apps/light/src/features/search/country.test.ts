// @vitest-environment jsdom
/**
 * The country a search is for (L-417): what is stored, who is asked, and what
 * each keyed board can search.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ADZUNA_COUNTRIES } from '@cviper/job-apis';

import { forgetLocalStorage } from '../settings/erase/port';
import { WELCOME_STORAGE_KEY } from '../onboarding/store';

import { BOARD_CHOICE_STORAGE_KEY } from './boardChoice';
import {
  COUNTRY_NOT_CHOSEN,
  COUNTRY_OPTIONS,
  COUNTRY_STORAGE_KEY,
  countryBlocks,
  parseCountry,
  readCountry,
  salaryUnit,
  saveCountry,
  settleCountry,
} from './country';
import { FEED_CHOICE_KEY } from './feedDefaults';
import { SEARCH_STORAGE_KEY } from './memory';
import { SAVED_SEARCHES_STORAGE_KEY } from './savedSearches';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what is stored', () => {
  it('happy: a saved us is read back as us', () => {
    saveCountry('us');

    expect(localStorage.getItem(COUNTRY_STORAGE_KEY)).toBe('us');
    expect(readCountry()).toBe('us');
  });

  it('boundary: the first and last codes on the list, and "another country", save and load', () => {
    for (const choice of [ADZUNA_COUNTRIES[0], ADZUNA_COUNTRIES.at(-1)!, 'other'] as const) {
      saveCountry(choice);
      expect(readCountry()).toBe(choice);
    }
  });

  it.each([
    'xx',
    'GB',
    ' gb',
    'gb ',
    'uk',
    '',
    '42',
    'null',
    '{"country":"gb"}',
    '../',
    'constructor',
    COUNTRY_NOT_CHOSEN,
  ])('negative: a stored %j is not chosen, never trusted', (stored) => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, stored);

    expect(readCountry()).toBeNull();
  });

  it('negative: nothing stored at all is not chosen', () => {
    expect(readCountry()).toBeNull();
  });

  it.each([42, null, undefined, true, ['gb'], { code: 'gb' }])(
    'negative: %j is not a country',
    (value) => {
      expect(parseCountry(value)).toBeNull();
    },
  );
});

describe('who is asked: settled once, at the first start', () => {
  it.each([
    WELCOME_STORAGE_KEY,
    SEARCH_STORAGE_KEY,
    SAVED_SEARCHES_STORAGE_KEY,
    FEED_CHOICE_KEY,
    BOARD_CHOICE_STORAGE_KEY,
  ])('someone with only %s in storage used the app before: gb, saved once', (key) => {
    localStorage.setItem(key, 'anything');

    settleCountry();

    expect(localStorage.getItem(COUNTRY_STORAGE_KEY)).toBe('gb');
    expect(readCountry()).toBe('gb');
  });

  it('boundary: all five at once is still one United Kingdom', () => {
    for (const key of [
      WELCOME_STORAGE_KEY,
      SEARCH_STORAGE_KEY,
      SAVED_SEARCHES_STORAGE_KEY,
      FEED_CHOICE_KEY,
      BOARD_CHOICE_STORAGE_KEY,
    ]) {
      localStorage.setItem(key, 'anything');
    }

    settleCountry();

    expect(readCountry()).toBe('gb');
  });

  it('a new install is not chosen, and the marker says so', () => {
    settleCountry();

    expect(localStorage.getItem(COUNTRY_STORAGE_KEY)).toBe(COUNTRY_NOT_CHOSEN);
    expect(readCountry()).toBeNull();
  });

  it('regression: a new install is STILL not chosen after the welcome flag is set and the app starts again', () => {
    settleCountry();
    // The person leaves the welcome, then closes and reopens the app.
    localStorage.setItem(WELCOME_STORAGE_KEY, 'seen');
    settleCountry();

    expect(readCountry()).toBeNull();
  });

  it('never overwrites a choice that was made', () => {
    saveCountry('de');
    localStorage.setItem(WELCOME_STORAGE_KEY, 'seen');

    settleCountry();

    expect(readCountry()).toBe('de');
  });

  it('other data that is not one of the five does not make someone an existing user', () => {
    localStorage.setItem('cviper.light.requestLog', '[]');

    settleCountry();

    expect(readCountry()).toBeNull();
  });
});

describe('storage that cannot be read', () => {
  /** A copy of the module that has been told nothing this sitting. */
  async function freshSitting() {
    vi.resetModules();
    return import('./country');
  }

  function breakStorage(): void {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is disabled');
    });
  }

  it('edge: nothing is thrown, nothing is settled, and the person is asked', async () => {
    const country = await freshSitting();
    breakStorage();

    expect(() => country.settleCountry()).not.toThrow();
    expect(country.readCountry()).toBeNull();
  });

  it('edge: a choice lasts for the sitting, and is gone with it', async () => {
    const country = await freshSitting();
    breakStorage();

    expect(() => country.saveCountry('ca')).not.toThrow();
    expect(country.readCountry()).toBe('ca');

    // The app is closed and opened again.
    expect((await freshSitting()).readCountry()).toBeNull();
  });
});

describe('"Delete everything"', () => {
  it('clears the country with every other preference, and the person is asked again', () => {
    saveCountry('fr');

    forgetLocalStorage(localStorage);
    expect(localStorage.getItem(COUNTRY_STORAGE_KEY)).toBeNull();
    expect(readCountry()).toBeNull();

    // The app settles again straight after an erase: an emptied computer is new.
    settleCountry();
    localStorage.setItem(WELCOME_STORAGE_KEY, 'seen');
    settleCountry();
    expect(readCountry()).toBeNull();
  });
});

describe('the picker', () => {
  it('names each of the nineteen once, in alphabetical order, then "Another country"', () => {
    expect(COUNTRY_OPTIONS.map((option) => option.label)).toEqual([
      'Australia',
      'Austria',
      'Belgium',
      'Brazil',
      'Canada',
      'France',
      'Germany',
      'India',
      'Italy',
      'Mexico',
      'Netherlands',
      'New Zealand',
      'Poland',
      'Singapore',
      'South Africa',
      'Spain',
      'Switzerland',
      'United Kingdom',
      'United States',
      'Another country',
    ]);
    expect(
      COUNTRY_OPTIONS.map((option) => option.value)
        .slice(0, -1)
        .sort(),
    ).toEqual([...ADZUNA_COUNTRIES].sort());
    expect(COUNTRY_OPTIONS.at(-1)?.value).toBe('other');
  });

  it.each([
    ['gb', 'United Kingdom'],
    ['us', 'United States'],
    ['de', 'Germany'],
    ['ch', 'Switzerland'],
    ['za', 'South Africa'],
    ['es', 'Spain'],
  ])('%s is %s', (code, name) => {
    expect(COUNTRY_OPTIONS.find((option) => option.value === code)?.label).toBe(name);
  });
});

describe('which keyed board can search which country', () => {
  it('Adzuna searches each of the nineteen', () => {
    for (const code of ADZUNA_COUNTRIES) expect(countryBlocks('adzuna', code)).toBeNull();
  });

  it('negative: Adzuna has no job list for "another country"', () => {
    expect(countryBlocks('adzuna', 'other')).toBe('Adzuna has no job list for this country.');
  });

  it('Reed searches the United Kingdom, and only the United Kingdom', () => {
    expect(countryBlocks('reed', 'gb')).toBeNull();
    for (const choice of [...ADZUNA_COUNTRIES.filter((code) => code !== 'gb'), 'other'] as const) {
      expect(countryBlocks('reed', choice)).toBe('Reed lists UK jobs only.');
    }
  });
});

describe('the salary box’s unit', () => {
  it('is £ for the United Kingdom and the currency code elsewhere', () => {
    expect(salaryUnit('gb')).toBe('£');
    expect(salaryUnit('de')).toBe('EUR');
    expect(salaryUnit('ca')).toBe('CAD');
    expect(salaryUnit('us')).toBe('USD');
  });

  it('negative: is nothing when no currency is known', () => {
    expect(salaryUnit('other')).toBeNull();
    expect(salaryUnit(null)).toBeNull();
  });
});
