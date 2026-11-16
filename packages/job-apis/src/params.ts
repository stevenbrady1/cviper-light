/**
 * Turning what someone typed into parameters a provider will accept.
 *
 * This is user-input code, so it is written as a validator rather than a
 * formatter: it returns a `Result`, it clamps what can sensibly be clamped, and
 * it refuses what cannot. Rust clamps the same numbers again on the far side -
 * not because this layer is untrusted by the user, but because the frontend is
 * the part an injected script gets to influence, and the second clamp is the
 * one an attacker cannot skip.
 */
import { err, ok, type Result } from '@cviper/core-types';

import {
  DEFAULT_COUNTRY,
  isCountryCode,
  isDistanceUnit,
  type CountryCode,
  type Distance,
} from './countries';
import { jobApiError, type JobApiError } from './errors';
import { toFiniteNumber } from './numbers';
import { type JobProviderId, type JobSearchParams } from './types';

/**
 * The largest page each API will return.
 *
 * Adzuna: `results_per_page` is capped at 50 (developer.adzuna.com/docs/search).
 * Reed: `resultsToTake` is capped at 100 (reed.co.uk/developers/jobseeker).
 *
 * Asking for more is not an error at either provider - they silently return
 * their maximum - so asking for more is not an error here either. It is
 * clamped, and the clamp is what makes "results per page" mean the same thing
 * in the UI as it does on the wire.
 */
export const PROVIDER_RESULT_CAP: Readonly<Record<JobProviderId, number>> = {
  adzuna: 50,
  reed: 100,
};

/** How many results to ask for when the caller does not say. */
export const DEFAULT_RESULT_LIMIT = 20;

/**
 * The longest keywords or location we will send.
 *
 * A search box is a place people paste things. 200 characters is far longer
 * than any real job title or place name, and short enough that a pasted CV
 * cannot become a query string.
 */
export const MAX_QUERY_CHARS = 200;

/** What the caller supplies. Everything but the text is optional. */
export interface SearchInput {
  readonly keywords: string;
  readonly location: string;
  readonly limit?: number;
  /** The radius and the unit it was typed in (L-421). Never a bare number. */
  readonly distance?: Distance | null;
  readonly salaryMin?: number | null;
  readonly employmentType?: 'Contract' | 'Permanent' | null;
  /** Which country to search (L-415). Absent or `null` means the United Kingdom. */
  readonly country?: CountryCode | null;
}

/**
 * Collapse anything that is not printable into single spaces.
 *
 * Control characters reach a search box by paste - a copied cell from a
 * spreadsheet carries tabs and newlines - and they have no meaning in a query.
 * Removing them here means the transport never has to think about them.
 */
function cleanQueryText(raw: string): string {
  let cleaned = '';
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    cleaned += code < 0x20 || code === 0x7f ? ' ' : character;
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

/** A positive whole number, or `null` - the value that means "do not send it". */
function positiveIntegerOrNull(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return null;

  const whole = Math.floor(parsed);
  return whole > 0 ? whole : null;
}

/**
 * The radius and its unit, or `null` for none (L-421).
 *
 * A NUMBER that cannot be read is dropped, like every other unreadable filter.
 * A UNIT that is missing or is not one of the two is different: the number is
 * real, and sending it in a guessed unit is how Adzuna was once handed miles
 * (L-394). That search is refused, and `undefined` is the refusal.
 */
function readDistance(raw: unknown): Distance | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const { value, unit } = raw as Record<string, unknown>;
  const whole = positiveIntegerOrNull(value);
  if (whole === null) return null;
  return isDistanceUnit(unit) ? { value: whole, unit } : undefined;
}

/**
 * Validate and clamp one search.
 *
 * `Err` only for the two things the user has to fix: an empty search, and text
 * long enough to be a paste accident. A filter that cannot be read is DROPPED
 * rather than refused - someone who typed a nonsense salary floor wanted a
 * search, not a lecture, and a search without the floor is the closer answer.
 */
export function buildSearchParams(
  provider: JobProviderId,
  input: SearchInput,
): Result<JobSearchParams, JobApiError> {
  const keywords = cleanQueryText(input.keywords);
  const location = cleanQueryText(input.location);

  if (keywords === '' && location === '') {
    return err(
      jobApiError(
        provider,
        'bad-request',
        'Enter a job title, some keywords, or a location before searching.',
      ),
    );
  }

  if (keywords.length > MAX_QUERY_CHARS || location.length > MAX_QUERY_CHARS) {
    // Neither the text nor its length appears in the message.
    return err(
      jobApiError(
        provider,
        'bad-request',
        'That search is too long. Use a job title and a place name rather than a pasted advert.',
      ),
    );
  }

  // L-415. A country is one of a closed list or it is refused: Adzuna takes it
  // as part of its ADDRESS, so it is never passed on as text. Rust refuses the
  // same two things again (`Country` and `validate_country` in `jobs.rs`).
  const country = input.country ?? null;
  if (country !== null) {
    if (provider === 'reed' && country !== DEFAULT_COUNTRY) {
      return err(jobApiError(provider, 'bad-request', 'Reed lists UK jobs only.'));
    }
    if (!isCountryCode(country)) {
      // Fixed words: what was sent is never repeated back.
      return err(jobApiError(provider, 'bad-request', 'Adzuna has no job list for this country.'));
    }
  }

  const distance = readDistance(input.distance);
  if (distance === undefined) {
    // The screen always names the unit, so nobody should ever read this. The
    // words are the ones a refusal by Rust already shows (`jobs/transport.ts`).
    return err(jobApiError(provider, 'bad-request', 'The search could not be sent. Try again.'));
  }

  const cap = PROVIDER_RESULT_CAP[provider];
  // `positiveIntegerOrNull` already floors; a limit of 0, a negative, or a
  // value that will not read comes back `null` and becomes one result, never
  // none - a search that silently returns nothing is the worse failure.
  const requested = positiveIntegerOrNull(input.limit ?? DEFAULT_RESULT_LIMIT);
  const limit = Math.min(requested ?? 1, cap);

  return ok({
    keywords,
    location,
    limit,
    distance,
    salaryMin: positiveIntegerOrNull(input.salaryMin),
    employmentType: input.employmentType ?? null,
    // Left out, not sent as "gb", when the caller named none: see `JobSearchParams`.
    ...(country === null ? {} : { country }),
  });
}
