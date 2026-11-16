/**
 * Which free feed a search reads by default (L-219).
 *
 * Arbeitnow is mostly Germany and the rest of Europe. For a search in the UK
 * it mostly adds noise, so it starts switched OFF for a United Kingdom search
 * that names a place (owner decision, 2026-10-08). A United Kingdom search
 * with no place typed, and a search of any other country, keep it on.
 *
 * Guardian Jobs, the UK feed that sat beside it, closed on 2 Sep 2026 and was
 * removed (L-336). So a UK search with a place and no job-board key now has no
 * free feed on by default — the search screen says what to do instead.
 *
 * A tick or untick the user makes is theirs: it wins over the default from
 * then on, and is remembered across restarts in a small store of its own.
 */
import { KEYLESS_SOURCE_IDS, KEYLESS_SOURCE_LABEL, type KeylessSourceId } from '@cviper/job-apis';

import { type CountryChoice } from './country';

export const FEED_CHOICE_KEY = 'cviper.light.search.feeds';

/** What the user ticked or unticked themselves. Absent: no choice made. */
export type FeedChoice = Readonly<Partial<Record<KeylessSourceId, boolean>>>;

/**
 * A United Kingdom search with a place typed: the one search the free feed
 * starts off for (L-419).
 *
 * The country is the Country setting (L-417), never a guess from the words in
 * Location: a list of place names used to decide this, and it called York in
 * a United States search a UK place. A place of only spaces is no place.
 */
export function isUkPlaceSearch(country: CountryChoice | null, location: string): boolean {
  return country === 'gb' && location.trim() !== '';
}

/** The feeds a search reads: the user's own choice where there is one, the default elsewhere. */
export function chosenFeeds(choice: FeedChoice, ukPlace: boolean): ReadonlySet<KeylessSourceId> {
  return new Set(
    KEYLESS_SOURCE_IDS.filter(
      (source) => choice[source] ?? (source === 'arbeitnow' ? !ukPlace : true),
    ),
  );
}

/**
 * The feeds the default ticks for this search, as if nothing were stored
 * (L-335): what "tick the free feed" means when the user has unticked it.
 * That is Arbeitnow. For a UK search with a place it is nothing at all since
 * Guardian Jobs closed (L-336) — never Arbeitnow, which is mostly Europe.
 */
export function defaultFeeds(ukPlace: boolean): readonly KeylessSourceId[] {
  const feeds = chosenFeeds({}, ukPlace);
  return KEYLESS_SOURCE_IDS.filter((source) => feeds.has(source));
}

/**
 * "Tick Arbeitnow" — named from the feeds' own labels — or `null` when there
 * is nothing to tick, so no button ever says "Tick 0 free feeds" (L-336).
 */
export function tickFeedsLabel(sources: readonly KeylessSourceId[]): string | null {
  if (sources.length === 0) return null;
  return `Tick ${sources.map((source) => KEYLESS_SOURCE_LABEL[source]).join(' and ')}`;
}

/** Tick each of these as the user's own choice, remembered like a tick by hand. */
export function tickFeeds(choice: FeedChoice, sources: readonly KeylessSourceId[]): FeedChoice {
  return sources.reduce((next, source) => rememberFeedChoice(next, source, true), choice);
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Storage switched off: the user loses a remembered tick, not a search.
    return null;
  }
}

/**
 * What the user chose before. Anything unreadable is no choice at all.
 *
 * A key that is not a feed any more is IGNORED, not a reason to throw the
 * rest away (L-336): a machine that once unticked Guardian Jobs still has
 * `guardian` stored next to its Arbeitnow tick, and dropping the whole object
 * would quietly lose that tick. A known feed with a value that is not
 * `true`/`false` still makes the whole store unreadable, as before.
 */
export function readFeedChoice(): FeedChoice {
  const store = storage();
  if (store === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(store.getItem(FEED_CHOICE_KEY) ?? '{}');
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const record = parsed as Record<string, unknown>;
  const choice: Partial<Record<KeylessSourceId, boolean>> = {};
  for (const source of KEYLESS_SOURCE_IDS) {
    if (!Object.hasOwn(record, source)) continue;
    const value = record[source];
    if (typeof value !== 'boolean') return {};
    choice[source] = value;
  }
  return choice;
}

/** Record a tick or untick the user made, and return the new choice. */
export function rememberFeedChoice(
  choice: FeedChoice,
  source: KeylessSourceId,
  on: boolean,
): FeedChoice {
  const next: FeedChoice = { ...choice, [source]: on };
  try {
    storage()?.setItem(FEED_CHOICE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or switched off: the choice holds for this session.
  }
  return next;
}
