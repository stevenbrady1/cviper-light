/**
 * @cviper/keyword-scoring — CV analysis with no API key and no model.
 *
 * ============================================================================
 * THE FIRST-RUN PATH. IT HAS TO WORK BEFORE THE USER HAS CONFIGURED ANYTHING.
 * ============================================================================
 * `scoreByKeywords` returns the same `CvAnalysis` the AI path returns, so the
 * UI renders one component either way. The only difference the user should see
 * is a label saying this was a basic keyword match.
 *
 * Pure and synchronous throughout: no network, no Tauri, no filesystem, no
 * clock, no randomness. The same two documents always produce the same score.
 *
 * The scoring logic is a PORT, not a fresh design — from `backend/ai/keywords.py`
 * and two methods of `backend/ai/fallbacks.py` in the CViper web application,
 * where it has been tuned across CV-700 to CV-1040. `parity.test.ts` pins the
 * port against measurements taken from the Python original; the lexicon JSON
 * under `src/lexicons/` is a byte-for-byte copy of the source's.
 */
export const KEYWORD_SCORING_PACKAGE = '@cviper/keyword-scoring' as const;

// ── The public entry point ───────────────────────────────────────────────────

export { MIN_SCORABLE_CHARS, scoreByKeywords } from './score';

export type { ScoringError, ScoringErrorCode } from './errors';

// ── The scoring layers, exposed for callers that want the detail ─────────────

export {
  COVERAGE_SCALE,
  KEYWORD_SCORING_VERSION,
  MATCH_SCORE_HARD_FLOOR,
  MISSING_MAX,
  RAW_SCORE_CAP,
  RAW_SCORE_UNMATCHED,
  SKILL_POINTS_PER_MATCH,
  TITLE_SCORE_FLOOR,
  matchProfileToJob,
  type MatchResult,
  type TitleMatchStrength,
} from './match';

export { ATS_STOPWORDS, atsScore, cvCoversTerm, type AtsResult } from './ats';

// ── Text primitives ──────────────────────────────────────────────────────────

export { US_TO_UK, escapeRegExp, foldSpelling } from './spelling';
export { PLURAL_EXEMPT, PLURAL_MIN_LEN, PLURAL_SYMBOL_CHARS, pluralVariants } from './plurals';
export { termInFoldedText, termInText } from './term';
export { getSimilarTerms } from './similar';
export { DEFAULT_SKILL_WEIGHT, skillWeight } from './weights';
export { pythonRound } from './round';

// ── Lexicons and extraction ──────────────────────────────────────────────────

export {
  LEXICON_FILENAMES,
  aliasIndex,
  lexicon,
  readLexiconFile,
  type Lexicon,
  type SkillTitleRule,
} from './lexicon';

export {
  COMMON_SKILLS,
  DEFAULT_COMMON_SKILLS,
  DEFAULT_SKILLS,
  SKILL_VOCABULARY,
} from './vocabulary';

export {
  MAX_TEXT_LENGTH,
  buildCvProfile,
  buildJobPosting,
  extractJobTitles,
  extractSkills,
  suggestedTitles,
  titleCase,
  type CvProfile,
  type JobPosting,
} from './profile';
