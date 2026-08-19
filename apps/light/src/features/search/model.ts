/**
 * The search screen's data shapes and rules, with no React in sight.
 *
 * Everything the screen needs to decide WHAT to show lives here so it can be
 * tested without rendering anything: what the form accepts, which boards can
 * actually be searched, and how an advert is described.
 */
import {
  MAX_QUERY_CHARS,
  PROVIDER_LABEL,
  type DuplicateCluster,
  type JobProviderId,
  type SearchInput,
} from '@cviper/job-apis';
import { type JobSource } from '@cviper/core-types';

import { daysBetweenDates } from '../../lib/dates';
import { type KeyState } from '../../status/environment';

// ── The form ────────────────────────────────────────────────────────────────

/** The employment filter, as three choices rather than a nullable string. */
export type ContractChoice = 'any' | 'Contract' | 'Permanent';

export interface SearchForm {
  readonly keywords: string;
  readonly location: string;
  /** Radius in miles, as typed. Empty means "do not send a radius at all". */
  readonly distanceMiles: string;
  /** Salary floor, as typed. Empty means "do not send a floor at all". */
  readonly salaryMin: string;
  readonly contractType: ContractChoice;
}

export const EMPTY_FORM: SearchForm = {
  keywords: '',
  location: '',
  distanceMiles: '',
  salaryMin: '',
  contractType: 'any',
};

export const CONTRACT_CHOICES: readonly { value: ContractChoice; label: string }[] = [
  // "Any" first and selected by default. A search screen that quietly filters
  // out two thirds of the market before anybody touches it is a search screen
  // people conclude is broken.
  { value: 'any', label: 'Any' },
  { value: 'Contract', label: 'Contract' },
  { value: 'Permanent', label: 'Permanent' },
];

export type FormField = 'keywords' | 'location' | 'distanceMiles' | 'salaryMin';

export type FormErrors = Partial<Record<FormField, string>>;

/** A positive whole number written out in full, or `null`. */
function positiveWhole(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  if (!/^\d+$/.test(text)) return null;

  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * What is wrong with the form. An empty object means nothing is.
 *
 * ============================================================================
 * A DELIBERATE DIVERGENCE FROM `buildSearchParams`
 * ============================================================================
 * The package DROPS a filter it cannot read, which is right for a backstop:
 * somebody who typed a nonsense salary floor wanted a search, not a lecture,
 * and the package is not looking at a form.
 *
 * This is looking at a form, and here the same behaviour is the "valid but
 * inert" failure — a user types a 15-mile radius, gets results from Aberdeen,
 * and has no way to tell that the box they filled in was ignored. So the two
 * numeric filters are refused with a message, next to the box, and the search
 * does not run until they are fixed.
 *
 * The two TEXT rules deliberately match the package exactly, so the UI never
 * lets through a search the package would then refuse with a different
 * sentence.
 */
export function validateForm(formValues: SearchForm): FormErrors {
  const errors: FormErrors = {};

  const keywords = formValues.keywords.trim();
  const location = formValues.location.trim();

  if (keywords === '' && location === '') {
    errors.keywords = 'Enter a job title, some keywords, or a location before searching.';
  }

  if (keywords.length > MAX_QUERY_CHARS) {
    // Neither the text nor its length appears in the message.
    errors.keywords =
      'That is too long for a search box. Use a job title rather than a pasted advert.';
  }
  if (location.length > MAX_QUERY_CHARS) {
    errors.location = 'That is too long for a place name.';
  }

  if (formValues.distanceMiles.trim() !== '' && positiveWhole(formValues.distanceMiles) === null) {
    errors.distanceMiles = 'Enter a distance in whole miles, or leave it empty for no limit.';
  }

  if (formValues.salaryMin.trim() !== '' && positiveWhole(formValues.salaryMin) === null) {
    errors.salaryMin = 'Enter a salary as whole pounds — 45000, not £45k. Leave it empty for any.';
  }

  return errors;
}

export function formIsValid(errors: FormErrors): boolean {
  return Object.keys(errors).length === 0;
}

/** Turn a valid form into the input `searchJobs` takes. */
export function toSearchInput(formValues: SearchForm): SearchInput {
  return {
    keywords: formValues.keywords.trim(),
    location: formValues.location.trim(),
    distanceMiles: positiveWhole(formValues.distanceMiles),
    salaryMin: positiveWhole(formValues.salaryMin),
    employmentType: formValues.contractType === 'any' ? null : formValues.contractType,
  };
}

// ── Which boards can be searched ────────────────────────────────────────────

export interface ProviderAvailability {
  readonly usable: boolean;
  /** Why not, in a sentence the user can act on. `null` when it is usable. */
  readonly reason: string | null;
}

/**
 * Can this board be searched, and if not, why not?
 *
 * Three different "no"s with three different fixes, said differently. The one
 * that matters most is `unreadable`: reporting a locked keychain as "no key
 * saved" invites the user to paste a key they already have, and to conclude
 * that the app forgot it.
 */
export function providerAvailability(
  provider: JobProviderId,
  state: KeyState,
): ProviderAvailability {
  const label = PROVIDER_LABEL[provider];

  switch (state) {
    case 'configured':
      return { usable: true, reason: null };

    case 'incomplete':
      return {
        usable: false,
        reason: `${label} has only one of its two credentials saved, so it cannot answer yet. Finish it in Settings.`,
      };

    case 'unreadable':
      return {
        usable: false,
        reason: `This computer’s credential store could not be read, so CViper cannot tell whether a ${label} key is saved. Unlock it and reopen this screen.`,
      };

    case 'missing':
      return {
        usable: false,
        reason: `No ${label} key is saved. Add one in Settings — it is free, and takes a minute.`,
      };
  }
}

/**
 * Why the Search button cannot be pressed, or `null`.
 *
 * The button is ALWAYS on screen and always carries its reason — the same rule
 * the analysis view follows, and for the same reason: there is no support inbox
 * for a free offline app, so a grey button that says nothing is where a user's
 * session ends.
 *
 * The one reason that exists is worth reading carefully. It does not apologise,
 * because the two browser buttons underneath it are a real, working job search
 * that needs no key at all — and it points at them before it points at Settings.
 */
export function searchDisabledReason(usableChosen: number): string | null {
  if (usableChosen > 0) return null;

  return (
    'No job board is ticked that CViper can search from inside the app yet. The two buttons ' +
    'below run this same search in your browser and need no key at all.'
  );
}

// ── Cross-posted adverts: flagged, never merged ─────────────────────────────

/**
 * Every advert in this one's cluster, INCLUDING itself, or `null`.
 *
 * Returns the whole group rather than "the others", because the count shown on
 * screen is the size of the group and every one of them is still on the page
 * with its own apply link. Nothing here removes anything, and there is no
 * function in this module that returns a shorter list of adverts — the same
 * discipline as `clusters.ts` in `@cviper/job-apis`, for the same reason: a
 * wrong merge deletes a real advert and its apply URL with no error, and a
 * local app has no undo.
 */
export function clusterSiblings(
  jobId: string,
  clusters: readonly DuplicateCluster[],
): readonly string[] | null {
  return clusters.find((cluster) => cluster.jobIds.includes(jobId))?.jobIds ?? null;
}

/** "2 similar postings" — a flag, not a claim that anything was removed. */
export function describeCluster(size: number): string {
  return `${size} similar postings`;
}

// ── An advert's identity ────────────────────────────────────────────────────

/**
 * `reed:55512345` — the board plus the board's own id.
 *
 * `null` when there is no provider id. Every manually entered job has
 * `external_id IS NULL` and the partial unique index deliberately excludes
 * them; keying them all as `manual:` would make every hand-typed job look like
 * the same advert as every other.
 */
export function externalKey(source: JobSource, externalId: string | null): string | null {
  if (externalId === null || externalId.trim() === '') return null;
  return `${source}:${externalId}`;
}

// ── When it was posted ──────────────────────────────────────────────────────

/** Past this many days, a count stops helping and the date says more. */
const DAYS_BEFORE_A_DATE_IS_CLEARER = 30;

/**
 * "Posted 5 days ago", or `null` when the board did not say.
 *
 * `null` rather than "recently": Reed's own date format broke the web app's
 * parser so completely that every Reed advert was stamped with today, and
 * "posted 3 days ago" was never true for Reed. An unreadable date is not
 * today, and saying nothing is the honest answer.
 */
export function postedLabel(postedDate: string | null, today: string): string | null {
  if (postedDate === null) return null;

  const days = daysBetweenDates(postedDate, today);
  if (days === null) return null;

  // Clamped at zero: a board with a clock a few hours ahead is not a reason to
  // say "posted -1 days ago".
  if (days <= 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  if (days <= DAYS_BEFORE_A_DATE_IS_CLEARER) return `Posted ${days} days ago`;
  return `Posted ${postedDate}`;
}
