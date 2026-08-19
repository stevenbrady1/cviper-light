/**
 * Calendar arithmetic for the tracker.
 *
 * The data model has no `Date` objects in it — timestamps are ISO-8601 UTC
 * strings and dates are `YYYY-MM-DD` strings, both of them text (see
 * `@cviper/core-types/entities`). This module is the seam where those strings
 * become numbers a person can act on: how many days a card has sat still, and
 * how long until its next action is due.
 *
 * ============================================================================
 * TWO RULES THAT ARE NOT STYLE CHOICES
 * ============================================================================
 * 1. **A day is a CALENDAR day, in the user's own timezone.** "Applied three
 *    days ago" is a fact about their calendar, not about elapsed hours. A card
 *    touched at 23:00 last night is one day old at 09:00 this morning, and
 *    counting 24-hour periods would call it zero.
 *
 * 2. **The subtraction happens at UTC midnight, always.** Take two local
 *    midnights and divide the difference by 86,400,000 and you are correct
 *    everywhere except the two days a year the clocks move — where the answer
 *    is 0.958 or 1.042 days, and `Math.floor` turns "yesterday" into "today".
 *    A card would stop ageing for a day, twice a year, on machines nobody
 *    tests on. Normalising to UTC midnight first removes the class outright.
 *
 * Every function returns `null` rather than `NaN` for input it cannot read. A
 * `NaN` propagates silently into a comparison and quietly answers `false`; a
 * `null` is a value the type system makes the caller handle.
 */
import { type IsoDate } from '@cviper/core-types';

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD`, and nothing that merely starts like one. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The local calendar date of an instant, as `YYYY-MM-DD`.
 *
 * Built from `getFullYear`/`getMonth`/`getDate` — the LOCAL parts — because the
 * question is always "what day was that for the person looking at the screen".
 * `toISOString().slice(0, 10)` would answer in UTC and be a day out for every
 * user west of Greenwich for part of their day.
 */
export function toLocalIsoDate(instant: Date): IsoDate | null {
  const time = instant.getTime();
  if (Number.isNaN(time)) return null;
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`;
}

/**
 * Today, as `YYYY-MM-DD`.
 *
 * Takes its clock as an argument so callers and tests can be deterministic. The
 * default is only for the top of the render tree.
 */
export function todayIsoDate(now: Date = new Date()): IsoDate {
  // A real `Date` always formats, so the `null` branch is unreachable here.
  return toLocalIsoDate(now) ?? '';
}

/** Reject anything that is not a real `YYYY-MM-DD`, including `2026-13-45`. */
function parseIsoDateAtUtcMidnight(date: string): number | null {
  if (!ISO_DATE.test(date)) return null;

  const time = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(time)) return null;

  // `Date.parse` accepts `2026-02-30` on some engines by rolling it forward.
  // Round-tripping catches that: a date that does not survive is not a date.
  const roundTrip = new Date(time).toISOString().slice(0, 10);
  return roundTrip === date ? time : null;
}

/**
 * Whole calendar days from `from` to `to`. Negative when `to` is earlier.
 *
 * `null` if either side is not a `YYYY-MM-DD`.
 */
export function daysBetweenDates(from: string, to: string): number | null {
  const start = parseIsoDateAtUtcMidnight(from);
  const end = parseIsoDateAtUtcMidnight(to);
  if (start === null || end === null) return null;

  // Both operands are exact UTC midnights, so this division is exact and
  // `Math.round` is defensive rather than load-bearing.
  return Math.round((end - start) / MS_PER_DAY);
}

/**
 * How many calendar days ago an ISO-8601 timestamp was, relative to `now`.
 *
 * Clamped at zero: a timestamp in the future means a skewed clock or a backup
 * from a machine set to tomorrow, and nothing has gone stale in negative time.
 */
export function daysSinceTimestamp(timestamp: string, now: Date): number | null {
  const then = toLocalIsoDate(new Date(timestamp));
  const today = toLocalIsoDate(now);
  if (then === null || today === null) return null;

  const days = daysBetweenDates(then, today);
  if (days === null) return null;

  return Math.max(0, days);
}
