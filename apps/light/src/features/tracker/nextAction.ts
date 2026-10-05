/**
 * The next action, and how close it is.
 *
 * ============================================================================
 * WHY THIS IS A SEPARATE SIGNAL FROM STALENESS
 * ============================================================================
 * The staleness edge says how long an application has sat still. The next
 * action says what the USER promised to do about it and when. They are not the
 * same fact and they routinely disagree: an application touched this morning
 * can still have a call booked for tomorrow, and one untouched for six weeks
 * can have nothing outstanding at all.
 *
 * So they get two different pieces of the card — the edge on the left, the chip
 * in the footer — and neither is derived from the other.
 *
 * ============================================================================
 * DUE TODAY IS NOT OVERDUE
 * ============================================================================
 * The single most annoying off-by-one in any tracker. Something due today has
 * not been missed, and telling a user at 9am that this morning's call is
 * already late is how an app loses their trust in every other number it shows.
 *
 * ============================================================================
 * COLOUR
 * ============================================================================
 *   later    no colour. It is a date, not a problem
 *   soon     gold, within three days. Gold means "needs you"
 *   overdue  red. The only red on a card since the `rejected` status pill
 *            left it (L-175)
 *
 * Every chip is mono and `tabular-nums`, so a column of dates lines up on the
 * digit rather than shuffling about.
 */
import { type IsoDate } from '@cviper/core-types';

import { daysBetweenDates } from '../../lib/dates';

export type NextActionUrgency = 'none' | 'later' | 'soon' | 'overdue';

/** Within this many days, a next action turns gold. */
const SOON_WITHIN_DAYS = 3;

/**
 * Chip classes per urgency. `none` never renders a chip, so it has no tone.
 *
 * The mono face is not decoration: every number a user compares in this app is
 * mono and tabular, and a due date on a board of twenty cards is exactly such a
 * number.
 */
export const NEXT_ACTION_TONES: Record<Exclude<NextActionUrgency, 'none'>, string> = {
  later: 'font-mono tabular-nums text-ink-faint',
  soon: 'font-mono tabular-nums text-gold-ink',
  overdue: 'font-mono tabular-nums text-danger',
};

/**
 * How urgent a next action is, relative to `today`.
 *
 * An unreadable date on either side is `none`, never `overdue`. Guessing
 * "overdue" from a date we could not parse would put a red chip on a card for a
 * deadline that may not exist — a wrong answer stated confidently, which is
 * worse than no answer.
 */
export function nextActionUrgency(
  nextActionDate: IsoDate | null,
  today: IsoDate,
): NextActionUrgency {
  if (nextActionDate === null) return 'none';

  const days = daysBetweenDates(today, nextActionDate);
  if (days === null) return 'none';

  if (days < 0) return 'overdue';
  if (days <= SOON_WITHIN_DAYS) return 'soon';
  return 'later';
}

/**
 * The same fact in words, for the card's accessible label.
 *
 * A coloured chip says nothing to a screen reader and nothing on a greyscale
 * display, so the colour is always a second telling.
 */
export function nextActionDescription(
  nextAction: string | null,
  nextActionDate: IsoDate | null,
  today: IsoDate,
): string | null {
  const urgency = nextActionUrgency(nextActionDate, today);
  if (urgency === 'none' || nextActionDate === null) return null;

  const days = daysBetweenDates(today, nextActionDate) ?? 0;
  const when =
    days < 0
      ? `overdue by ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'}`
      : days === 0
        ? 'due today'
        : `due in ${days} ${days === 1 ? 'day' : 'days'}`;

  return nextAction === null || nextAction.trim() === ''
    ? `Next action ${when}`
    : `Next action: ${nextAction} — ${when}`;
}

/**
 * The due date as a card footer says it (L-175): "due today", "due in 2 days",
 * "1 day overdue". `null` when there is no date or it cannot be read — the
 * same rule as `nextActionUrgency`, so a line never appears without a colour
 * to match it, or the other way round.
 *
 * The card used to print the raw ISO date. A column of `2026-09-29`s lines up
 * beautifully and tells nobody what the date is FOR, or how close it is.
 */
export function nextActionWhen(nextActionDate: IsoDate | null, today: IsoDate): string | null {
  if (nextActionDate === null) return null;
  const days = daysBetweenDates(today, nextActionDate);
  if (days === null) return null;

  if (days < 0) return `${Math.abs(days)} ${days === -1 ? 'day' : 'days'} overdue`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

/**
 * What the card footer reads: the user's own words for the action, then when.
 *
 * With no action text the due stands alone and starts with a capital, because
 * it is then the start of the line. An action with no readable date is `null`:
 * it is a note, not a deadline, and it is still in the detail pane.
 */
export function nextActionLine(
  nextAction: string | null,
  nextActionDate: IsoDate | null,
  today: IsoDate,
): { readonly action: string | null; readonly when: string } | null {
  const when = nextActionWhen(nextActionDate, today);
  if (when === null) return null;

  const action = nextAction === null || nextAction.trim() === '' ? null : nextAction.trim();
  return action === null
    ? { action: null, when: when.charAt(0).toUpperCase() + when.slice(1) }
    : { action, when };
}
