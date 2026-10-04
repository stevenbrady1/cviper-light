/**
 * @cviper/ats-checks — text-only ATS readiness checks (L-198).
 *
 * Fast, offline, deterministic: no model, no network, no Tauri, no clock. The
 * ATS Score step runs these on the original CV and on the tailored one, and
 * shows the two side by side, so the user can see whether tailoring helped
 * before they export.
 *
 * Every check is a measured port of the CViper web app's Python — see each
 * file's PORTED FROM header and `parity.test.ts`.
 */
export const ATS_CHECKS_PACKAGE = '@cviper/ats-checks' as const;

export {
  checkContactInfo,
  checkCvLength,
  checkSectionHeaders,
  wordCount,
  type AtsCheck,
  type CheckStatus,
} from './checks';

export {
  ACTION_VERBS,
  OUTCOME_MARKERS,
  WEAK_OPENERS,
  scoreBullet,
  scoreCvBullets,
  type BulletScore,
  type BulletTag,
  type CvBullets,
  type ScoredBullet,
} from './bullets';

export { atsReadiness, type AtsReadiness } from './readiness';

export { PY_BOUNDARY, PY_DIGIT, PY_SPACE, PY_WORD_CHAR, pySplit, pyStrip } from './python-regex';
