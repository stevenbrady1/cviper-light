/**
 * The funnel: five counts and two rates, read off the board (L-159).
 *
 * ============================================================================
 * WHAT EACH FIGURE MEANS
 * ============================================================================
 * The board's columns are STATES — where each card is right now. The funnel
 * is about FLOW, and the two are not the same count. A card in `offer` is one
 * card in one column, but it has passed through "sent" and "interviewing" to
 * get there, and a funnel that only counted the column it sits in today would
 * say the user had one offer and zero interviews.
 *
 *   saved         status `saved`. Still on the desk; nothing has gone out.
 *   sent          every application that is NOT `saved` — applied,
 *                 interviewing, offer, rejected. It left the building.
 *   interviewing  status `interviewing` OR `offer`, NOW. An offer implies an
 *                 interview happened, whether or not the card ever paused in
 *                 that column. A card interviewed and then rejected counts
 *                 only under `rejected`: nothing stored says it was ever
 *                 interviewed. So the strip calls this "Interview or offer",
 *                 never "so far" (L-388).
 *   offers        status `offer`.
 *   rejected      status `rejected`.
 *
 *   interviewRate = interviewing / sent
 *   offerRate     = offers / sent
 *
 * Both rates are `null` until `MIN_SENT_FOR_RATE` (5) applications have been
 * sent (L-317). Zero of zero is not 0%, and neither is zero of one: a user who
 * has applied once and heard nothing yet has no interview rate, and "0%" would
 * be the app inventing bad news from data that says nothing. `null` is also
 * never `NaN` — a NaN reaches the screen as the literal word and the strip has
 * to know the difference between "not enough yet" and "no interviews".
 *
 * ============================================================================
 * PURE, AND TESTED AT THE BOUNDARIES
 * ============================================================================
 * No React. The empty board, the only-saved board, and four and five sent are
 * the edges where a divide-by-zero or a "0%" for too little data would hide, and
 * `funnel.test.ts` asserts each of them by name.
 */
import { type TrackerEntry } from './model';

/** Fewer applications than this and a rate is noise, so there is none (L-317). */
export const MIN_SENT_FOR_RATE = 5;

export interface Funnel {
  readonly saved: number;
  readonly sent: number;
  readonly interviewing: number;
  readonly offers: number;
  readonly rejected: number;
  /** `interviewing / sent`, or `null` while `sent` is under `MIN_SENT_FOR_RATE`. */
  readonly interviewRate: number | null;
  /** `offers / sent`, or `null` while `sent` is under `MIN_SENT_FOR_RATE`. */
  readonly offerRate: number | null;
}

export function funnelFrom(entries: readonly TrackerEntry[]): Funnel {
  let saved = 0;
  let sent = 0;
  let interviewing = 0;
  let offers = 0;
  let rejected = 0;

  for (const { application } of entries) {
    switch (application.status) {
      case 'saved':
        saved += 1;
        break;
      case 'applied':
        sent += 1;
        break;
      case 'interviewing':
        sent += 1;
        interviewing += 1;
        break;
      case 'offer':
        sent += 1;
        interviewing += 1;
        offers += 1;
        break;
      case 'rejected':
        sent += 1;
        rejected += 1;
        break;
    }
  }

  return {
    saved,
    sent,
    interviewing,
    offers,
    rejected,
    interviewRate: sent < MIN_SENT_FOR_RATE ? null : interviewing / sent,
    offerRate: sent < MIN_SENT_FOR_RATE ? null : offers / sent,
  };
}

/**
 * A rate as the user reads it: a whole percentage, or a dash for "not yet".
 *
 * Whole numbers only. "33.3%" on a board of three applications is precision
 * the data does not have. Half rounds UP (`Math.round` on a non-negative
 * value), so 1/8 is "13%", and 1/3 and 2/3 are "33%" and "67%".
 */
export function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}
