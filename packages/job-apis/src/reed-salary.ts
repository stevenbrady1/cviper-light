/**
 * What unit Reed's bare salary numbers are in.
 *
 * PORTED FROM `c:\Dev\job-match-pro\backend\job_sites_api.py`:
 *   `_DAY_RATE_CEILING`       line 309 (comment at 304-308)
 *   `ReedAPI._format_salary`  lines 311-333 — NOT ported, deliberately replaced
 *
 * ============================================================================
 * THE SHAPE IS DELIBERATELY DIFFERENT FROM THE SOURCE, AND THAT IS THE FIX.
 * ============================================================================
 * The original computed exactly this classification and then threw it away into
 * a string suffix — `unit = " per day"` — so the answer travelled downstream as
 * prose inside `"£457 - £550 per day"`. Prose has to be parsed back out, and it
 * was not: `normalize_salary` read the bare `457` as an annual salary and its
 * "looks-like-thousands" guard inflated it to £457k, which it then re-divided
 * into £1,987/day. A good contract role rendered as a terrible permanent one.
 *
 * So this returns the period as DATA. The caller formats at the point of
 * display, where nothing has to read it back.
 */
import { toFiniteNumber } from './numbers';

/**
 * Comment copied VERBATIM from the source — do not paraphrase it:
 *
 *   Reed returns salary figures with NO period unit. A figure under this
 *   ceiling is a day rate, never a genuine annual salary — mirror the
 *   threshold used by _classify_reed_contract_type. Without preserving the
 *   unit, normalize_salary reads "£457" as an annual salary and its
 *   "looks-like-thousands" guard inflates it to £457k → £1987/day.
 */
export const DAY_RATE_CEILING = 2000;

/** Period a Reed salary figure is expressed in, or `null` when unknowable. */
export type ReedSalaryPeriod = 'day' | 'year';

/**
 * Classify the period unit behind Reed's bare salary numbers.
 *
 * Rules, unchanged from the source:
 *  - magnitude = max(min ?? 0, max ?? 0)               (source line 322)
 *  - 0 < magnitude < DAY_RATE_CEILING  ->  'day'       (source lines 323-324)
 *  - a figure that will not read is swallowed, no period claimed
 *    (source lines 325-326, which catch TypeError/ValueError and leave `unit`
 *    empty)
 *  - a magnitude of 0, or no figures at all -> `null`; the source rendered
 *    these as "Competitive" (line 333) — no figures, so no period to state.
 *
 * One judgement call, flagged: the source appends NO unit at or above the
 * ceiling and downstream treats the bare figure as annual. `'year'` here makes
 * that implicit default explicit — same meaning, now visible in the type
 * rather than assumed by the next reader.
 */
export function classifyReedSalaryPeriod(
  min: number | null | undefined,
  max: number | null | undefined,
): ReedSalaryPeriod | null {
  const low = toFiniteNumber(min);
  const high = toFiniteNumber(max);

  // Python's `float(min_sal or 0)` treats null/undefined/0 alike; a value that
  // will not convert raises, and the source then claims no unit at all.
  if (low === null && high === null) return null;

  const magnitude = Math.max(low ?? 0, high ?? 0);
  if (magnitude <= 0) return null;
  return magnitude < DAY_RATE_CEILING ? 'day' : 'year';
}
