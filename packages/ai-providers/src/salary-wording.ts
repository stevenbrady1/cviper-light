/**
 * salary-wording.ts — reading what an advert SAYS about money, in TypeScript.
 *
 * PORTED FROM: c:\Dev\job-match-pro\backend\salary_utils.py
 *   `normalize_salary` skip patterns — line 140 (competitive / negotiable /
 *   DOE / depending / not specified / n/a / TBD / market rate / excellent /
 *   attractive)
 *   period detection — lines 154-158 (`/day|per day|p.d.|daily`,
 *   `/hour|per hour|/hr|p.h.|hourly`)
 *
 * ============================================================================
 * WHAT THIS IS FOR, AND WHY IT IS NOT A SALARY PARSER
 * ============================================================================
 * The source parses a salary string into numbers. We do not: the MODEL produces
 * `salary_min` / `salary_max` / `salary_currency`, and this module's only job is
 * to decide when those numbers must be OVERRULED and forced to null. It reads
 * the advert; it never reads the model's answer.
 *
 * There are three reasons a number is wrong even when it is present:
 *
 *   1. The advert quotes a DAY RATE. `JobExtraction` has no salary-period
 *      field, so a day rate has nowhere truthful to live. The source multiplies
 *      it by 230 working days and stores an annual figure — this project has
 *      already fixed that class of bug once (`SalaryPeriod` in `entities.ts`
 *      exists because Reed's period-less figures made a good contract look like
 *      an insulting permanent salary), so we will not reintroduce it. Day rate
 *      means null.
 *      TODO(salary_period): adding a `salary_period` field to `JobExtraction`
 *      would let a day rate, an hourly rate and a pro-rata figure all be
 *      captured properly instead of discarded. That is a schema change and a
 *      review-form change, and it is deliberately out of scope here. Until then
 *      the raw wording is preserved in `description` so nothing is lost.
 *   2. The advert quotes an HOURLY rate — same argument, same answer.
 *   3. The advert says PRO RATA. `£45,000 pro rata` is not a £45,000 salary; it
 *      is a full-time-equivalent figure for a part-time job, and the actual pay
 *      depends on days worked. THE SOURCE HAS ZERO COVERAGE FOR THIS — grepped
 *      across backend, frontend and e2e, `pro rata` appears nowhere, and
 *      `normalize_salary("£45,000 pro rata")` returns 45000 as a full annual
 *      salary. Built here rather than inherited.
 *
 * And one reason a number is wrong when it is ABSENT: the advert describes pay
 * in words ("Competitive", "DOE") and the model, asked for an integer, invents
 * one. That is what `blankValueSalaryWording` is for.
 *
 * ============================================================================
 * EVERY PATTERN IS RETARGETED FROM A SALARY FIELD TO A WHOLE ADVERT
 * ============================================================================
 * This is the single most important difference from the source and the easiest
 * thing to get wrong. `normalize_salary` receives a five-word string like
 * `"£45k-£55k"`, so it can anchor patterns with `^` and match bare words like
 * `daily` and `excellent` safely. We receive an entire pasted advert, where:
 *
 *   - `^excellent` becomes "excellent communication skills" — in nearly every
 *     London finance advert ever written.
 *   - bare `daily` becomes "daily stand-ups".
 *   - `\bdoe\b` becomes "John Doe" in the recruiter's signature block.
 *   - `p\.?d\.?` and `p\.?h\.?` match two-letter sequences inside ordinary words.
 *
 * Every one of those would silently null a correct salary, which is the exact
 * failure this module exists to prevent. So each pattern below is either
 * money-adjacent (`daily rate`, not `daily`), case-sensitive where the source
 * was not (`DOE`, `TBD`), or narrowed to the phrase that actually means money
 * (`excellent package`, not `excellent`). The false-positive cases are pinned
 * by name in `salary-wording.test.ts` — they are the tests that stop somebody
 * "simplifying" this back to the source's version.
 *
 * NO PATTERN CARRIES THE `g` FLAG. They are read with `.test()`, and a global
 * regex moves `lastIndex` between calls, so a shared one would answer
 * differently on alternate calls. A test asserts this.
 */

/** Pay quoted in a unit that is not a year. */
export type NonAnnualSalaryWording = 'hourly' | 'daily' | 'pro-rata';

/** One documented pattern: what it looks for, and an example of what it means. */
export interface SalaryPattern {
  readonly pattern: RegExp;
  /** Plain-English example of the wording this catches. */
  readonly matches: string;
}

/** Patterns keyed to the unit they imply. Order is the order they are tried. */
export const NON_ANNUAL_PATTERNS: readonly (SalaryPattern & {
  readonly wording: NonAnnualSalaryWording;
})[] = [
  {
    wording: 'pro-rata',
    // NEW. Nothing in the source repo matches this at all.
    pattern: /\bpro[\s-]?rata\b/i,
    matches: '"£45,000 pro rata", "pro-rata", "prorata"',
  },
  {
    wording: 'daily',
    // Source: `/day`. Kept as-is — a slash before "day" is unambiguous.
    pattern: /\/\s?day\b/i,
    matches: '"£650/day"',
  },
  {
    wording: 'daily',
    // Source: `per\s+day`. Kept as-is.
    pattern: /\bper\s+day\b/i,
    matches: '"£750 per day"',
  },
  {
    wording: 'daily',
    // NARROWED from the source's bare `daily`, which matches "daily stand-ups".
    pattern: /\b(?:day|daily)\s+rate\b/i,
    matches: '"day rate", "daily rate"',
  },
  {
    wording: 'daily',
    // NARROWED from the source's `p\.?d\.?`, which matches two letters inside
    // ordinary words. A slash makes it unambiguous.
    pattern: /\bp\/d\b/i,
    matches: '"£650 p/d"',
  },
  {
    wording: 'hourly',
    // Source: `/hour` and `/hr`, merged.
    pattern: /\/\s?h(?:ou)?r\b/i,
    matches: '"£50/hour", "£25/hr"',
  },
  {
    wording: 'hourly',
    // Source: `per\s+hour`, plus the equally common "an hour".
    pattern: /\b(?:per|an|a)\s+hour\b/i,
    matches: '"£35 per hour", "£22 an hour"',
  },
  {
    wording: 'hourly',
    // NARROWED from the source's bare `hourly`.
    pattern: /\bhourly\s+(?:rate|pay|paid)\b/i,
    matches: '"hourly rate", "hourly paid"',
  },
  {
    wording: 'hourly',
    // NARROWED from the source's `p\.?h\.?`, for the same reason as `p/d`.
    pattern: /\bp\/h\b/i,
    matches: '"£25 p/h"',
  },
];

/**
 * Money described in words instead of numbers.
 *
 * Each entry names the source pattern it came from and, where it was narrowed,
 * the false positive that forced the change.
 */
export const BLANK_VALUE_PATTERNS: readonly SalaryPattern[] = [
  {
    // Source: `^competitive`. Safe unanchored — "competitive" in an advert is
    // essentially always about pay or about the market.
    pattern: /\bcompetitive\b/i,
    matches: '"Competitive salary", "salary: competitive"',
  },
  {
    // Source: `^negotiable`.
    pattern: /\bnegotiable\b/i,
    matches: '"Salary negotiable"',
  },
  {
    // Source: `^doe$`, applied to a lowercased string. CASE-SENSITIVE here:
    // `\bdoe\b` case-insensitively matches "John Doe" in a signature block.
    pattern: /\bDOE\b/,
    matches: '"Salary: DOE"',
  },
  {
    // Source: `^depending`. NARROWED to the phrase — a bare "depending" appears
    // in ordinary advert prose ("depending on the desk").
    pattern: /\bdepending\s+on\s+(?:experience|skills?|seniority)\b/i,
    matches: '"depending on experience"',
  },
  {
    // Source: `^not\s+specified`.
    pattern: /\bnot\s+specified\b/i,
    matches: '"Salary not specified"',
  },
  {
    // Source: `^tbd$`. CASE-SENSITIVE, same reasoning as DOE.
    pattern: /\bTBD\b/,
    matches: '"Salary: TBD"',
  },
  {
    // Source: `^market\s+rate`.
    pattern: /\bmarket\s+rate\b/i,
    matches: '"We pay the market rate"',
  },
  {
    // Source: `^excellent`. NARROWED — unanchored this matches "excellent
    // communication skills", which is in nearly every advert.
    pattern: /\bexcellent\s+(?:salary|package|remuneration|benefits)\b/i,
    matches: '"An excellent package"',
  },
  {
    // Source: `^attractive`. NARROWED for the same reason.
    pattern: /\battractive\s+(?:salary|package|remuneration|benefits)\b/i,
    matches: '"An attractive salary"',
  },
];

/**
 * Anything that could be a pay figure.
 *
 * Deliberately three narrow shapes rather than "a number": an advert is full of
 * numbers (years of experience, days on site, team sizes) and treating those as
 * money would stop the blank-value clamp firing on exactly the adverts it is
 * for.
 */
const MONEY_FIGURE_PATTERNS: readonly RegExp[] = [
  /(?:[£$€]|\b(?:GBP|USD|EUR|AUD|NZD|CAD)\b)\s*\d/i,
  /\b\d+(?:\.\d+)?\s*k\b/i,
  /\b\d{1,3}(?:,\d{3})+\b/,
];

/** Which non-annual unit this advert quotes pay in, or `null`. */
export function nonAnnualSalaryWording(text: string): NonAnnualSalaryWording | null {
  if (!text) return null;
  for (const entry of NON_ANNUAL_PATTERNS) {
    if (entry.pattern.test(text)) return entry.wording;
  }
  return null;
}

/** The blank-value phrase this advert uses, or `null`. */
export function blankValueSalaryWording(text: string): string | null {
  if (!text) return null;
  for (const entry of BLANK_VALUE_PATTERNS) {
    const found = entry.pattern.exec(text);
    if (found !== null) return found[0];
  }
  return null;
}

/** Does this advert contain anything that could be a pay figure at all? */
export function hasMoneyFigure(text: string): boolean {
  if (!text) return false;
  return MONEY_FIGURE_PATTERNS.some((pattern) => pattern.test(text));
}

/** How much raw wording is worth keeping. Long enough for a sentence. */
const MAX_SNIPPET_CHARS = 200;

/**
 * The advert's own words about awkward pay, so nothing the user pasted is lost.
 *
 * ============================================================================
 * WHY THIS IS EXTRACTED HERE RATHER THAN LEFT TO THE PROMPT.
 * ============================================================================
 * The prompt DOES tell the model to copy day-rate and pro-rata wording into
 * `description`. A 3B quantised model does what it is told most of the time,
 * and "most of the time" is not a guarantee — so when the salary fields are
 * about to be forced to null, the wording that justified doing so is lifted out
 * of the advert deterministically and appended to `description` by
 * `clampExtraction`. The user then sees WHY the salary box is empty instead of
 * an empty box with no explanation.
 *
 * The snippet is bounded by line and sentence breaks so it reads as a quotation
 * rather than an offcut, and capped so a paste with no punctuation cannot push
 * an entire advert into one field.
 */
export function salaryWordingSnippet(text: string): string | null {
  if (!text) return null;

  const nonAnnual = NON_ANNUAL_PATTERNS.map((entry) => entry.pattern.exec(text)).find(
    (found) => found !== null,
  );
  const blank = BLANK_VALUE_PATTERNS.map((entry) => entry.pattern.exec(text)).find(
    (found) => found !== null,
  );
  const match = nonAnnual ?? blank;
  if (match === undefined || match === null) return null;

  const start = match.index;
  const end = start + match[0].length;

  // Widen to the enclosing sentence or line, then trim to the cap from BOTH
  // ends so the matched wording itself always survives.
  const before = text.slice(Math.max(0, start - MAX_SNIPPET_CHARS), start);
  const after = text.slice(end, end + MAX_SNIPPET_CHARS);

  const leftBreak = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('. '));
  const left = leftBreak === -1 ? before : before.slice(leftBreak + 1);

  const rightNewline = after.indexOf('\n');
  const rightStop = after.indexOf('. ');
  const rightBreak =
    rightNewline === -1
      ? rightStop
      : rightStop === -1
        ? rightNewline
        : Math.min(rightNewline, rightStop);
  const right = rightBreak === -1 ? after : after.slice(0, rightBreak + 1);

  const snippet = `${left}${match[0]}${right}`.trim();
  if (snippet.length <= MAX_SNIPPET_CHARS) return snippet;

  // No punctuation anywhere near the match. Centre the cap on the wording
  // rather than truncating from the left and losing it.
  const overflow = snippet.length - MAX_SNIPPET_CHARS;
  const trimLeft = Math.min(left.length, Math.ceil(overflow / 2));
  const trimmed = snippet.slice(trimLeft, trimLeft + MAX_SNIPPET_CHARS);
  return trimmed.trim();
}
