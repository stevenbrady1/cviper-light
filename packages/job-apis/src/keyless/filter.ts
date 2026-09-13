/**
 * Narrowing a browsed page down to what the user asked for — ON THIS MACHINE.
 *
 * ============================================================================
 * THIS EXISTS BECAUSE THE FEEDS CANNOT FILTER. SAY SO, DO NOT HIDE IT.
 * ============================================================================
 * Neither keyless feed accepts a query. Guardian Jobs returns the same twenty
 * items whatever is asked of it; Arbeitnow returns its most recent page. So the
 * app downloads a page of recent adverts and narrows it here, after the fact,
 * in the renderer — which is why this is BROWSING with a filter on top and not
 * a search, and why nothing in this feature is allowed to call it one.
 *
 * Two consequences the UI has to be honest about, and which no amount of code
 * here can fix:
 *
 *   * the pool is what the feed published in the last day or so, not the
 *     market. An empty result means "not in this page", never "not out there";
 *   * Arbeitnow is Germany-first, so a UK filter will always throw most of the
 *     page away. That is the data, not a bug in this file.
 *
 * ============================================================================
 * WHOLE WORDS, BECAUSE SUBSTRINGS ARE WRONG IN BOTH DIRECTIONS
 * ============================================================================
 * The real location strings are free text written by whoever posted the advert:
 * "London", "London HQ", "London - The River Building HQ", "London, Greater
 * London, United Kingdom", "UK, London". `location.includes(typed)` misses
 * "Greater London" typed against a bare "London", and matches "Londonderry" —
 * which is in Northern Ireland — against "London".
 *
 * So both sides are cut into words and compared as words. `filter.test.ts`
 * holds every one of those strings, because they came out of a live page.
 */
import { type SearchResultJob } from '../normalise';

/** What the user typed. Neither box reaches a network request — see the header. */
export interface KeylessFilter {
  readonly keywords: string;
  readonly location: string;
}

/**
 * Words that describe an administrative wrapper rather than a place.
 *
 * Dropped from BOTH sides, so "Greater London" and "London" are the same place
 * and "City of London" matches "London". Kept deliberately short: every word
 * added here is a word the user can type and have silently ignored.
 */
const PLACE_FILLER: ReadonlySet<string> = new Set([
  'the',
  'and',
  'of',
  'in',
  'at',
  'area',
  'region',
  'greater',
  'metropolitan',
  'city',
  'hq',
  'office',
]);

/**
 * The several spellings of one country, folded to one token.
 *
 * The feed writes "United Kingdom", "UK - London" and "UK, London" in the same
 * page, and somebody typing "UK" means all three. Folded on both sides so the
 * match works whichever spelling is on which side.
 *
 * ONLY the country as a whole. "England" is deliberately absent: a job in
 * Glasgow is in the UK and is not in England, and quietly equating the two
 * would put Scottish adverts under an English filter.
 */
const UK_SPELLINGS: readonly RegExp[] = [
  /\bunited\s+kingdom\b/g,
  /\bgreat\s+britain\b/g,
  // `U.K.` and `U K` as well as `UK`. The trailing boundary keeps this off
  // the front of "Ukraine".
  /\bu\.?\s*k\.?\b/g,
  /\bgb\b/g,
  /\bbritain\b/g,
];

/**
 * The accent marks Unicode leaves behind after an NFD decomposition.
 *
 * Written as escapes rather than as the characters themselves: the range is
 * invisible in an editor, and a file that has been through a tool with an
 * opinion about encodings would silently stop folding accents while still
 * looking right.
 */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** The canonical token every spelling above becomes. */
const UK_TOKEN = 'uk';

/**
 * Lower-case, unaccented, punctuation-separated — but `+` and `#` survive.
 *
 * Those two are part of a technology's NAME. Dropping them turns "C#" into "c"
 * and "C++" into "c", and a filter that matches every job starting with the
 * letter c is a filter nobody can use.
 */
function tokenise(text: string): string[] {
  return (
    text
      .normalize('NFD')
      // Combining marks, so "München" and "Munchen" are the same city.
      .replace(COMBINING_MARKS, '')
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((token) => token !== '')
  );
}

/** A place, as comparable words. */
function placeTokens(text: string): string[] {
  let folded = text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
  for (const spelling of UK_SPELLINGS) folded = folded.replace(spelling, ` ${UK_TOKEN} `);

  const tokens = tokenise(folded);
  const meaningful = tokens.filter((token) => !PLACE_FILLER.has(token));

  // If filler was ALL there was — somebody typed "city" — keep the words rather
  // than silently turning their filter into no filter at all.
  return meaningful.length > 0 ? meaningful : tokens;
}

/**
 * Does this advert's location answer what the user typed?
 *
 * An advert with NO location cannot match a location filter. 8 of 250 real
 * adverts had none, and letting them through would put a Munich job under a
 * London filter with nothing on the card to explain why.
 */
export function matchesLocation(where: string | null, typed: string): boolean {
  const wanted = placeTokens(typed);
  if (wanted.length === 0) return true;

  if (where === null) return false;
  const have = new Set(placeTokens(where));
  if (have.size === 0) return false;

  // EVERY word, not any: "New York" must not match "York".
  return wanted.every((token) => have.has(token));
}

/**
 * Does this advert's title or employer answer what the user typed?
 *
 * ============================================================================
 * THE DESCRIPTION IS DELIBERATELY NOT SEARCHED
 * ============================================================================
 * It is a page of prose, and matching in it makes almost every filter match
 * almost everything — a London-based employer's boilerplate footer puts the
 * word "London" in adverts for jobs in Munich. The title and the employer are
 * what a person scans a list for, and they are short enough that a user can see
 * WHY a card matched. The screen says which fields are read, so this is a
 * stated rule rather than a surprise.
 *
 * A query word matches the START of a word in the advert, so "developer" finds
 * "Developers" and "engineer" finds "Engineering". It does not match inside a
 * word: "ai" must not find "Retail".
 */
export function matchesKeywords(title: string, company: string, typed: string): boolean {
  const wanted = tokenise(typed);
  if (wanted.length === 0) return true;

  const have = tokenise(`${title} ${company}`);
  if (have.length === 0) return false;

  return wanted.every((token) => have.some((word) => word.startsWith(token)));
}

/**
 * The adverts that answer both boxes, in the order the feed published them.
 *
 * Nothing is reordered and nothing is merged. An empty result is a real answer
 * — "none of the adverts in this page match" — and is NOT an error. Telling
 * that apart from a feed that has stopped working is `browse.ts`'s job, and it
 * is the whole point of this feature.
 */
export function filterKeylessJobs(
  jobs: readonly SearchResultJob[],
  filter: KeylessFilter,
): SearchResultJob[] {
  return jobs.filter(
    (entry) =>
      matchesKeywords(entry.job.title, entry.job.company, filter.keywords) &&
      matchesLocation(entry.job.location, filter.location),
  );
}
