/**
 * extraction-clamp.ts — the near-miss repairs for a pasted-advert extraction,
 * applied BEFORE validation.
 *
 * Same contract as `clamp.ts`, and the same reasoning: a 3B quantised model
 * gets the edges of a schema wrong in a new way every run, and spending the one
 * retry on `"45000"` instead of `45000` wastes 5-30 seconds of the user's life
 * when the answer underneath is fine. Every repair below is ENUMERATED, TESTED
 * and REPORTS ITSELF in `applied`. Nothing is guessed silently.
 *
 * ============================================================================
 * TWO JOBS, AND THE SECOND ONE IS THE POINT OF THE FEATURE
 * ============================================================================
 * 1. NORMALISATION — ported from the source's `_normalise_email_fields`
 *    (ai/services/search_helpers.py line 222). Missing keys and empty strings
 *    both collapse to `null`, so "the advert did not say" and "the model
 *    returned a blank" become ONE state the review form renders identically.
 *
 * 2. THE SALARY OVERRULE — not in the source at all, in this form. The model is
 *    asked for `null` when pay is a day rate, an hourly rate, pro rata, or
 *    described only in words. Asking is not enough. This is the deterministic
 *    correction that fires when the model answers with a number anyway, and it
 *    reads the ADVERT, never the model's reply, so it cannot be talked out of
 *    it. See `salary-wording.ts` for the patterns and what each one was
 *    narrowed from.
 *
 * WHEN THE OVERRULE FIRES, THE WORDING IS KEPT. Forcing three fields to null
 * without saying why leaves the user staring at an empty salary box wondering
 * whether the app broke. So the advert's own sentence about pay is lifted out
 * and appended to `description`. Nothing the user pasted is lost, and the
 * emptiness explains itself.
 *
 * ============================================================================
 * WHAT THIS DELIBERATELY DOES *NOT* REPAIR
 * ============================================================================
 * An unreadable salary — `"about forty grand"` — is left EXACTLY as it came, so
 * validation fails and the caller spends its one retry. Coercing it to null
 * would look like a successful extraction of an advert that says nothing about
 * money, which is a different and wrong answer. The refusals matter as much as
 * the repairs.
 */
import { EMPTY_JOB_EXTRACTION } from '@cviper/core-types';

import {
  blankValueSalaryWording,
  hasMoneyFigure,
  nonAnnualSalaryWording,
  salaryWordingSnippet,
} from './salary-wording';

export interface ExtractionClampResult {
  /** A COPY. The caller's object is never mutated. */
  readonly value: unknown;
  /** Stable names. Tests and the UI's "what was corrected" line read them. */
  readonly applied: readonly string[];
}

/** The nine fields, in schema order. */
const FIELDS = Object.keys(EMPTY_JOB_EXTRACTION);

/** Fields whose value is prose. */
const STRING_FIELDS = [
  'title',
  'company',
  'location',
  'url',
  'description',
  'posted_date',
  'salary_currency',
] as const;

const SALARY_NUMBER_FIELDS = ['salary_min', 'salary_max'] as const;

/**
 * Symbols a model writes instead of an ISO-4217 code.
 *
 * `Job.salary_currency` is documented as ISO-4217, and the search view's
 * formatter expects a code, so a bare `£` reaching the database would render as
 * "£45,000 £" or worse. Mapping the four symbols an advert in this app's market
 * actually uses is cheap; guessing beyond them is not.
 */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  '£': 'GBP',
  $: 'USD',
  '€': 'EUR',
  '¥': 'JPY',
};

/** How the preserved wording is introduced in `description`. */
const WORDING_PREFIX = 'Pay as stated in the advert:';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a salary number out of whatever the model wrote.
 *
 * Accepts a real number, or a string that is ENTIRELY a number once a leading
 * currency symbol, thousands separators and surrounding whitespace are removed.
 * `"about forty grand"` and `"45000 per year"` return null on purpose — a
 * partial match is a guess, and this is the one field where a guess does real
 * damage.
 */
function readSalaryNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim().replace(/^[£$€¥]\s*/, '').replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Fold a currency into an ISO-4217 code, or `null` if it is not one. */
function readCurrency(raw: string): { code: string | null; clamp: string | null } {
  const trimmed = raw.trim();

  const mapped = CURRENCY_SYMBOLS[trimmed];
  if (mapped !== undefined) return { code: mapped, clamp: 'salary_currency:symbol-to-code' };

  if (/^[A-Za-z]{3}$/.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    return { code: upper, clamp: upper === trimmed ? null : 'salary_currency:upper-cased' };
  }

  return { code: null, clamp: 'salary_currency:unrecognised-to-null' };
}

/**
 * Has the model ALREADY carried the pay wording across?
 *
 * Compared by MEANING, not by string. The prompt asks the model to copy the
 * wording into `description`, and when it obeys it paraphrases — "Pays £45,000
 * pro rata for 3 days a week" against an advert line reading "Salary £45,000
 * pro rata for 3 days a week". A substring check calls those different and
 * appends the sentence a second time, which reads as a bug to the user and is
 * exactly the sort of near-miss this whole module exists to absorb.
 *
 * So: the description counts as carrying the wording when it says the same KIND
 * of thing (pro rata / day rate / hourly, or a blank-value phrase) AND, where
 * the advert quotes a figure, carries a figure of its own. The second half
 * matters — a description that says "pro rata" but drops the £45,000 has lost
 * the number, and the number is half of what the user needs to see.
 */
function alreadyCarriesWording(description: string, sourceText: string): boolean {
  const kind = nonAnnualSalaryWording(sourceText);

  if (kind !== null) {
    if (nonAnnualSalaryWording(description) !== kind) return false;
    return !hasMoneyFigure(sourceText) || hasMoneyFigure(description);
  }

  return blankValueSalaryWording(description) !== null;
}

/** Append the advert's own pay wording to a description that lacks it. */
function withWordingPreserved(description: unknown, snippet: string, sourceText: string): string {
  const existing = typeof description === 'string' ? description.trim() : '';

  if (existing.length > 0 && alreadyCarriesWording(existing, sourceText)) return existing;

  const quoted = `${WORDING_PREFIX} ${snippet}`;
  return existing.length > 0 ? `${existing}\n\n${quoted}` : quoted;
}

export function clampExtraction(raw: unknown, sourceText: string): ExtractionClampResult {
  if (!isPlainObject(raw)) return { value: raw, applied: [] };

  const applied: string[] = [];
  const out: Record<string, unknown> = { ...raw };

  // ── Absent becomes null ───────────────────────────────────────────────────
  for (const field of FIELDS) {
    if (out[field] === undefined) {
      out[field] = null;
      applied.push(`${field}:absent-to-null`);
    }
  }

  // ── Blank strings become null, and everything else is trimmed ─────────────
  for (const field of STRING_FIELDS) {
    const current = out[field];
    if (typeof current !== 'string') continue;

    const trimmed = current.trim();
    if (trimmed.length === 0) {
      out[field] = null;
      applied.push(`${field}:blank-to-null`);
    } else {
      out[field] = trimmed;
    }
  }

  // ── Salary numbers ────────────────────────────────────────────────────────
  for (const field of SALARY_NUMBER_FIELDS) {
    const current = out[field];
    if (current === null) continue;

    const parsed = readSalaryNumber(current);
    // Unreadable. Left exactly as it came so validation fails and the caller
    // spends its one retry — see the header.
    if (parsed === null) continue;

    if (typeof current === 'string') applied.push(`${field}:string-to-number`);

    if (parsed < 0) {
      out[field] = null;
      applied.push(`${field}:negative-to-null`);
      continue;
    }

    if (!Number.isInteger(parsed)) {
      out[field] = Math.round(parsed);
      applied.push(`${field}:rounded`);
      continue;
    }

    out[field] = parsed;
  }

  // ── Currency ──────────────────────────────────────────────────────────────
  const currency = out['salary_currency'];
  if (typeof currency === 'string') {
    const read = readCurrency(currency);
    out['salary_currency'] = read.code;
    if (read.clamp !== null) applied.push(read.clamp);
  }

  // ── THE OVERRULE. Reads the advert, never the reply. ──────────────────────
  const nonAnnual = nonAnnualSalaryWording(sourceText);
  const blankValue = blankValueSalaryWording(sourceText);

  // A blank-value phrase only overrules when the advert quotes NO figure at
  // all. "A competitive salary of £95,000" is both competitive and a number,
  // and nulling it would throw away the one fact the user wanted.
  const blankValueWins = nonAnnual === null && blankValue !== null && !hasMoneyFigure(sourceText);

  if (nonAnnual !== null || blankValueWins) {
    const reason = nonAnnual ?? 'blank-value';
    const hadFigure =
      out['salary_min'] !== null ||
      out['salary_max'] !== null ||
      out['salary_currency'] !== null;

    out['salary_min'] = null;
    out['salary_max'] = null;
    out['salary_currency'] = null;
    if (hadFigure) applied.push(`salary:${reason}-to-null`);

    const snippet = salaryWordingSnippet(sourceText);
    if (snippet !== null) {
      const before = out['description'];
      const after = withWordingPreserved(before, snippet, sourceText);
      if (after !== before) {
        out['description'] = after;
        applied.push('description:salary-wording-preserved');
      }
    }
  }

  // ── A currency with nothing to label is noise ─────────────────────────────
  // Ported from the source's `estimated_salary` rule: an object carrying only
  // `{"currency": "GBP"}` and no number was dropped for exactly this reason.
  if (
    out['salary_currency'] !== null &&
    out['salary_min'] === null &&
    out['salary_max'] === null
  ) {
    out['salary_currency'] = null;
    applied.push('salary_currency:no-figure-to-null');
  }

  return { value: out, applied };
}
