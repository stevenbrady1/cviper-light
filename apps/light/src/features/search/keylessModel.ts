/**
 * What the search screen says and shows about a keyless browse.
 *
 * Kept out of the component, and out of `model.ts`, for two different reasons:
 * the first is that every sentence here is testable without rendering
 * anything, and the second is that this is where the feature's one hard rule
 * lives — THREE OUTCOMES THAT LOOK IDENTICAL MUST READ DIFFERENTLY.
 *
 *   the feed failed        -> a visible error naming the feed (`browse.ts`)
 *   the feed was empty     -> also an error; a "most recent jobs" list is never
 *                             legitimately empty (`browse.ts`)
 *   the filter matched none -> `nothingMatchedNote`, which is NOT an error and
 *                             says how many adverts it looked at
 *
 * Anything that blurs those three puts the user in front of an empty list with
 * no way to tell whether the app is broken or the market is quiet.
 */
import {
  KEYLESS_SOURCE_LABEL,
  findCrossPostClusters,
  type DuplicateCluster,
  type JobSearchOutcome,
  type KeylessBrowseOutcome,
  type KeylessSourceOutcome,
  type SearchResultJob,
} from '@cviper/job-apis';

/**
 * What the two free feeds are, in the plainest words that are still true.
 *
 * ============================================================================
 * THE HONESTY HERE IS LOAD-BEARING, NOT DECORATION
 * ============================================================================
 * "Browse jobs, no key needed" is the claim that sells this feature and it is
 * also the claim that would mislead. The measured reality: Arbeitnow is a
 * Germany-first board that recently added the UK — in a live page of 250
 * adverts, 59 were plausibly UK — and Guardian Jobs publishes twenty UK items
 * weighted to public sector, education and charity.
 *
 * So a UK reader who presses Browse gets a modest, lopsided list, and they must
 * be told that BEFORE they conclude the app is broken or that this is the
 * market. Saying it costs a sentence; not saying it costs the user's trust in
 * everything else the screen tells them.
 *
 * It also never says "search". The feeds accept no query at all.
 */
export const KEYLESS_INTRO =
  'Two free job feeds, read straight from the web with no key and no account: Arbeitnow, ' +
  'which is mostly Germany and the rest of Europe with a growing London list, and Guardian ' +
  'Jobs, which is the twenty most recent UK posts — largely public sector, education and ' +
  'charity. CViper reads what they have just published and narrows it down on your computer, ' +
  'so this is a browse of recent jobs rather than a look at the whole market.';

/** What the fields the local filter reads, said where the user types them. */
export const KEYLESS_FILTER_NOTE =
  'These feeds cannot be asked for anything, so the narrowing happens here: the job title and ' +
  'the employer for the words, and whatever the advert wrote in its location box for the ' +
  'place. Many adverts name only a city.';

/**
 * The label on the one primary button.
 *
 * It says what pressing it will do, and it NEVER calls a keyless browse a
 * search: the feeds ignore every query, and a button that says "Search" over a
 * filtered list of whatever was published today is a claim the user cannot
 * check.
 */
export function submitLabel(keyedChosen: number, keylessChosen: number): string {
  if (keyedChosen > 0 && keylessChosen > 0) return 'Search and browse';
  if (keyedChosen > 0) return 'Search';
  if (keylessChosen > 0) return 'Browse recent jobs';
  // Nothing ticked. The button is disabled and its reason sits beside it, but
  // it still reads as the thing the screen is for.
  return 'Search';
}

/**
 * "Arbeitnow published 38 recent jobs and none of them matched." — or `null`.
 *
 * ============================================================================
 * THIS IS THE SENTENCE THAT IS NOT AN ERROR, AND IT CARRIES THE COUNT
 * ============================================================================
 * Returned ONLY when the feed answered (`error === null`) and had adverts in it
 * (`fetched > 0`) and none of them survived the filter. Every other shape has a
 * failure line of its own, and putting "none matched" beside a failure would
 * tell the user their words were the problem when the feed never answered.
 *
 * The count is in the sentence on purpose. "Nothing matched" alone is
 * indistinguishable from a dead feed; "read 38 and none matched" says plainly
 * that the app worked and the words are the thing to change.
 */
export function nothingMatchedNote(outcome: KeylessSourceOutcome): string | null {
  if (outcome.error !== null) return null;
  if (outcome.fetched === 0) return null;
  if (outcome.jobs.length > 0) return null;

  const label = KEYLESS_SOURCE_LABEL[outcome.source];
  return (
    `${label} published ${outcome.fetched} recent jobs and none of them matched what you typed. ` +
    'Try fewer words, or a wider place.'
  );
}

export interface CombinedResults {
  /** Every advert from both halves, keyed first, in the order each arrived. */
  readonly jobs: readonly SearchResultJob[];
  /** Adverts that look like the same role twice. NOTHING is removed for this. */
  readonly clusters: readonly DuplicateCluster[];
  /** Did anything run at all? "Nothing yet" is a different screen from "none". */
  readonly ran: boolean;
}

/**
 * The keyed results and the keyless ones, as one list.
 *
 * ============================================================================
 * CROSS-POSTS ARE LOOKED FOR ACROSS THE TWO HALVES, NOT WITHIN EACH
 * ============================================================================
 * `searchJobs` clusters the adverts IT fetched and `browseKeylessJobs` does not
 * cluster at all, so neither can see the case that matters most: the same role
 * on Adzuna and on a free feed. Fingerprinting the merged list is the only way
 * that pair is ever flagged, and it is why this function recomputes rather than
 * concatenating the two cluster lists.
 *
 * Nothing is merged and nothing is removed — every advert stays on the page
 * with its own apply link. A wrong merge deletes a real job and its URL with no
 * error, and a local app has no undo.
 */
export function combineResults(
  keyed: JobSearchOutcome | null,
  keyless: KeylessBrowseOutcome | null,
): CombinedResults {
  const jobs = [...(keyed?.jobs ?? []), ...(keyless?.jobs ?? [])];

  return {
    jobs,
    clusters: findCrossPostClusters(jobs.map((entry) => entry.job)),
    ran: keyed !== null || keyless !== null,
  };
}
