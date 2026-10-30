/**
 * The date format the keyless feed uses, which is not ISO.
 *
 * `toIsoDateOrNull` in `text.ts` reads what Adzuna and Reed send. Arbeitnow
 * sends something else entirely, a unix timestamp in seconds, and the cost of
 * getting this wrong is already on the record: the web app's parser raised on Reed's format, the
 * surrounding `except` swallowed it, and every Reed advert was stamped with
 * today. "Posted 3 days ago" was never true for Reed.
 *
 * So the reader here refuses rather than guesses, and an unreadable date is
 * `null`. `postedLabel` in the search screen renders `null` as nothing at all,
 * which is the honest answer.
 */

/** `Job.posted_date` is a calendar day, never a `Date` — see `entities.ts`. */
function isoDayOf(milliseconds: number): string | null {
  if (!Number.isFinite(milliseconds)) return null;

  const date = new Date(milliseconds);
  const rendered = date.toISOString();
  // `new Date(NaN).toISOString()` throws, which is why the finite check is
  // first; a date outside the representable range gives an Invalid Date whose
  // `getTime` is NaN, and that is caught here.
  return Number.isNaN(date.getTime()) ? null : (rendered.slice(0, 10) ?? null);
}

/**
 * The earliest timestamp worth believing: 2000-01-01.
 *
 * Zero is the value a feed sends when it has no date, and 1970-01-01 on a card
 * that says "Posted 20,000 days ago" is worse than saying nothing. Anything
 * before this is treated as absent rather than as a very old advert.
 */
const EARLIEST_SECONDS = 946_684_800;

/** Roughly the year 2100. Past this the number is a bug, not a date. */
const LATEST_SECONDS = 4_102_444_800;

/**
 * Arbeitnow's `created_at`: seconds since the epoch.
 *
 * SECONDS, not milliseconds. Reading it as milliseconds would put every advert
 * in January 1970 and the card would quietly say nothing, because
 * `postedLabel` clamps; reading a millisecond value as seconds would put it in
 * the year 57,000. The range check refuses both.
 */
export function unixSecondsToIsoDate(raw: unknown): string | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw < EARLIEST_SECONDS || raw > LATEST_SECONDS) return null;

  return isoDayOf(raw * 1000);
}
