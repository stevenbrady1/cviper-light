/**
 * The countries a search can be asked for (L-415).
 *
 * ============================================================================
 * A CLOSED SET. JAVASCRIPT PICKS FROM IT; IT NEVER SUPPLIES ADDRESS TEXT.
 * ============================================================================
 * Adzuna takes the country as a PATH segment of its address. These are exactly
 * the nineteen codes its API description lists
 * (developer.adzuna.com/swagger/spec/test2.json, the `country` parameter of
 * `/jobs/{country}/search/{page}`), in its order. Rust holds the same list as
 * an enum and maps each code to its own fixed address — see `Country` in
 * `src-tauri/src/jobs.rs`. A value that is not on the list never reaches a
 * request on either side of the boundary.
 */
export const ADZUNA_COUNTRIES = [
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
] as const;

export type CountryCode = (typeof ADZUNA_COUNTRIES)[number];

/** What a search that names no country means. Rust reads an absent one the same way. */
export const DEFAULT_COUNTRY: CountryCode = 'gb';

/**
 * The currency each country's salaries are in.
 *
 * AN ASSUMPTION, NOT YET CONFIRMED BY A REAL SEARCH. Adzuna's API description
 * says its salary figures are "given in the local currency" and names no codes,
 * and its responses carry no currency field. This table is our reading of
 * "local". The first real search of each country is the check.
 */
const CURRENCY: Readonly<Record<CountryCode, string>> = {
  gb: 'GBP',
  us: 'USD',
  at: 'EUR',
  au: 'AUD',
  be: 'EUR',
  br: 'BRL',
  ca: 'CAD',
  ch: 'CHF',
  de: 'EUR',
  es: 'EUR',
  fr: 'EUR',
  in: 'INR',
  it: 'EUR',
  mx: 'MXN',
  nl: 'EUR',
  nz: 'NZD',
  pl: 'PLN',
  sg: 'SGD',
  za: 'ZAR',
};

/** Is this exactly one of the nineteen? Case, spaces and everything else count. */
export function isCountryCode(value: unknown): value is CountryCode {
  // The list, not `value in CURRENCY`: every object answers yes to "constructor".
  return typeof value === 'string' && (ADZUNA_COUNTRIES as readonly string[]).includes(value);
}

/** The ISO currency code for a country on the list, or `null` for anything else. */
export function currencyFor(country: unknown): string | null {
  return isCountryCode(country) ? CURRENCY[country] : null;
}

/**
 * The two units a search distance can be in (L-421). A CLOSED SET.
 *
 * Adzuna's `distance` is kilometres and Reed's is miles, so a distance crosses
 * to Rust as a number AND one of these, never as a bare number (L-394 was the
 * bare number). Rust holds the same two as an enum — `DistanceUnit` in
 * `src-tauri/src/jobs.rs`, where a test reads this list to check.
 */
export const DISTANCE_UNITS = ['miles', 'km'] as const;

export type DistanceUnit = (typeof DISTANCE_UNITS)[number];

/** A search radius: the number as typed, and the unit it was typed in. */
export interface Distance {
  readonly value: number;
  readonly unit: DistanceUnit;
}

/** Is this exactly one of the two? */
export function isDistanceUnit(value: unknown): value is DistanceUnit {
  return typeof value === 'string' && (DISTANCE_UNITS as readonly string[]).includes(value);
}

/**
 * The unit a country's searches are in. THE ONE PLACE THIS IS DECIDED.
 *
 * Miles for the United Kingdom and the United States; kilometres for every
 * other country, including one that is not on the list. A search that names no
 * country is a United Kingdom search (`DEFAULT_COUNTRY`), so it is miles.
 */
export function distanceUnitFor(country: unknown): DistanceUnit {
  const code = country ?? DEFAULT_COUNTRY;
  return code === 'gb' || code === 'us' ? 'miles' : 'km';
}
