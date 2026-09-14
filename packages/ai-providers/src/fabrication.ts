/**
 * The fabrication check — deterministic, pure, and run on EVERY tailored CV
 * before the user reads a word of it.
 *
 * PORTED FROM: backend/ai/fallbacks.py  (CViper repo, @ dea8c15)
 *   `METRIC_PATTERN`
 *   `FallbackService.fabrication_check`
 *
 * Upstream drift is pinned in CViper's `docs/port-parity-manifest.yaml`; its
 * guard fails there when this source changes. Symbols are named rather than
 * line numbers, which decay on the next edit upstream.
 *
 * ============================================================================
 * WHY A HEURISTIC, AND WHY IT IS THE FIRST THING ON SCREEN
 * ============================================================================
 * `NO_FABRICATION` in the prompt is a request. A model at temperature 0 still
 * invents an employer now and then, and a CV with an invented employer on it
 * is not a weak draft — it is a document that ends an application the moment
 * a reference is checked. So the check is not a model call (a model checking a
 * model is the same dice twice), it is string comparison against the original
 * text, it cannot be talked out of a flag, and its report is rendered ABOVE
 * the CV: the user sees "the model added an employer you never had" before
 * they see the employer.
 *
 * ============================================================================
 * WHAT CHANGED FROM THE SOURCE
 * ============================================================================
 * 1. FOUR KINDS, NOT ONE. The source checks new metrics only; its docstring
 *    explains that the earlier proper-noun sweep flagged every tailored CV
 *    because the target company legitimately appears in the header. This
 *    port has structure the source did not: every `experience[].company`,
 *    every year in `dates` and every certification arrives as its own field,
 *    so each can be checked precisely without a proper-noun sweep and without
 *    the header problem — the target company is in the advert, not in a
 *    `company` field.
 *
 * 2. THE PATTERN KEEPS ITS SUFFIX. The source's `\b\d+[%+£$€kKmM]?\b` cannot
 *    actually match "40%" followed by a space: `%` and space are both
 *    non-word characters, so there is no boundary and the suffix backtracks
 *    away, leaving "40". The intent — "40%" is a metric — is kept here with
 *    lookarounds instead of word boundaries, so the flag reads as the user
 *    would write it.
 *
 * 3. NO RISK LEVEL, NO CAP OF FIVE. The source returns low/medium/high and
 *    truncates the list. The user of this app is looking at the CV, not a
 *    dashboard: every flag is shown, and `clean` is the only summary.
 */
import {
  renderCoverLetter,
  renderTailoredCv,
  type CoverLetter,
  type TailoredCv,
} from '@cviper/core-types';

export type FabricationKind = 'metric' | 'employer' | 'date' | 'certification';

export interface FabricationFlag {
  readonly kind: FabricationKind;
  /** The offending text, as it appears in the draft. */
  readonly text: string;
}

export interface FabricationReport {
  /** True when nothing was flagged. */
  readonly clean: boolean;
  readonly flagged: readonly FabricationFlag[];
}

/**
 * `METRIC_PATTERN`, with lookarounds in place of `\b` (see the header, change
 * 2): a run of digits with an optional unit, not embedded in a longer word or
 * number. Global, because every occurrence is collected.
 */
export const METRIC_PATTERN = /(?<![\w.,])\d+(?:[.,]\d+)*[%+£$€kKmM]?(?![\w%+£$€])/g;

/** A calendar year as a person writes one in a CV. */
const YEAR_PATTERN = /\b(?:19|20)\d{2}\b/g;

/** How many leading words of a certification must appear in the original. */
const CERTIFICATION_PREFIX_WORDS = 3;

/** Lower-case, whitespace collapsed to single spaces, trimmed. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Every metric token in the text, normalised so `50K` and `50k` are the same. */
function metricsIn(text: string): Set<string> {
  return new Set([...text.matchAll(METRIC_PATTERN)].map((match) => match[0].toLowerCase()));
}

function yearsIn(text: string): Set<string> {
  return new Set([...text.matchAll(YEAR_PATTERN)].map((match) => match[0]));
}

/** Metrics in `draft` that the original never mentions, in draft order. */
function newMetrics(original: string, draft: string): string[] {
  const known = metricsIn(original);
  const seen = new Set<string>();
  const flagged: string[] = [];
  for (const match of draft.matchAll(METRIC_PATTERN)) {
    const key = match[0].toLowerCase();
    if (known.has(key) || seen.has(key)) continue;
    seen.add(key);
    flagged.push(match[0]);
  }
  return flagged;
}

/**
 * Check a tailored CV against the text it was supposed to come from.
 *
 * Boundary: an EMPTY original flags everything, because nothing can be
 * supported by nothing. That is the right answer — a tailored CV produced
 * from a CV with no readable text is invented from top to bottom — and the
 * view never gets that far, because the run button refuses a CV with no text.
 */
export function checkFabrication(originalCvText: string, cv: TailoredCv): FabricationReport {
  const original = normalise(originalCvText);
  const originalYears = yearsIn(originalCvText);
  const flagged: FabricationFlag[] = [];

  // ── Employers ─────────────────────────────────────────────────────────────
  for (const role of cv.experience) {
    const company = normalise(role.company);
    if (company === '') continue;
    if (!original.includes(company)) {
      flagged.push({ kind: 'employer', text: role.company.trim() });
    }
  }

  // ── Dates ─────────────────────────────────────────────────────────────────
  const flaggedYears = new Set<string>();
  for (const role of cv.experience) {
    for (const year of yearsIn(role.dates)) {
      if (originalYears.has(year) || flaggedYears.has(year)) continue;
      flaggedYears.add(year);
      flagged.push({ kind: 'date', text: year });
    }
  }

  // ── Certifications ────────────────────────────────────────────────────────
  for (const certification of cv.certifications) {
    const words = normalise(certification)
      .split(' ')
      .filter((word) => word !== '');
    if (words.length === 0) continue;
    const prefix = words.slice(0, CERTIFICATION_PREFIX_WORDS).join(' ');
    if (!original.includes(prefix)) {
      flagged.push({ kind: 'certification', text: certification.trim() });
    }
  }

  // ── Metrics ───────────────────────────────────────────────────────────────
  // Over the RENDERED text, so a number anywhere — summary, skills, a bullet,
  // an education line — is caught. A year already flagged as a date is not
  // repeated as a metric; it is one invention, not two.
  for (const metric of newMetrics(originalCvText, renderTailoredCv(cv, null))) {
    if (flaggedYears.has(metric)) continue;
    flagged.push({ kind: 'metric', text: metric });
  }

  return { clean: flagged.length === 0, flagged };
}

/**
 * The letter's own check: any figure in it that the original CV never gave.
 *
 * Metrics only. A letter legitimately names the employer it is addressed to,
 * the role, and details from the advert, so the employer and date checks
 * would flag every letter ever written — the source's own reason for
 * dropping its proper-noun sweep, applied one document over.
 */
export function checkLetterClaims(
  originalCvText: string,
  letter: CoverLetter,
): readonly FabricationFlag[] {
  return newMetrics(originalCvText, renderCoverLetter(letter)).map((text) => ({
    kind: 'metric' as const,
    text,
  }));
}
