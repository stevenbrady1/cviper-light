/**
 * The ATS Score step (L-198): re-score the tailored CV and show before → after.
 *
 * ============================================================================
 * FAST, OFFLINE, NO AI CALL
 * ============================================================================
 * Everything here is the keyword scorer the Analysis screen already uses
 * (`@cviper/keyword-scoring`) plus the text-only readiness checks ported from
 * the web app (`@cviper/ats-checks`). Pure and synchronous: no transport, no
 * Tauri, no clock. The tailored CV was already sent to a model once, to write
 * it; checking it costs nothing and sends nothing.
 *
 * ============================================================================
 * NO NUMBER IS INVENTED
 * ============================================================================
 * The keyword scorer REFUSES text too short to measure. A refusal is carried
 * through as `null` with its reason, never shown as a 0 — "0 → 0" for an empty
 * draft would read as a verdict about the CV rather than "there is nothing to
 * score". There is no combined "readiness score" either: every figure on the
 * step is one the source scorers produce for the same text.
 *
 * ============================================================================
 * "STILL MISSING" IS A LIST OF WORDS, NOT A LIST OF CLAIMS
 * ============================================================================
 * These are `keyword_gaps` — words the advert uses that the tailored CV does
 * not — never `missing_skills`. The screen says "only add a word if it is true
 * for you" beside them, because the next thing a hurried user does with a
 * list of missing words is paste them in.
 */
import { atsReadiness, type AtsCheck, type CheckStatus } from '@cviper/ats-checks';
import { atsKeywordScore, scoreByKeywords } from '@cviper/keyword-scoring';

/** How many still-missing words the step lists. The rest are on the Analysis screen. */
export const STILL_MISSING_MAX = 5;

export interface AtsStepInput {
  /** The CV as uploaded — the same text the tailoring run was sent. */
  readonly originalCv: string;
  /** The tailored CV as it will be exported. */
  readonly tailoredCv: string;
  /** The advert both are measured against. */
  readonly jobText: string;
}

export interface KeywordComparison {
  /** 0..100, or `null` when the scorer refused the text. */
  readonly before: number | null;
  readonly after: number | null;
  /** `after - before`, or `null` when either side is `null`. */
  readonly delta: number | null;
  readonly beforeReason: string | null;
  readonly afterReason: string | null;
}

export interface BulletComparison {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly totalBefore: number;
  readonly totalAfter: number;
}

export interface CheckComparison {
  readonly id: AtsCheck['id'];
  readonly label: string;
  readonly before: CheckStatus;
  readonly after: CheckStatus;
  /** The Python's own sentence for the tailored CV — what to fix, if anything. */
  readonly afterMessage: string;
}

export interface AtsComparison {
  readonly keyword: KeywordComparison;
  readonly bullets: BulletComparison;
  /** Sections, contact details, length — always in that order. */
  readonly checks: readonly CheckComparison[];
  /** Advert words the TAILORED CV still does not use, at most `STILL_MISSING_MAX`. */
  readonly stillMissing: readonly string[];
  readonly wordsAfter: number;
}

/** The short labels the step shows. The Python's labels read as pass conditions. */
const CHECK_LABELS: Readonly<Record<AtsCheck['id'], string>> = {
  section_headers: 'Structure & sections',
  contact_info: 'Contact details',
  cv_length: 'Length',
};

function keywordSide(
  cvText: string,
  jobText: string,
): { score: number | null; reason: string | null } {
  const result = atsKeywordScore(cvText, jobText);
  return result.ok
    ? { score: result.value, reason: null }
    : { score: null, reason: result.error.message };
}

export function compareAts({ originalCv, tailoredCv, jobText }: AtsStepInput): AtsComparison {
  const before = atsReadiness(originalCv);
  const after = atsReadiness(tailoredCv);

  const keywordBefore = keywordSide(originalCv, jobText);
  const keywordAfter = keywordSide(tailoredCv, jobText);

  const analysis = scoreByKeywords(tailoredCv, jobText);
  const stillMissing = analysis.ok ? analysis.value.keyword_gaps.slice(0, STILL_MISSING_MAX) : [];

  const pairs: ReadonlyArray<readonly [AtsCheck, AtsCheck]> = [
    [before.sections, after.sections],
    [before.contact, after.contact],
    [before.length, after.length],
  ];

  return {
    keyword: {
      before: keywordBefore.score,
      after: keywordAfter.score,
      delta:
        keywordBefore.score === null || keywordAfter.score === null
          ? null
          : keywordAfter.score - keywordBefore.score,
      beforeReason: keywordBefore.reason,
      afterReason: keywordAfter.reason,
    },
    bullets: {
      before: before.bullets.overallScore,
      after: after.bullets.overallScore,
      delta: after.bullets.overallScore - before.bullets.overallScore,
      totalBefore: before.bullets.totalBullets,
      totalAfter: after.bullets.totalBullets,
    },
    checks: pairs.map(([was, now]) => ({
      id: now.id,
      label: CHECK_LABELS[now.id],
      before: was.status,
      after: now.status,
      afterMessage: now.message,
    })),
    stillMissing,
    wordsAfter: after.words,
  };
}
