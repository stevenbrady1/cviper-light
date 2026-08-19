/**
 * The ATS screen — which of the advert's words does the CV page actually use?
 *
 * Ported from `backend/ai/fallbacks.py::FallbackService.ats_score` (line 965),
 * `_cv_covers_term` (line 949) and `_ATS_STOPWORDS` (line 940), CV-1039.
 *
 * ============================================================================
 * THIS IS A DIFFERENT QUESTION FROM THE MATCH SCORE, AND THE ANSWERS DIVERGE.
 * ============================================================================
 * `match.ts` asks "can this candidate do the job". This file asks "will the
 * employer's screening software find them", which is not the same thing at
 * all. A candidate who has run Kubernetes for six years but wrote "container
 * orchestration" on the page can do the job and will still be filtered out.
 *
 * That is why `missing_skills` and `keyword_gaps` are separate fields in
 * `CvAnalysis` and why neither may be populated by copying the other:
 *   - `missing_skills` — they cannot do it. Learn it, or apply elsewhere.
 *   - `keyword_gaps`   — they can probably do it, but the exact word the
 *                        scanner looks for is not on the page. Add the word.
 * Collapsing the two would tell a qualified candidate to go and learn a skill
 * they already have.
 *
 * Two keyword layers feed it:
 *   1. Skill phrases the advert names, rarity-weighted like the match score.
 *   2. Salient 4+ character prose words not already inside a skill phrase —
 *      without which the screen would be blind to "derivatives", "regulatory"
 *      and most of what a real advert is made of.
 */
import { getSimilarTerms } from './similar';
import { pythonRound } from './round';
import { skillWeight } from './weights';
import { termInText } from './term';
import { MAX_TEXT_LENGTH } from './profile';
import { SKILL_VOCABULARY } from './vocabulary';

/** Ported verbatim from `_ATS_STOPWORDS` (line 940). */
export const ATS_STOPWORDS: ReadonlySet<string> = new Set([
  'with',
  'have',
  'this',
  'that',
  'from',
  'will',
  'your',
  'they',
  'been',
  'were',
  'their',
  'what',
  'when',
  'where',
  'which',
  'about',
  'into',
  'more',
  'some',
  'than',
  'them',
  'only',
  'also',
  'after',
  'should',
  'would',
  'could',
  'other',
  'very',
  'just',
  'over',
  'such',
  'work',
  'working',
  'role',
  'team',
  'experience',
  'looking',
  'ability',
  'essential',
  'required',
  'strong',
  'must',
  'need',
  'needed',
  'want',
]);

export interface AtsResult {
  /** 0..100. Weighted share of the advert's keywords the CV actually uses. */
  readonly score: number;
  /** Advert terms missing from the CV, skill phrases first, then by frequency. */
  readonly missingKeywords: readonly string[];
  /** Advert terms the CV already uses. */
  readonly keywordMatches: readonly string[];
  /** Tiered advice, matching the score band. */
  readonly suggestions: readonly string[];
}

/**
 * Does the CV credit this advert keyword? Direct mention, synonym, or a US/UK
 * spelling variant — the same primitives the match score uses, so the two
 * layers never disagree about whether a word is present.
 *
 * The source also consults an operator-configured synonym table here. CViper
 * Light has no such table; `getSimilarTerms` already covers the lexicon
 * synonyms that table was layered on top of.
 */
export function cvCoversTerm(term: string, cvLower: string): boolean {
  if (!term.trim() || !cvLower) return false;
  if (termInText(term, cvLower)) return true;
  for (const related of getSimilarTerms(term)) {
    if (termInText(related, cvLower)) return true;
  }
  return false;
}

/** Non-overlapping occurrences of `needle` in `haystack` — Python's `str.count`. */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

/** Keyword-based ATS scoring. Pure, synchronous and deterministic. */
export function atsScore(cvText: string, jobDescription: string): AtsResult {
  const cvLower = (cvText || '').slice(0, MAX_TEXT_LENGTH).toLowerCase();
  const jobLower = (jobDescription || '').slice(0, MAX_TEXT_LENGTH).toLowerCase();

  const matchedKeywords: string[] = [];
  const missingKeywords: string[] = [];
  let matchedWeight = 0;
  let totalWeight = 0;

  // Individual words consumed by a skill phrase, so the prose layer never
  // double-counts them — "learning" inside "machine learning".
  const skillWordIndex = new Set<string>();

  // ── Layer 1: skill phrases the advert names ──────────────────────────────
  for (const term of SKILL_VOCABULARY) {
    if (!termInText(term, jobLower)) continue;
    for (const word of term.split(/\s+/)) skillWordIndex.add(word);
    const weight = skillWeight(term);
    totalWeight += weight;
    if (cvCoversTerm(term, cvLower)) {
      matchedKeywords.push(term);
      matchedWeight += weight;
    } else {
      missingKeywords.push(term);
    }
  }

  // ── Layer 2: salient prose words not already inside a skill phrase ───────
  const proseWords: string[] = [];
  const seenProse = new Set<string>();
  for (const match of jobLower.matchAll(/\b[a-z]{4,}\b/g)) {
    const word = match[0];
    if (seenProse.has(word)) continue;
    seenProse.add(word);
    if (ATS_STOPWORDS.has(word) || skillWordIndex.has(word)) continue;
    proseWords.push(word);
  }

  for (const word of proseWords) {
    totalWeight += 1.0;
    if (termInText(word, cvLower)) {
      matchedWeight += 1.0;
      matchedKeywords.push(word);
    } else {
      missingKeywords.push(word);
    }
  }

  const rawScore = totalWeight > 0 ? pythonRound((matchedWeight / totalWeight) * 100) : 0;
  const score = Math.max(0, Math.min(rawScore, 100));

  // Skill phrases first (they carry weight), then by how often the advert says
  // it. A stable sort keeps the order deterministic inside a frequency tier.
  const missingSorted = [...missingKeywords].sort((a, b) => {
    const aIsSkill = skillWordIndex.has(a.split(/\s+/)[0] ?? a);
    const bIsSkill = skillWordIndex.has(b.split(/\s+/)[0] ?? b);
    if (aIsSkill !== bIsSkill) return aIsSkill ? -1 : 1;
    const aCount = countOccurrences(jobLower, a.split(/\s+/)[0] ?? a);
    const bCount = countOccurrences(jobLower, b.split(/\s+/)[0] ?? b);
    return bCount - aCount;
  });

  // Advice tiers: under 60 is a real problem, 60-80 is improvable, 80+ is fine.
  const suggestions: string[] = [];
  if (score < 60) suggestions.push('Add more keywords from the job description to your CV');
  if (score < 80) {
    suggestions.push(
      'Ensure section headers match standard ATS formats (Experience, Education, Skills)',
    );
  }
  suggestions.push('Use the exact job title from the posting in your CV summary');

  return {
    score,
    missingKeywords: missingSorted.slice(0, 15),
    keywordMatches: matchedKeywords.slice(0, 20),
    suggestions: suggestions.slice(0, 5),
  };
}
