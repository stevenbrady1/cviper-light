/**
 * How many provider requests have gone out today, and whether another may.
 *
 * ============================================================================
 * WHY A LOCAL COUNTER IS THE ONLY OPTION.
 * ============================================================================
 * Reed's free tier is 100 requests per day and there is NO endpoint that
 * reports the remaining balance - no header, no meta field, nothing. The first
 * time a user learns they have run out is when a search fails, and by then it
 * fails for the rest of the day. So the count is kept here, on the user's own
 * machine, and it is the only warning that can exist.
 *
 * Everything in this module is PURE. It takes the current UTC date as a string
 * and returns new state; it reads no clock, touches no storage and performs no
 * I/O. `utcDateOf` is the single seam where a `Date` becomes a date, and it is
 * the only function here a test has to pin.
 *
 * ============================================================================
 * WHAT DOES NOT HAPPEN
 * ============================================================================
 * Nothing in this app searches on a timer, on a keystroke, or on a window
 * regaining focus. A request is only ever made because someone pressed a
 * button, which is what makes a 100/day budget survivable at all - and why a
 * search-as-you-type box would burn the entire day's allowance in one sentence.
 * Rust enforces a minimum gap between submits on top of this; see
 * `SUBMIT_MIN_INTERVAL` in `src-tauri/src/jobs.rs`.
 */
import { type IsoDate } from '@cviper/core-types';

import { PROVIDER_LABEL } from './errors';
import { type JobProviderId } from './types';

/** Reed's published free-tier allowance (reed.co.uk/developers). */
export const REED_DAILY_LIMIT = 100;

/**
 * Requests held back from the limit.
 *
 * At the block point the user still has ten requests in hand: enough to test a
 * newly pasted key and still run one urgent search. A block set AT the limit
 * would be no block at all - it would simply be the point where the provider
 * starts refusing, which is what this exists to avoid.
 */
export const QUOTA_RESERVE = 10;

/** Where the warning starts. Three quarters used, with the day still to run. */
export const QUOTA_WARN_AT = 75;

/** Where the app stops sending. */
export const QUOTA_BLOCK_AT = REED_DAILY_LIMIT - QUOTA_RESERVE;

/**
 * The daily allowance per provider, or `null` when there is no honest number.
 *
 * ============================================================================
 * A DELIBERATE ASYMMETRY: REED IS ENFORCED, ADZUNA IS ONLY COUNTED.
 * ============================================================================
 * Reed publishes 100/day for the free tier, so 90 is a real threshold with a
 * real meaning. Adzuna's allowance depends on the plan the user signed up for,
 * is not published as one number, and cannot be queried. Blocking Adzuna at 90
 * would be inventing a limit - and inventing it in the direction that stops a
 * paying user searching when their plan allows twenty-five times that. The
 * count is still kept and still shown; only the enforcement is Reed's.
 *
 * This matches the reasoning already recorded in
 * `apps/light/src/status/requestLog.ts` about why the status strip shows a bare
 * count rather than "12 / 250".
 */
export const PROVIDER_DAILY_LIMIT: Readonly<Record<JobProviderId, number | null>> = {
  reed: REED_DAILY_LIMIT,
  adzuna: null,
};

export interface QuotaCounts {
  readonly reed: number;
  readonly adzuna: number;
}

export interface QuotaState {
  /** The UTC calendar day these counts belong to. */
  readonly date: IsoDate;
  readonly counts: QuotaCounts;
}

export type QuotaStatus = 'ok' | 'warn' | 'blocked';

export interface QuotaVerdict {
  readonly status: QuotaStatus;
  /** Requests already sent to this provider today. */
  readonly used: number;
  /** Requests left before the block, or `null` when there is no limit to count against. */
  readonly remaining: number | null;
  /** Safe to show verbatim. `null` when there is nothing worth saying. */
  readonly message: string | null;
}

/** `YYYY-MM-DD`, and nothing that merely starts like one. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The UTC calendar day of an instant, or `null` for a date that is not one.
 *
 * UTC, not local. Reed's own counter resets at midnight UTC, so a local-day
 * reset would give a user in Sydney a fresh allowance eleven hours before Reed
 * agrees - and a run of failed searches with a counter reading zero.
 */
export function utcDateOf(now: Date): IsoDate | null {
  const time = now.getTime();
  if (Number.isNaN(time)) return null;
  return now.toISOString().slice(0, 10);
}

export function emptyQuota(today: IsoDate): QuotaState {
  return { date: today, counts: { reed: 0, adzuna: 0 } };
}

/**
 * The state as it applies on `today`.
 *
 * A stored day that is not today is not today's count, whether it is
 * yesterday's or - after a clock change or a flight - tomorrow's.
 */
export function rollOverQuota(state: QuotaState, today: IsoDate): QuotaState {
  return state.date === today ? state : emptyQuota(today);
}

/** Count one request against a provider. Returns new state; mutates nothing. */
export function recordProviderRequest(
  state: QuotaState,
  provider: JobProviderId,
  today: IsoDate,
): QuotaState {
  const current = rollOverQuota(state, today);
  return {
    date: current.date,
    counts: { ...current.counts, [provider]: current.counts[provider] + 1 },
  };
}

/** May we send another request to this provider, and what should we say? */
export function quotaVerdict(
  state: QuotaState,
  provider: JobProviderId,
  today: IsoDate,
): QuotaVerdict {
  const used = rollOverQuota(state, today).counts[provider];
  const limit = PROVIDER_DAILY_LIMIT[provider];
  const label = PROVIDER_LABEL[provider];

  if (limit === null) {
    return { status: 'ok', used, remaining: null, message: null };
  }

  // Clamped at zero: a count past the limit is still "none left", not a
  // negative number on screen.
  const remaining = Math.max(0, limit - used);

  if (used >= QUOTA_BLOCK_AT) {
    return {
      status: 'blocked',
      used,
      remaining,
      message:
        `${label} searches are paused for today. ${used} of ${limit} requests have been used, ` +
        `and the last ${QUOTA_RESERVE} are kept back so you can still test a new key or run one ` +
        'urgent search by hand. Nothing was sent. The allowance resets at midnight UTC.',
    };
  }

  if (used >= QUOTA_WARN_AT) {
    return {
      status: 'warn',
      used,
      remaining,
      message:
        `${used} of ${label}'s ${limit} daily requests have been used. Searching will pause at ` +
        `${QUOTA_BLOCK_AT} to keep a few in reserve. The allowance resets at midnight UTC.`,
    };
  }

  return { status: 'ok', used, remaining, message: null };
}

/** A whole count that is not negative and not `NaN`. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Read stored quota state back, or `null` if it is not state.
 *
 * Every field is checked. Whatever holds this is a string bucket that survives
 * app upgrades and can be edited by hand, so a `reed` count of `"lots"` is a
 * real possibility - and `Number("lots")` would put `NaN` on the screen and
 * make every comparison below answer `false`, which reads as "plenty left".
 */
export function parseQuotaState(raw: unknown): QuotaState | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

  const { date, counts } = raw as Record<string, unknown>;
  if (typeof date !== 'string' || !ISO_DATE.test(date)) return null;
  if (typeof counts !== 'object' || counts === null || Array.isArray(counts)) return null;

  const { reed, adzuna } = counts as Record<string, unknown>;
  if (!isCount(reed) || !isCount(adzuna)) return null;

  // Rebuilt rather than returned as-is, so an unknown key stored by a future
  // version is dropped instead of travelling on inside our state.
  return { date, counts: { reed, adzuna } };
}
