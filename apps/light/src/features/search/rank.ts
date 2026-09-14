/**
 * Ranking search results against the CV on file, with no key (L-157).
 *
 * ============================================================================
 * THIS IS THE KEYWORD SCORER, POINTED AT A LIST
 * ============================================================================
 * The Analysis screen already scores one CV against one advert with nothing
 * but a word list — `scoreByKeywords` in `@cviper/keyword-scoring`. This runs
 * the same function once per search result, so a page of thirty adverts comes
 * back with a band on each, ordered best first, before the user has pasted a
 * key or downloaded a model. The verdict is the SAME `deriveVerdict` band the
 * Analysis screen shows, so an advert that says "Strong match · 84" here says
 * the same thing when it is opened there.
 *
 * Pure and synchronous, like the scorer under it: no network, no Tauri, no
 * clock. The screen memoises the result per list, and nothing here would be
 * any different if it did not.
 *
 * ============================================================================
 * "NO BAND" IS AN HONEST ANSWER, AND IT IS NEVER "WEAK"
 * ============================================================================
 * `rankResult` returns `null` — no pill at all — when there is nothing to
 * measure: no CV, a CV shorter than the scorer will accept, or an advert whose
 * description is missing or shorter than that. A keyless feed sometimes hands
 * over a title and nothing else, and a CV scored against "Scala Developer" is
 * three words matched against a document. That produces a confident-looking
 * number from nothing, and a "Weak match" pill on it would tell the user their
 * CV is wrong for a job the app knows nothing about. Saying nothing is the
 * only true thing to say.
 *
 * ============================================================================
 * A DEAL-BREAKER IS A WHOLE PHRASE, NOT A SUBSTRING
 * ============================================================================
 * The profile's deal-breakers are matched with `termInText`, the scorer's own
 * boundary-aware test. Its token class includes `#`, `+`, `.`, `/` and `-`, so
 * "C++" and ".NET" are matched literally (escaped, never read as a pattern),
 * "on-site" is one token that "on-site parking" contains, "SC" does not light
 * up inside "Scala", and "C" only counts standing alone. The alternative —
 * `includes()` — would flag every advert in the language for a user whose
 * deal-breaker is "C", and they would learn to ignore the chip within a day.
 *
 * `termInText` also folds US/UK spelling and a trailing plural on words of four
 * letters or more, so "night shift" finds "night shifts". That is the scorer's
 * rule and it is the right one here too.
 */
import { type Job, type Verdict } from '@cviper/core-types';
import { MIN_SCORABLE_CHARS, scoreByKeywords, termInText } from '@cviper/keyword-scoring';

/** The band an advert lands in, and the score it was banded on. */
export interface RankBand {
  readonly verdict: Verdict;
  readonly score: number;
}

/** Long enough for the scorer to accept — see `MIN_SCORABLE_CHARS`. */
export function isScorable(text: string | null): text is string {
  return text !== null && text.trim().length >= MIN_SCORABLE_CHARS;
}

/**
 * The band for one advert, or `null` when there is nothing to measure.
 *
 * `null` for no CV, a CV the scorer would refuse, an advert with no
 * description, and an advert whose description is shorter than the scorer's
 * minimum — a short blurb is a title with a sentence after it, and a CV scored
 * against that is a number made from nothing. Any error the scorer reports is
 * also `null`: the pill is a convenience, and a convenience does not get to
 * put an error line on a search result.
 */
export function rankResult(cvText: string | null, job: Job): RankBand | null {
  if (!isScorable(cvText)) return null;
  if (!isScorable(job.description)) return null;

  const scored = scoreByKeywords(cvText, job.description);
  if (!scored.ok) return null;

  return { verdict: scored.value.verdict, score: scored.value.match_score };
}

/**
 * Which of the profile's deal-breakers this advert mentions, in profile order.
 *
 * Each non-blank entry is matched as a whole phrase, case-insensitively, with
 * token boundaries on both ends (see the docblock above for what that means
 * for "SC", "C" and "C++"), against the title, the location and the
 * description together. The entry is returned trimmed — that is the text the
 * chip shows — and two entries that differ only in case or padding count once.
 */
export function dealBreakersIn(dealBreakers: readonly string[], job: Job): string[] {
  const haystack = `${job.title} ${job.location ?? ''} ${job.description ?? ''}`;

  const matched: string[] = [];
  const seen = new Set<string>();
  for (const raw of dealBreakers) {
    const phrase = raw.trim();
    if (phrase === '') continue;

    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (termInText(phrase, haystack)) matched.push(phrase);
  }
  return matched;
}

/** Strong first; unranked last. */
const BAND_ORDER: Readonly<Record<Verdict, number>> = { strong: 0, possible: 1, weak: 2 };
const UNRANKED_ORDER = 3;

/**
 * The list, best band first, ties in their incoming order.
 *
 * A NEW array: the incoming list is the order the boards answered in, and the
 * toggle that turns this sort off has to be able to put it back.
 */
export function sortByBand<T extends { readonly job: { readonly id: string } }>(
  entries: readonly T[],
  bands: ReadonlyMap<string, RankBand | null>,
): T[] {
  const orderOf = (item: T): number => {
    const band = bands.get(item.job.id);
    return band === null || band === undefined ? UNRANKED_ORDER : BAND_ORDER[band.verdict];
  };
  // `Array.prototype.sort` is stable, so equal bands keep their incoming order.
  return [...entries].sort((left, right) => orderOf(left) - orderOf(right));
}
