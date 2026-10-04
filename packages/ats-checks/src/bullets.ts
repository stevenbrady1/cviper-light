/**
 * Bullet strength: does each CV bullet open with an action verb, carry a
 * number, and name an outcome? 0-100 per bullet, averaged over the CV.
 *
 * PORTED FROM: backend/domain/bullet_scorer.py  (CViper repo, @ a2369453)
 *   score_bullet, score_cv_bullets, and their constants
 * ACTION_VERBS FROM: backend/domain/cv_health_check.py  (CViper repo, @ a2369453)
 *
 * Deterministic, offline, no model. Weights 35 / 35 / 30, as in the Python.
 *
 * ============================================================================
 * KNOWN LIMITATIONS, KEPT ON PURPOSE (measured, not fixed)
 * ============================================================================
 * These are the Python's answers, and `parity.test.ts` pins them. Changing one
 * here would make the same CV score differently in the two apps.
 * - The verb list is closed: "Cut", "Upgraded" are not on it, so "Cut costs"
 *   does not earn the verb points but "Upgraded" does ("upgraded" IS listed).
 * - A single digit next to a noun not in the unit list is not a metric:
 *   "Upgraded 4 servers" scores no metric; "5 engineers" does.
 * - "2 million" spelled out is not a metric; "2m" is.
 * - Outcome words are ASCII-only (`[a-zA-Z]+`), as in the Python.
 */
import { pythonRound } from '@cviper/keyword-scoring';

import { PY_BOUNDARY, PY_DIGIT, PY_SPACE, PY_WORD_CHAR, pyStrip } from './python-regex';

/** `ACTION_VERBS` from `cv_health_check.py`, verbatim. */
export const ACTION_VERBS: ReadonlySet<string> = new Set([
  'achieved',
  'architected',
  'automated',
  'built',
  'consolidated',
  'created',
  'decreased',
  'delivered',
  'designed',
  'developed',
  'drove',
  'eliminated',
  'engineered',
  'established',
  'expanded',
  'generated',
  'grew',
  'implemented',
  'improved',
  'increased',
  'initiated',
  'introduced',
  'launched',
  'led',
  'managed',
  'mentored',
  'migrated',
  'negotiated',
  'optimised',
  'optimized',
  'orchestrated',
  'pioneered',
  'produced',
  're-engineered',
  'rebuilt',
  'reduced',
  'refactored',
  'reformed',
  'replaced',
  'resolved',
  'restructured',
  'revamped',
  'scaled',
  'secured',
  'simplified',
  'spearheaded',
  'streamlined',
  'supervised',
  'transformed',
  'unified',
  'upgraded',
]);

/** `WEAK_OPENERS`, verbatim. */
export const WEAK_OPENERS: ReadonlySet<string> = new Set([
  'responsible',
  'duties',
  'worked',
  'helped',
  'assisted',
  'involved',
  'participated',
  'supported',
  'contributed',
  'was',
  'were',
  'am',
  'is',
  'are',
  'been',
  'being',
  'had',
  'has',
  'have',
  'did',
  'do',
  'does',
]);

/** `OUTCOME_MARKERS`, verbatim. */
export const OUTCOME_MARKERS: ReadonlySet<string> = new Set([
  'resulting',
  'leading',
  'enabling',
  'driving',
  'delivering',
  'reducing',
  'increasing',
  'improving',
  'saving',
  'generating',
  'achieving',
  'producing',
  'yielding',
  'growing',
  'scaling',
  'eliminating',
  'cutting',
  'accelerating',
  'boosting',
  'streamlining',
  'unlocking',
  'preventing',
]);

const D = PY_DIGIT;
const S = PY_SPACE;
const B = PY_BOUNDARY;

/** `_METRIC_PATTERNS`, in order, with Python's `\d`, `\s` and `\b`. */
const METRIC_PATTERNS: readonly string[] = [
  `${D}+${S}*%`,
  `[$£€¥]${S}*${D}+[${D},.kmbtKMBT]*`,
  `${D}+[${D},.]*${S}*(?:k|m|b|t|K|M|B|T)(?=${B}|${S}|$|/)`,
  `${D}+${S}*[x×]${B}`,
  `${D}+[${D},.]*${S}*\\+`,
  `${B}${D}{2,}${B}`,
  `${B}${D}+${S}*(?:hours?|days?|weeks?|months?|years?|yrs?|ms|seconds?|minutes?)${B}`,
  `${B}${D}+${S}*(?:team|engineers?|people|users?|customers?|clients?|transactions?|records?)${B}`,
];
const METRIC_RE = new RegExp(METRIC_PATTERNS.join('|'), 'iu');

/** `_BULLET_MARKER_RE`: dash, bullet, asterisk, en-dash, or `1.` / `1)`. */
const BULLET_MARKER_RE = new RegExp(`^[-•*–]${S}+|^${D}+[.)]${S}+`, 'u');

const FIRST_TOKEN_SPLIT = new RegExp(`${S}+`, 'u');
const NOT_WORD_OR_HYPHEN = new RegExp(`(?!${PY_WORD_CHAR})[^-]`, 'gu');

const WEIGHT_VERB = 35;
const WEIGHT_METRIC = 35;
const WEIGHT_OUTCOME = 30;

export type BulletTag = 'empty' | 'weak_verb' | 'no_metric' | 'no_outcome';

export interface BulletScore {
  readonly score: number;
  readonly hasActionVerb: boolean;
  readonly hasMetric: boolean;
  readonly hasOutcome: boolean;
  readonly tags: readonly BulletTag[];
}

export interface ScoredBullet extends BulletScore {
  readonly text: string;
}

export interface CvBullets {
  readonly totalBullets: number;
  /** 0..100, Python's half-to-even `round` of the mean. 0 when there are none. */
  readonly overallScore: number;
  readonly summary: { readonly strong: number; readonly adequate: number; readonly weak: number };
  readonly bullets: readonly ScoredBullet[];
}

function stripBulletMarker(text: string): string {
  return pyStrip(pyStrip(text).replace(BULLET_MARKER_RE, ''));
}

function hasActionVerb(text: string): boolean {
  if (!text) return false;
  const first = (pyStrip(text).split(FIRST_TOKEN_SPLIT)[0] ?? '')
    .toLowerCase()
    .replace(NOT_WORD_OR_HYPHEN, '');
  if (!first) return false;
  if (WEAK_OPENERS.has(first)) return false;
  return ACTION_VERBS.has(first);
}

function hasMetric(text: string): boolean {
  return text !== '' && METRIC_RE.test(text);
}

function hasOutcome(text: string): boolean {
  if (!text) return false;
  const tokens = text.toLowerCase().match(/[a-zA-Z]+/g) ?? [];
  return tokens.some((token) => OUTCOME_MARKERS.has(token));
}

/** `score_bullet`. */
export function scoreBullet(text: string | null | undefined): BulletScore {
  if (typeof text !== 'string' || pyStrip(text) === '') {
    return { score: 0, hasActionVerb: false, hasMetric: false, hasOutcome: false, tags: ['empty'] };
  }

  const cleaned = stripBulletMarker(text);
  const verb = hasActionVerb(cleaned);
  const metric = hasMetric(cleaned);
  const outcome = hasOutcome(cleaned);

  const tags: BulletTag[] = [];
  if (!verb) tags.push('weak_verb');
  if (!metric) tags.push('no_metric');
  if (!outcome) tags.push('no_outcome');

  return {
    score: (verb ? WEIGHT_VERB : 0) + (metric ? WEIGHT_METRIC : 0) + (outcome ? WEIGHT_OUTCOME : 0),
    hasActionVerb: verb,
    hasMetric: metric,
    hasOutcome: outcome,
    tags,
  };
}

/** `_extract_bullets`: lines split on `\n` only, as in the Python. */
function extractBullets(cvText: string): string[] {
  const bullets: string[] = [];
  for (const line of cvText.split('\n')) {
    const stripped = pyStrip(line);
    if (stripped === '') continue;
    if (BULLET_MARKER_RE.test(stripped)) bullets.push(stripBulletMarker(stripped));
  }
  return bullets;
}

/** `score_cv_bullets`. */
export function scoreCvBullets(cvText: string): CvBullets {
  const texts = extractBullets(cvText || '');
  if (texts.length === 0) {
    return {
      totalBullets: 0,
      overallScore: 0,
      summary: { strong: 0, adequate: 0, weak: 0 },
      bullets: [],
    };
  }

  const summary = { strong: 0, adequate: 0, weak: 0 };
  let total = 0;
  const bullets = texts.map((text) => {
    const result = scoreBullet(text);
    total += result.score;
    if (result.score >= 80) summary.strong += 1;
    else if (result.score >= 60) summary.adequate += 1;
    else summary.weak += 1;
    return { text, ...result };
  });

  return {
    totalBullets: bullets.length,
    overallScore: pythonRound(total / bullets.length),
    summary,
    bullets,
  };
}
