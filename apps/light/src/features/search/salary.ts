/**
 * Turning a job's four salary fields into one line a person can read.
 *
 * ============================================================================
 * THIS IS THE DISPLAY HALF OF THE PORTED REED BUG.
 * ============================================================================
 * `@cviper/job-apis` classifies Reed's bare figures into a `salary_period` and
 * stores it as DATA (see the long comment in `reed-salary.ts`). This is the
 * only place that turns it back into words, and it is the reason the round trip
 * is worth anything at all.
 *
 * The original in `backend/job_sites_api.py` did the same classification and
 * then threw it away into a string suffix — `unit = " per day"` — so the answer
 * travelled downstream as prose inside `"£457 - £550 per day"`. Prose has to be
 * parsed back out, and it was not: `normalize_salary` read the bare `457` as an
 * annual salary and its looks-like-thousands guard inflated it to £457k, which
 * it then re-divided into £1,987 a day. A good contract role rendered as a
 * terrible permanent one, with no error anywhere.
 *
 * So: the period arrives as a value, and it is stated here, next to the figure,
 * once. `search.dayRate.test.tsx` is the named regression test that drives the
 * whole screen and asserts a Reed day rate reaches the card saying "per day".
 *
 * ============================================================================
 * A PERIOD IS NEVER GUESSED
 * ============================================================================
 * `salary_period: null` means the source did not say, and the figures are shown
 * unqualified. Adding "per year" to an unqualified figure because most salaries
 * are annual is exactly the assumption that produced the bug above.
 */
import { type Job } from '@cviper/core-types';

/** The subset of a job this module reads. */
export type SalaryFields = Pick<
  Job,
  'salary_min' | 'salary_max' | 'salary_currency' | 'salary_period'
>;

/** How each period reads in a sentence. */
const PERIOD_SUFFIX: Record<NonNullable<Job['salary_period']>, string> = {
  year: 'per year',
  day: 'per day',
  hour: 'per hour',
};

/** Currencies with a symbol worth using. Anything else keeps its ISO code. */
const SYMBOLS: Readonly<Record<string, string>> = {
  GBP: '£',
  EUR: '€',
  USD: '$',
};

/** A usable figure, or `null`. Zero is not a salary; nor is a negative. */
function figure(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * `1234567` -> `1,234,567`.
 *
 * Hand-rolled rather than `Intl.NumberFormat`, on purpose: the grouping
 * character and the digits themselves depend on the host's ICU data and its
 * default locale, so the same job would render differently on two machines and
 * a test would pass or fail depending on which one ran it. A salary is a figure
 * to compare, not a localised string.
 */
function groupDigits(value: number): string {
  const whole = Math.round(value);
  const digits = String(whole);

  let grouped = '';
  for (let index = 0; index < digits.length; index += 1) {
    // A separator before every third digit counting from the right, except at
    // the very start — so `1000` is `1,000` and not `,1,000`.
    if (index > 0 && (digits.length - index) % 3 === 0) grouped += ',';
    grouped += digits[index];
  }
  return grouped;
}

/** `£65,000`, or `AUD 90,000` for a currency with no symbol worth using. */
function money(value: number, currency: string | null): string {
  const code = currency ?? '';
  const symbol = SYMBOLS[code];
  if (symbol !== undefined) return `${symbol}${groupDigits(value)}`;
  return code === '' ? groupDigits(value) : `${code} ${groupDigits(value)}`;
}

/**
 * One line of salary, or `null` when the advert did not say.
 *
 * `null` rather than "Competitive" or "Not stated": the caller decides how to
 * render an absence, and a card that says "Competitive" is repeating a claim
 * the advert never made.
 */
export function formatSalary(job: SalaryFields): string | null {
  const low = figure(job.salary_min);
  const high = figure(job.salary_max);
  if (low === null && high === null) return null;

  const currency = job.salary_currency;
  const period = job.salary_period === null ? null : PERIOD_SUFFIX[job.salary_period];

  // A range whose two ends are the same figure is not a range. Reed sends that
  // often, and "£500 – £500 per day" reads as a formatting fault.
  const amount =
    low !== null && high !== null && low !== high
      ? `${money(low, currency)}–${money(high, currency)}`
      : money(low ?? high ?? 0, currency);

  return period === null ? amount : `${amount} ${period}`;
}

/**
 * The same figure, for a screen reader and for `aria-label`.
 *
 * The en dash in the visual form is read aloud as nothing at all by several
 * screen readers, so "£457–£550 per day" becomes "£457 £550 per day" — which is
 * a different and much worse claim than the one on screen.
 */
export function describeSalary(job: SalaryFields): string {
  const low = figure(job.salary_min);
  const high = figure(job.salary_max);
  if (low === null && high === null) return 'Salary not stated';

  const currency = job.salary_currency;
  const period = job.salary_period === null ? null : PERIOD_SUFFIX[job.salary_period];

  const amount =
    low !== null && high !== null && low !== high
      ? `${money(low, currency)} to ${money(high, currency)}`
      : money(low ?? high ?? 0, currency);

  return period === null ? amount : `${amount} ${period}`;
}
