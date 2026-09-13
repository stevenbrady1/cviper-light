/**
 * The two date formats the keyless feeds use, neither of which is ISO.
 *
 * `toIsoDateOrNull` in `text.ts` reads what Adzuna and Reed send. These feeds
 * send something else entirely — Arbeitnow a unix timestamp in seconds,
 * Guardian Jobs an RFC-822 date out of RSS — and the cost of getting this wrong
 * is already on the record: the web app's parser raised on Reed's format, the
 * surrounding `except` swallowed it, and every Reed advert was stamped with
 * today. "Posted 3 days ago" was never true for Reed.
 *
 * So both readers here refuse rather than guess, and an unreadable date is
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

/** `Wed, 19 Aug 2026 23:00:00 +0000` — the RSS 2.0 date format. */
const RFC_822 =
  /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/;

const MONTHS: Readonly<Record<string, number>> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Guardian Jobs' `pubDate` -> `YYYY-MM-DD`, or `null`.
 *
 * Parsed by hand rather than handed to `new Date(...)`. `Date.parse` of an
 * RFC-822 string is implementation-defined, and the one thing it does
 * reliably on a string it dislikes is return a plausible-looking wrong answer
 * or `NaN` depending on the engine — which is exactly the class of bug this
 * module's header is about.
 *
 * The zone offset is deliberately ignored: the feed publishes `+0000`, the
 * field is a calendar day, and shifting a day by an hour to honour a zone would
 * change the date on a card for no gain a reader could see.
 */
export function rfc822ToIsoDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const match = RFC_822.exec(raw.trim());
  if (match === null) return null;

  const day = Number(match[1]);
  const month = MONTHS[(match[2] ?? '').toLowerCase()];
  const year = Number(match[3]);
  if (month === undefined || !Number.isFinite(day) || !Number.isFinite(year)) return null;

  const stamp = Date.UTC(year, month, day);
  const iso = isoDayOf(stamp);
  if (iso === null) return null;

  // Round-tripped, so `31 Feb 2026` is refused rather than rolled into March.
  return iso.endsWith(String(day).padStart(2, '0')) ? iso : null;
}
