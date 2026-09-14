/**
 * The follow-up rules: when a nudge is worth sending, how many is enough, and
 * how a sent one is remembered — with no React and no model in sight.
 *
 * ============================================================================
 * THE APP DRAFTS. IT NEVER SENDS.
 * ============================================================================
 * Nothing in this feature opens a mail client, addresses a message or makes a
 * request on the user's behalf. A draft is text in two boxes that the user
 * copies into whatever they already use, and "Mark as sent" is the user
 * telling the tracker what THEY did. `followUp.noSend.contract.test.ts` reads
 * the shipped source of this feature and fails on `mailto:` or a `send`.
 *
 * ============================================================================
 * THE RECORD IS A LINE IN THE NOTES, NOT A NEW COLUMN
 * ============================================================================
 * `followed up 2026-09-11`, on its own line. Three reasons over a table:
 *
 * 1. The user can see it, edit it and delete it in the Notes box they already
 *    use, so the count is never a number the app knows and they do not.
 * 2. It survives a backup round-trip to the cloud app unchanged — notes are a
 *    string there too — where a new column would be a schema change on both
 *    sides for one feature.
 * 3. A follow-up sent by hand, before this feature existed, can be recorded by
 *    typing the same line. The rule reads what is there, not what the app wrote.
 *
 * The pattern is deliberately strict — a whole line, an ISO date, nothing
 * else — so prose that mentions following up ("I followed up by phone") is
 * never mistaken for the record of one. A malformed line is ignored, not
 * half-read.
 *
 * ============================================================================
 * TEN DAYS, TWICE, AND THEN THE HONEST ANSWER
 * ============================================================================
 * Ten days is the point at which silence stops being "recruiters are slow" and
 * becomes worth one polite line — and it counts from the LAST thing that
 * happened, so the second nudge waits as long as the first. Two is the cap: a
 * third follow-up has never changed an outcome, and the kindest thing the
 * tracker can do after two is say so and point at the status select.
 */
import {
  type Application,
  type ApplicationStatus,
  type IsoDate,
  type IsoTimestamp,
} from '@cviper/core-types';

import { daysBetweenDates } from '../../lib/dates';

import { type TrackerEntry } from './model';

/** Days of silence after the last activity before a nudge is worth sending. */
export const QUIET_AFTER_DAYS = 10;

/** After this many, the next step is recording the outcome, not a third email. */
export const MAX_FOLLOW_UPS = 2;

/** One marker, one line, an ISO date and nothing else. */
export const FOLLOW_UP_MARKER = /^followed up (\d{4}-\d{2}-\d{2})$/;

/** The line `withFollowUpLogged` writes, so reader and writer cannot drift. */
export function followUpMarker(date: IsoDate): string {
  return `followed up ${date}`;
}

/** Every follow-up recorded in the notes, oldest first. */
export function followUpsSent(notes: string | null): IsoDate[] {
  if (notes === null) return [];

  const dates: IsoDate[] = [];
  for (const line of notes.split(/\r?\n/)) {
    const match = FOLLOW_UP_MARKER.exec(line.trim());
    const date = match?.[1];
    if (date !== undefined) dates.push(date);
  }
  return dates;
}

/**
 * The later of the applied date and the last follow-up, or `null` when there
 * is neither — an application imported without a date has nothing to count
 * from, and the answer to "how long has it been quiet" is honestly unknown.
 *
 * ISO dates compare correctly as strings, which is why `>` is enough.
 */
export function lastActivityDate(
  application: Application,
  followUps: readonly IsoDate[],
): IsoDate | null {
  const last = followUps[followUps.length - 1] ?? null;
  const applied = application.applied_date;
  if (applied === null) return last;
  if (last === null) return applied;
  return last > applied ? last : applied;
}

export type FollowUpState = 'not-sent' | 'closed' | 'too-soon' | 'due' | 'exhausted';

/**
 * Days since the last activity, or `null` when there is nothing to count from.
 * Negative when the clock is behind the record — handled by the caller as
 * "too soon", because nothing goes quiet in negative time.
 */
export function quietDays(entry: TrackerEntry, today: IsoDate): number | null {
  const { application } = entry;
  const last = lastActivityDate(application, followUpsSent(application.notes));
  return last === null ? null : daysBetweenDates(last, today);
}

/** `YYYY-MM-DD` plus a number of days, done at UTC midnight so DST cannot move it. */
function addDays(date: IsoDate, days: number): IsoDate | null {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

/** The first day a nudge would be due, or `null` with nothing to count from. */
export function nudgeDate(entry: TrackerEntry): IsoDate | null {
  const { application } = entry;
  const last = lastActivityDate(application, followUpsSent(application.notes));
  return last === null ? null : addDays(last, QUIET_AFTER_DAYS);
}

export function followUpState(entry: TrackerEntry, today: IsoDate): FollowUpState {
  const { application } = entry;

  // Nothing was sent, so nobody is late.
  if (application.status === 'saved') return 'not-sent';
  // Whatever happens next, it is not a follow-up.
  if (application.status === 'rejected' || application.status === 'offer') return 'closed';

  if (followUpsSent(application.notes).length >= MAX_FOLLOW_UPS) return 'exhausted';

  const quiet = quietDays(entry, today);
  // No date to count from: not "due", because a nudge with no reason is not
  // one worth sending; not "too soon" either, because that names a day.
  if (quiet === null) return 'not-sent';

  return quiet < QUIET_AFTER_DAYS ? 'too-soon' : 'due';
}

/** One plain sentence per state, for the panel. Tested here, rendered there. */
export function describeFollowUpState(entry: TrackerEntry, today: IsoDate): string {
  switch (followUpState(entry, today)) {
    case 'not-sent':
      return 'Nothing sent yet.';
    case 'closed':
      return 'Closed.';
    case 'exhausted':
      return 'Two follow-ups sent and no reply. The honest next step is recording the outcome.';
    case 'due':
      return `Quiet for ${quietDays(entry, today) ?? 0} days. Worth a nudge.`;
    case 'too-soon': {
      const days = Math.max(0, quietDays(entry, today) ?? 0);
      const until = nudgeDate(entry) ?? today;
      const ago = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
      return `Sent ${ago} — give it until ${until}.`;
    }
  }
}

/** Append one line to the notes, creating them when there are none. */
function withNoteLine(application: Application, line: string, now: IsoTimestamp): Application {
  const existing = application.notes?.replace(/\s+$/, '') ?? '';
  return {
    ...application,
    notes: existing === '' ? line : `${existing}\n${line}`,
    updated_at: now,
  };
}

/**
 * Record that a follow-up went out today.
 *
 * `updated_at` moves too — the staleness edge measures the last time anything
 * happened, and sending a follow-up is exactly that.
 */
export function withFollowUpLogged(
  application: Application,
  date: IsoDate,
  now: IsoTimestamp,
): Application {
  return withNoteLine(application, followUpMarker(date), now);
}

/**
 * Record a thank-you note the same way, in words the marker pattern does NOT
 * match: a thank-you is not a nudge, and it must not count towards the cap.
 */
export function withThankYouLogged(
  application: Application,
  date: IsoDate,
  now: IsoTimestamp,
): Application {
  return withNoteLine(application, `thank-you sent ${date}`, now);
}

/** Offered exactly once: on the move INTO interviewing, whatever it came from. */
export function thankYouOffered(previous: ApplicationStatus, next: ApplicationStatus): boolean {
  return previous !== 'interviewing' && next === 'interviewing';
}
