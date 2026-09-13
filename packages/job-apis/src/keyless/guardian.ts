/**
 * Guardian Jobs' RSS -> the shared `Job` shape.
 *
 * ============================================================================
 * XML IS PARSED HERE, IN TYPESCRIPT, WITH NO NEW DEPENDENCY IN EITHER LANGUAGE
 * ============================================================================
 * Rust fetches the bytes and hands them over untouched; this reads them with
 * `DOMParser`, which the WebView already has. Two things that were considered
 * and rejected:
 *
 *   * an XML crate on the Rust side — a new dependency in the part of the app
 *     that holds the credentials, to do a job the renderer can already do;
 *   * regular expressions over the markup — which is how `<title>` inside
 *     `<channel>` ends up being read as a job title, and how a CDATA block or
 *     an escaped entity quietly loses half an advert.
 *
 * ============================================================================
 * WHAT THIS FEED ACTUALLY CONTAINS
 * ============================================================================
 * Twenty items. UK only, and skewed to public sector, education, charity and
 * media — measured, not assumed. There is no keyword parameter: the same twenty
 * come back whatever is asked for, which is why the app narrows them on this
 * machine (`filter.ts`) and why nothing here is called a search.
 *
 * The shape is not the tidy one an RSS reader expects, either. Guardian packs
 * the employer into the front of `<title>` ("EMPLOYER: Job Title") and puts the
 * salary on the first line of `<description>` and the location on the last, so
 * most of this file is reading those three conventions carefully and refusing
 * to guess when they do not hold.
 */
import { err, ok, type Job, type Result, type SalaryPeriod } from '@cviper/core-types';

import { asHttpUrl, asText, UNKNOWN_COMPANY } from '../normalise';
import { type NormaliseContext, type SearchResultJob } from '../normalise';
import { classifyReedContractType } from '../reed-contract';
import { classifyReedSalaryPeriod } from '../reed-salary';
import { normaliseDescription } from '../text';

import { rfc822ToIsoDate } from './dates';
import { keylessUnreadable, type KeylessError } from './errors';

/** Both providers are read against the UK market — see `jobs.rs`. */
const CURRENCY = 'GBP';

/** `£38,976`, `£12.60`, `£101332`. The capture excludes the sign. */
const MONEY = /£\s*(\d[\d,]*(?:\.\d{1,2})?)/g;

/** What may sit between two figures for them to be one range. */
const RANGE_SEPARATOR = /^\s*(?:-|–|—|to)\s*$/i;

/** A line that states a period in words, which beats any magnitude rule. */
const PERIOD_WORDS: readonly { readonly pattern: RegExp; readonly period: SalaryPeriod }[] = [
  { pattern: /per hour|an hour|hourly|\/\s*hour|\/\s*hr|p\/h/i, period: 'hour' },
  { pattern: /per day|day rate|day-rate|daily|\/\s*day|per diem/i, period: 'day' },
  { pattern: /per annum|per year|a year|annually|\bp\.?a\.?\b|\bfte\b/i, period: 'year' },
];

/** `£38,976` -> `38976`. Commas are thousands separators, never decimals. */
function toAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number(raw.replaceAll(',', ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

interface StatedSalary {
  readonly min: number | null;
  readonly max: number | null;
  readonly period: SalaryPeriod | null;
}

const NO_SALARY: StatedSalary = { min: null, max: null, period: null };

/**
 * The salary line -> figures and the unit they are in.
 *
 * ============================================================================
 * THE UNIT IS READ FROM THE WORDS FIRST, AND ONLY THEN FROM THE MAGNITUDE
 * ============================================================================
 * `classifyReedSalaryPeriod` decides by size, because Reed's numbers arrive
 * with no words at all. Here there are words, and they must win: £12.60 is a
 * plausible hourly rate and an absurd day rate, and the magnitude rule would
 * confidently call it a day rate and print it on a card. The size rule stays as
 * the fallback for a line that states figures and no unit.
 *
 * The figures are found ANYWHERE in the line, not anchored to its start:
 * "Grade 4 (Outer London): £30,288 - £32,070 FTE" is a real line in this feed,
 * and an anchored pattern would report no salary for it.
 */
export function readStatedSalary(line: string): StatedSalary {
  const matches = [...line.matchAll(MONEY)];
  const min = toAmount(matches[0]?.[1]);
  if (min === null) return NO_SALARY;

  // A second figure is only the top of a range when nothing but a separator
  // stands between the two. "£30,000 car allowance £5,000" is two facts.
  let max: number | null = null;
  const first = matches[0];
  const second = matches[1];
  if (first !== undefined && second !== undefined && second.index !== undefined) {
    const between = line.slice(first.index + first[0].length, second.index);
    if (RANGE_SEPARATOR.test(between)) max = toAmount(second[1]);
  }

  const stated = PERIOD_WORDS.find((entry) => entry.pattern.test(line));
  return { min, max, period: stated?.period ?? classifyReedSalaryPeriod(min, max) };
}

/** The four salary fields, decided together so they can never disagree. */
function salaryFields(
  stated: StatedSalary,
): Pick<Job, 'salary_min' | 'salary_max' | 'salary_currency' | 'salary_period'> {
  // Same rule as `normalise.ts`: a currency or a period with no figure beside
  // it is noise at best and a claim we cannot support at worst.
  if (stated.min === null && stated.max === null) {
    return { salary_min: null, salary_max: null, salary_currency: null, salary_period: null };
  }
  return {
    salary_min: stated.min,
    salary_max: stated.max,
    salary_currency: CURRENCY,
    salary_period: stated.period,
  };
}

/** `EMPLOYER: Job Title` -> the two of them, or the whole thing as a title. */
export function splitEmployerFromTitle(raw: string): { company: string; title: string } {
  const separator = raw.indexOf(': ');
  if (separator <= 0) return { company: UNKNOWN_COMPANY, title: raw.trim() };

  const company = raw.slice(0, separator).trim();
  const title = raw.slice(separator + 2).trim();
  // Both halves must be real. "ACME: " is an employer and no job.
  if (company === '' || title === '') return { company: UNKNOWN_COMPANY, title: raw.trim() };

  return { company, title };
}

/** `.../job/10176723/social-worker/?TrackID=8` -> `10176723`. */
function jobIdFromLink(url: string | null): string | null {
  if (url === null) return null;
  return /\/job\/(\d+)\b/.exec(url)?.[1] ?? null;
}

/** The non-empty lines of a description, in order, trimmed. */
function linesOf(description: string): string[] {
  return description
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * The last line of the description, when it looks like a place.
 *
 * Guardian puts the location there. When an advert has only a salary line and
 * an employer line, the "last line" is one of those, and printing a salary in
 * the location slot is worse than printing nothing — so a candidate carrying a
 * figure or ending in the employer line's colon is refused.
 */
function locationFrom(lines: readonly string[]): string | null {
  if (lines.length < 2) return null;

  const candidate = lines[lines.length - 1];
  if (candidate === undefined) return null;
  if (candidate.includes('£') || candidate.endsWith(':')) return null;

  return candidate;
}

/** The text of a direct child element, or `null`. */
function childText(item: Element, name: string): string | null {
  for (const child of item.children) {
    if (child.localName === name) return asText(child.textContent);
  }
  return null;
}

/** The raw text of a direct child, newlines and all. `textContent` unchanged. */
function childRaw(item: Element, name: string): string | null {
  for (const child of item.children) {
    if (child.localName === name) return child.textContent;
  }
  return null;
}

function normaliseItem(item: Element, context: NormaliseContext): SearchResultJob | null {
  const rawTitle = childText(item, 'title');
  // No title is the one unusable case: it is the card's heading and what the
  // local filter reads.
  if (rawTitle === null) return null;

  const { company, title } = splitEmployerFromTitle(rawTitle);
  const description = childRaw(item, 'description') ?? '';
  const lines = linesOf(description);
  const stated = lines[0] === undefined ? NO_SALARY : readStatedSalary(lines[0]);
  const url = asHttpUrl(childText(item, 'link')) ?? asHttpUrl(childText(item, 'guid'));

  const job: Job = {
    id: context.newId(),
    source: 'guardian',
    external_id: jobIdFromLink(url),
    title,
    company,
    location: locationFrom(lines),
    ...salaryFields(stated),
    description: normaliseDescription(description),
    // Verbatim. The feed's links carry Guardian's own `TrackID` and
    // `utm_source=rss`; CViper adds nothing and removes nothing, because
    // rewriting somebody else's link is not this app's business either way.
    url,
    posted_date: rfc822ToIsoDate(childText(item, 'pubDate')),
    created_at: context.createdAt,
  };

  return {
    job,
    // The same three-tier classifier Reed's adverts go through. Guardian states
    // no contract field, so it lands on tier 2 — "interim", "fixed term", "per
    // day" and the rest, scanned in the title and the description.
    contractType: classifyReedContractType({
      contractType: null,
      jobTitle: title,
      jobDescription: description,
      minimumSalary: stated.min,
      maximumSalary: stated.max,
    }),
  };
}

/** Is this document actually an RSS feed, rather than an error page? */
function looksLikeRss(document: Document): boolean {
  const root = document.documentElement.localName.toLowerCase();
  return root === 'rss' || root === 'feed' || root === 'channel';
}

/**
 * The whole feed -> adverts, or one error naming the source.
 *
 * An RSS document with no items parses to an empty list rather than an error:
 * "this is a feed and it is empty" is a true reading of the bytes. Whether an
 * empty list is a PROBLEM is decided in `browse.ts`, where it becomes a loud
 * per-source message — because a feed of "the most recent jobs" that has
 * nothing in it has stopped working, and that must never reach the user as an
 * empty results list.
 */
export function normaliseGuardianFeed(
  body: string,
  context: NormaliseContext,
): Result<SearchResultJob[], KeylessError> {
  if (body.trim() === '') return err(keylessUnreadable('guardian'));

  // `DOMParser` is the WebView's, and jsdom's in tests. There is no third
  // environment this code runs in; if there ever is, this says so rather than
  // throwing out of a function whose whole contract is that it cannot.
  if (typeof DOMParser === 'undefined') return err(keylessUnreadable('guardian'));

  let document: Document;
  try {
    document = new DOMParser().parseFromString(body, 'application/xml');
  } catch {
    return err(keylessUnreadable('guardian'));
  }

  // Both the WebView and jsdom report a malformed document by handing back a
  // `parsererror` element rather than by throwing.
  if (document.getElementsByTagName('parsererror').length > 0) {
    return err(keylessUnreadable('guardian'));
  }
  if (!looksLikeRss(document)) return err(keylessUnreadable('guardian'));

  const jobs: SearchResultJob[] = [];
  for (const item of document.getElementsByTagName('item')) {
    const entry = normaliseItem(item, context);
    if (entry !== null) jobs.push(entry);
  }

  return ok(jobs);
}
