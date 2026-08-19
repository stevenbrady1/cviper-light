/**
 * Where the daily job-search budget is kept between runs.
 *
 * The arithmetic lives in `@cviper/job-apis` (`quota.ts`) and is pure. This is
 * the seam that gives it a clock and somewhere to write, and nothing more.
 *
 * ============================================================================
 * `localStorage`, NOT THE DATABASE.
 * ============================================================================
 * Same decision as `status/requestLog.ts`. This is a counter that is meaningless
 * tomorrow; putting it in SQLite would mean a migration, a table, and a row in
 * the user's export file for a number that resets at midnight.
 *
 * Everything here no-ops when there is no `localStorage` — a Vitest run in the
 * `node` environment, or any other non-browser host. A counter that throws
 * would take down the search it is counting, and the failure mode of "we lost
 * the count" is one skipped warning, not a broken app.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY NOT STORED
 * ============================================================================
 * A DATE AND TWO NUMBERS. No search text, no location, no timestamps, no
 * results. This app tells the user nothing leaves their machine, and the safest
 * way to keep a diagnostic honest is to make sure there is nothing in it worth
 * leaking in the first place.
 */
import {
  emptyQuota,
  parseQuotaState,
  recordProviderRequest,
  utcDateOf,
  type JobProviderId,
  type QuotaState,
} from '@cviper/job-apis';

/** Exported so tests assert against the real key rather than a copy of it. */
export const QUOTA_STORAGE_KEY = 'cviper.light.jobQuota';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Some embedders throw on the mere property access when storage is
    // disabled. An unavailable counter is not an error worth surfacing.
    return null;
  }
}

/**
 * Today's UTC date.
 *
 * Falls back to the epoch only if the clock is unreadable, which cannot happen
 * with a real `Date`. A fixed string is still better than a `null` propagating
 * into the arithmetic: it makes every count look like it belongs to one
 * long-past day, so the quota reads as empty and the user is never blocked by
 * a broken clock.
 */
function today(now: Date): string {
  return utcDateOf(now) ?? '1970-01-01';
}

/**
 * The stored quota, rolled over if the UTC day has changed since it was
 * written.
 *
 * Anything unreadable — absent, not JSON, hand-edited, written by a future
 * version — reads as an empty day. Refusing to search because a diagnostic file
 * is corrupt would be the wrong trade.
 */
export function readQuota(now: Date = new Date()): QuotaState {
  const store = storage();
  const date = today(now);
  if (store === null) return emptyQuota(date);

  // `getItem` itself throws in some embedders and in some private-browsing
  // modes — the guard in `storage()` only covers the property ACCESS, which is
  // a different failure. Reading is inside the try for that reason.
  let parsed: unknown;
  try {
    const raw = store.getItem(QUOTA_STORAGE_KEY);
    if (raw === null) return emptyQuota(date);
    parsed = JSON.parse(raw);
  } catch {
    return emptyQuota(date);
  }

  const state = parseQuotaState(parsed);
  if (state === null) return emptyQuota(date);

  // The roll-over happens on READ as well as on write, so a laptop left open
  // over midnight does not need a restart to get its allowance back.
  return state.date === date ? state : emptyQuota(date);
}

/** Persist the quota returned by a search. Never throws. */
export function writeQuota(state: QuotaState): void {
  const store = storage();
  if (store === null) return;

  try {
    store.setItem(QUOTA_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full, or private mode. The user loses a warning, not their
    // search.
  }
}

/**
 * Count one request that was made OUTSIDE a search, and return the new state.
 *
 * `searchJobs` does its own counting and hands the updated state back, so the
 * search screen never needs this. The key-setup screen does: testing a key is a
 * real request to a real board, it spends one of Reed's hundred, and a counter
 * that ignored it would read low by exactly the number of times somebody
 * struggled to get their key working.
 *
 * The reserve exists for this. `QUOTA_RESERVE` holds ten requests back from the
 * block point specifically so a key can still be tested on a day that is
 * otherwise spent — which only makes sense if a key test is counted.
 */
export function countProviderRequest(provider: JobProviderId, now: Date = new Date()): QuotaState {
  const date = today(now);
  const next = recordProviderRequest(readQuota(now), provider, date);
  writeQuota(next);
  return next;
}
