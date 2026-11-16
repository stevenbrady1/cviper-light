/**
 * The closed list of countries a search can name (L-415).
 *
 * Typed out again here on purpose, twice: a test that read the module's own
 * list would agree with whatever that list happened to say, and a typo in a
 * country code is a request to an address Adzuna does not serve.
 */
import { describe, expect, it } from 'vitest';

import { ADZUNA_COUNTRIES, DEFAULT_COUNTRY, currencyFor, isCountryCode } from './countries';

/** The `country` enum in Adzuna's own API description, in its order. */
const ADZUNA_SERVES = [
  'gb',
  'us',
  'at',
  'au',
  'be',
  'br',
  'ca',
  'ch',
  'de',
  'es',
  'fr',
  'in',
  'it',
  'mx',
  'nl',
  'nz',
  'pl',
  'sg',
  'za',
];

const LOCAL_CURRENCY: readonly (readonly [string, string])[] = [
  ['gb', 'GBP'],
  ['us', 'USD'],
  ['at', 'EUR'],
  ['au', 'AUD'],
  ['be', 'EUR'],
  ['br', 'BRL'],
  ['ca', 'CAD'],
  ['ch', 'CHF'],
  ['de', 'EUR'],
  ['es', 'EUR'],
  ['fr', 'EUR'],
  ['in', 'INR'],
  ['it', 'EUR'],
  ['mx', 'MXN'],
  ['nl', 'EUR'],
  ['nz', 'NZD'],
  ['pl', 'PLN'],
  ['sg', 'SGD'],
  ['za', 'ZAR'],
];

/** Everything a hostile or careless caller might send where a code belongs. */
const NOT_A_COUNTRY: readonly unknown[] = [
  'GB',
  'Gb',
  'gB',
  '',
  ' ',
  ' gb',
  'gb ',
  'gb\n',
  'xx',
  'uk',
  'g',
  'gbr',
  '../',
  '..',
  '/',
  '%2f',
  '%2F',
  'gb/../us',
  'gb?x=1',
  'gb#',
  'gb&app_key=stolen',
  'us/search/1?what=',
  'https://example.com',
  'x'.repeat(10_000),
  // Names every object has: a lookup written as `code in TABLE` would say yes.
  'constructor',
  'toString',
  '__proto__',
  'hasOwnProperty',
  null,
  undefined,
  42,
  0,
  true,
  ['gb'],
  { code: 'gb' },
];

describe('the country list', () => {
  it('is exactly the 19 codes Adzuna serves, and nothing else', () => {
    expect([...ADZUNA_COUNTRIES]).toEqual(ADZUNA_SERVES);
    expect(new Set(ADZUNA_COUNTRIES).size).toBe(19);
  });

  it('means the United Kingdom when a search names no country', () => {
    expect(DEFAULT_COUNTRY).toBe('gb');
  });

  it.each(ADZUNA_SERVES)('happy: %s is a country a search may name', (code) => {
    expect(isCountryCode(code)).toBe(true);
  });

  it.each(NOT_A_COUNTRY.map((value) => [value]))('negative: %j is refused', (value) => {
    expect(isCountryCode(value)).toBe(false);
  });
});

describe('the currency a country’s salaries are in', () => {
  it.each(LOCAL_CURRENCY)('%s is paid in %s', (code, currency) => {
    expect(currencyFor(code)).toBe(currency);
  });

  it('has a currency for every country on the list, each a three-letter code', () => {
    for (const code of ADZUNA_COUNTRIES) {
      expect(currencyFor(code)).toMatch(/^[A-Z]{3}$/);
    }
  });

  it.each(NOT_A_COUNTRY.map((value) => [value]))(
    'negative: %j never produces a currency',
    (value) => {
      expect(currencyFor(value)).toBeNull();
    },
  );
});
