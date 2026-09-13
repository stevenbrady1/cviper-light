/**
 * Arbeitnow's job-board feed -> the shared `Job` shape.
 *
 * ============================================================================
 * WHAT THIS FEED IS, SAID PLAINLY, BECAUSE THE UI HAS TO SAY IT TOO
 * ============================================================================
 * Arbeitnow is a GERMANY-FIRST board that has recently added the UK. Measured
 * on a live page of 250 adverts: 59 were plausibly UK and 42 of those were
 * London; the rest was Berlin, Hamburg, Munich and Paris. It is tech- and
 * professional-skewed, updated hourly, ordered newest first.
 *
 * That is worth knowing here rather than only in the UI copy, because the
 * temptation when UK numbers look thin is to fetch more pages, and the honest
 * answer is that more pages mostly buy more Berlin. The page count is fixed in
 * `types.ts` for that reason.
 *
 * ============================================================================
 * THEIR TERMS, VERBATIM, AND WHAT WE DO ABOUT THEM
 * ============================================================================
 * The feed states its own terms in `meta.terms` — see `ARBEITNOW_TERMS`. Two
 * obligations follow, and both are kept in code rather than in a promise:
 *
 *   * "I would appreciate linking back to the site" — every advert keeps its
 *     `url`, which points at Arbeitnow's own page for that job, and the search
 *     screen shows an Arbeitnow credit whenever one of its adverts is on
 *     screen. Same treatment Adzuna's terms already get.
 *   * "please do not abuse" — three requests per browse, only ever from a
 *     button press. No polling, no search-as-you-type, no refresh on focus, and
 *     Rust enforces a minimum gap between browses on top of that.
 *
 * ============================================================================
 * EVERY FIELD IS UNTRUSTED
 * ============================================================================
 * Same rules as `normalise.ts`, and for the same reason: this is a third-party
 * feed of text anybody can post into. Nothing indexes and hopes, one unusable
 * advert is skipped rather than allowed to lose the page around it, and no
 * function in this file can throw.
 */
import { err, ok, type Job, type Result } from '@cviper/core-types';

import { asExternalId, asHttpUrl, asRecord, asText, UNKNOWN_COMPANY } from '../normalise';
import { normaliseDescription } from '../text';
import { type NormaliseContext, type SearchResultJob } from '../normalise';
import { type ReedContractType } from '../reed-contract';

import { unixSecondsToIsoDate } from './dates';
import { keylessUnreadable, type KeylessError } from './errors';

/**
 * The feed's own `meta.terms`, copied exactly as it sends them.
 *
 * Here so the obligation is in the source somebody reads before changing this
 * file, and so `arbeitnow.test.ts` can hold a recorded response to it.
 */
export const ARBEITNOW_TERMS =
  'This is a free public API for jobs, please do not abuse. I would appreciate linking back ' +
  'to the site. By using the API, you agree to the terms of service present on Arbeitnow.com';

/** What the search screen shows wherever an Arbeitnow advert appears. */
export const ARBEITNOW_ATTRIBUTION = 'Jobs from Arbeitnow';

/**
 * `job_types` and `tags` -> the contract chip on the card.
 *
 * The feed's vocabulary is uncontrolled and partly German ("Werkstudium",
 * "berufserfahren", "fulltime permanent"), so this matches on substrings of a
 * lowercased join rather than on an enumeration that would be wrong by next
 * week. Order matters: "working student" is part-time before it is anything
 * else, and a permanent role advertised as "fulltime permanent" must not be
 * read as a contract by the word "full".
 */
export function arbeitnowContractType(record: Record<string, unknown>): ReedContractType {
  const parts: string[] = [];
  for (const key of ['job_types', 'tags']) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = asText(item);
        if (text !== null) parts.push(text.toLowerCase());
      }
    }
  }

  const joined = parts.join(' ');
  if (joined.includes('intern') || joined.includes('praktik')) return 'Internship';
  if (
    joined.includes('working student') ||
    joined.includes('werkstudium') ||
    joined.includes('part time') ||
    joined.includes('part-time') ||
    joined.includes('teilzeit')
  ) {
    return 'Part-time';
  }
  if (
    joined.includes('contract') ||
    joined.includes('freelance') ||
    joined.includes('temporary') ||
    joined.includes('befristet')
  ) {
    return 'Contract';
  }
  return 'Permanent';
}

/**
 * One advert, or `null` when there is nothing worth showing.
 *
 * A missing title is the one unusable case: it is the card's heading and the
 * thing the local filter reads. Everything else has an honest absent value.
 */
function normaliseRecord(raw: unknown, context: NormaliseContext): SearchResultJob | null {
  const record = asRecord(raw);
  if (record === null) return null;

  const title = asText(record['title']);
  if (title === null) return null;

  const job: Job = {
    id: context.newId(),
    source: 'arbeitnow',
    // The slug, which is the id Arbeitnow's own URLs use, so the tracker's
    // `(source, external_id)` index recognises the same advert twice.
    external_id: asExternalId(record['slug']),
    title,
    company: asText(record['company_name']) ?? UNKNOWN_COMPANY,
    location: asText(record['location']),
    // The feed publishes NO salary. All four fields stay null rather than
    // being mined out of the description, which is how a card ends up
    // confidently stating a number nobody wrote.
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: normaliseDescription(record['description']),
    url: asHttpUrl(record['url']),
    posted_date: unixSecondsToIsoDate(record['created_at']),
    created_at: context.createdAt,
  };

  return { job, contractType: arbeitnowContractType(record) };
}

/**
 * The whole page -> adverts, or one error naming the source.
 *
 * An EMPTY `data` array is a successful parse of an empty page, not an error.
 * That distinction is deliberate and lives one layer up: `browse.ts` turns "the
 * feed published nothing" into a loud per-source message, because this function
 * cannot tell an empty page from a page that was legitimately empty and neither
 * can it know whether the other source answered.
 */
export function normaliseArbeitnowFeed(
  body: string,
  context: NormaliseContext,
): Result<SearchResultJob[], KeylessError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return err(keylessUnreadable('arbeitnow'));
  }

  const data = asRecord(parsed)?.['data'];
  if (!Array.isArray(data)) return err(keylessUnreadable('arbeitnow'));

  const jobs: SearchResultJob[] = [];
  for (const raw of data) {
    const entry = normaliseRecord(raw, context);
    if (entry !== null) jobs.push(entry);
  }

  return ok(jobs);
}
