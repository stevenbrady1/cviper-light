/**
 * The country a search is for (L-417).
 *
 * ============================================================================
 * THE APP NEVER GUESSES. IT ASKS, ONCE (owner decision, 13 Nov 2026)
 * ============================================================================
 * Nothing here reads the computer's time zone or language. A brand-new install
 * has no country until the person picks one on Search, and until then Search
 * sends nothing. `country.test.ts` forbids the guess by name.
 *
 * ============================================================================
 * WHO IS ASKED IS SETTLED ONCE, AT THE FIRST START (`settleCountry`)
 * ============================================================================
 * Someone who used the app before this build searched the United Kingdom, the
 * only country there was, so they get `gb` saved and are never asked. A new
 * install gets the NOT-CHOSEN marker instead. The marker is what makes that
 * hold: a new user sets the welcome flag the moment they leave the welcome, so
 * without it their second launch would look like "used the app before" and
 * quietly become the United Kingdom.
 *
 * ============================================================================
 * BROWSER STORAGE, LIKE THE REST OF SEARCH'S CONVENIENCES
 * ============================================================================
 * Under the app prefix, so "Delete everything" clears it
 * (`erase/localStorageKeys.contract.test.ts`); backups do not carry it, like
 * its neighbours. A value that is not on the list is NOT CHOSEN, never trusted.
 * Storage that cannot be read: nothing is saved, the person is asked, and the
 * answer lasts for the sitting (`sitting` below).
 */
import {
  ADZUNA_COUNTRIES,
  currencyFor,
  distanceUnitFor,
  isCountryCode,
  type CountryCode,
  type DistanceUnit,
  type JobProviderId,
} from '@cviper/job-apis';

import { WELCOME_STORAGE_KEY } from '../onboarding/store';

import { BOARD_CHOICE_STORAGE_KEY } from './boardChoice';
import { FEED_CHOICE_KEY } from './feedDefaults';
import { SEARCH_STORAGE_KEY } from './memory';
import { SAVED_SEARCHES_STORAGE_KEY } from './savedSearches';

/** Exported so tests assert against the real key rather than a copy of it. */
export const COUNTRY_STORAGE_KEY = 'cviper.light.country';

/** A country Adzuna has no job list for. Stored as itself; never sent anywhere. */
export const OTHER_COUNTRY = 'other';

/** What a new install holds until the person picks. Exported for the tests. */
export const COUNTRY_NOT_CHOSEN = 'not-chosen';

export type CountryChoice = CountryCode | typeof OTHER_COUNTRY;

/** Plain English names. `country.test.ts` pins one for each of the nineteen. */
const NAMES: Readonly<Record<CountryCode, string>> = {
  au: 'Australia',
  at: 'Austria',
  be: 'Belgium',
  br: 'Brazil',
  ca: 'Canada',
  fr: 'France',
  de: 'Germany',
  in: 'India',
  it: 'Italy',
  mx: 'Mexico',
  nl: 'Netherlands',
  nz: 'New Zealand',
  pl: 'Poland',
  sg: 'Singapore',
  za: 'South Africa',
  es: 'Spain',
  ch: 'Switzerland',
  gb: 'United Kingdom',
  us: 'United States',
};

/** The picker's entries: the nineteen by name, then the one that is none of them. */
export const COUNTRY_OPTIONS: readonly { readonly value: CountryChoice; readonly label: string }[] =
  [
    ...[...ADZUNA_COUNTRIES]
      .map((value) => ({ value, label: NAMES[value] }))
      .sort((left, right) => left.label.localeCompare(right.label, 'en')),
    { value: OTHER_COUNTRY, label: 'Another country' },
  ];

/** Said under the picker and beside the Search button while nothing is chosen. */
export const CHOOSE_COUNTRY_REASON = 'Choose a country to search.';

/** Read back only what is on the list. Everything else is "not chosen". */
export function parseCountry(raw: unknown): CountryChoice | null {
  return raw === OTHER_COUNTRY || isCountryCode(raw) ? raw : null;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The answer given this sitting, for a computer whose storage will not keep it. */
let sitting: CountryChoice | null = null;

/**
 * Settle who is asked. Run when the app starts, before the welcome can be
 * dismissed, and again after "Delete everything". Does nothing once settled.
 */
export function settleCountry(): void {
  try {
    const store = storage();
    if (store === null || store.getItem(COUNTRY_STORAGE_KEY) !== null) return;

    // Any one of these already in storage means the app was used before this
    // build. Listed here, not at the top: `savedSearches` imports this module.
    const usedBefore = [
      WELCOME_STORAGE_KEY,
      SEARCH_STORAGE_KEY,
      SAVED_SEARCHES_STORAGE_KEY,
      FEED_CHOICE_KEY,
      BOARD_CHOICE_STORAGE_KEY,
    ].some((key) => store.getItem(key) !== null);
    store.setItem(COUNTRY_STORAGE_KEY, usedBefore ? 'gb' : COUNTRY_NOT_CHOSEN);
  } catch {
    // Unreadable storage settles nothing: the person is asked.
  }
}

/** The chosen country, or `null` when the person has not chosen one. Never throws. */
export function readCountry(): CountryChoice | null {
  try {
    const store = storage();
    if (store !== null) return parseCountry(store.getItem(COUNTRY_STORAGE_KEY));
  } catch {
    // Fall through to this sitting's answer.
  }
  return sitting;
}

/** Remember the choice. Best-effort, like its neighbours. */
export function saveCountry(choice: CountryChoice): void {
  sitting = choice;
  try {
    storage()?.setItem(COUNTRY_STORAGE_KEY, choice);
  } catch {
    // Kept for this sitting only.
  }
}

/**
 * Why a keyed board cannot search this country, or `null` when it can.
 *
 * Adzuna serves the nineteen and nothing else. Reed lists UK jobs and takes no
 * country, so a Reed search for anywhere else would return UK adverts under
 * another country's name: it is not offered (`buildSearchParams` and Rust both
 * refuse it as well).
 */
export function countryBlocks(provider: JobProviderId, country: CountryChoice): string | null {
  if (provider === 'adzuna') {
    return country === OTHER_COUNTRY ? 'Adzuna has no job list for this country.' : null;
  }
  return country === 'gb' ? null : 'Reed lists UK jobs only.';
}

/** "£" for the United Kingdom, the currency's code elsewhere, nothing when unknown. */
export function salaryUnit(country: CountryChoice | null): string | null {
  return country === 'gb' ? '£' : currencyFor(country);
}

/**
 * The form rules that follow the country (L-421): the salary message names
 * pounds for the United Kingdom only, and the distance is in the country's
 * unit (`distanceUnitFor`, the one place that is decided).
 */
export function formRulesFor(country: CountryChoice | null): {
  readonly pounds: boolean;
  readonly distanceUnit: DistanceUnit;
} {
  return { pounds: country === 'gb', distanceUnit: distanceUnitFor(country) };
}
