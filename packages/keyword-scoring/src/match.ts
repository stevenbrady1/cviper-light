/**
 * The match score — a rarity-weighted requirement coverage, blended with the
 * job-title signal.
 *
 * Ported from `backend/ai/fallbacks.py::FallbackService.matching` (line 398),
 * with the tuning constants from lines 75-94 (CV-701 Phase 3, CV-703 Phase 5,
 * CV-704 Phase 2, CV-1040).
 *
 * ============================================================================
 * WHAT THE FORMULA IS, AND WHY IT IS NOT A MATCH COUNT.
 * ============================================================================
 *   coverage        = weighted(covered requirements) / weighted(requirements)
 *   coveragePoints  = coverage * 70
 *   rawScore        = min(round(coveragePoints + titleBonus), 95)
 *   missingPenalty  = round((1 - coverage) * 15)
 *   matchScore      = max(rawScore - missingPenalty, titleAwareFloor)
 *
 * The predecessor of this formula was `len(matched) * 10`, and it had two
 * failures the current shape exists to fix. It rewarded keyword-dense adverts
 * — a job adding more buzzwords made every candidate look better — and it
 * saturated the cap on breadth alone, so a generalist beat a specialist for a
 * specialist role. Coverage is a RATIO, so padding the advert cannot inflate
 * it, and the rarity weight means the padding has to be padding that matters.
 *
 * The penalty for missing requirements is DERIVED from the same coverage
 * rather than docked independently, so the two terms can never disagree about
 * how well covered the candidate is.
 *
 * The cap of 95 is not a rounding artefact: keyword matching never gets to be
 * fully confident. Nothing in this file has read the CV.
 */
import type { CvProfile, JobPosting } from './profile';
import { getSimilarTerms } from './similar';
import { skillWeight } from './weights';
import { termInText } from './term';
import { pythonRound } from './round';

// ── Tuning constants, ported verbatim ────────────────────────────────────────

/**
 * Bumped whenever the formula OR the shared matcher's coverage behaviour
 * changes, so scores saved by different versions are never compared. v3
 * (CV-1040) is the version this port reproduces.
 */
export const KEYWORD_SCORING_VERSION = 3;

/** Coverage occupies 0..70 of the score; the title signal supplies 0..30. */
export const COVERAGE_SCALE = 70;

/** Keyword-only ceiling. Nothing here has read the CV, so it never hits 100. */
export const RAW_SCORE_CAP = 95;

/** The neutral "we have nothing to go on" baseline — see the branch below. */
export const RAW_SCORE_UNMATCHED = 30;

/** Points per match in the no-stated-requirements fallback. */
export const SKILL_POINTS_PER_MATCH = 10;

/** Most the coverage-derived missing penalty can remove. */
export const MISSING_MAX = 15;

/** Absolute floor: a score of 0 would claim a certainty this method lacks. */
export const MATCH_SCORE_HARD_FLOOR = 10;

export type TitleMatchStrength = 'exact' | 'strong' | 'partial' | 'none';

/**
 * A strongly or exactly aligned title cannot be pushed below this, however
 * sparse the keyword overlap. A Business Analyst applying for a Business
 * Analyst role is not a 20% match because the advert listed tools they happen
 * to spell differently.
 */
export const TITLE_SCORE_FLOOR: Readonly<Record<TitleMatchStrength, number>> = {
  exact: 65,
  strong: 65,
  partial: 0,
  none: 0,
};

const SENIORITY_WORDS = new Set([
  'senior',
  'junior',
  'lead',
  'principal',
  'staff',
  'head',
  'chief',
  'graduate',
  'trainee',
  'intern',
  'mid',
  'level',
  'entry',
]);

const TITLE_STOPWORDS = new Set(['the', 'and', 'for', 'of']);

export interface MatchResult {
  /** 0..100, integer. The headline number. */
  readonly matchScore: number;
  /** Skills the CV shows that the advert asks for. */
  readonly matched: readonly string[];
  /** Requirements the candidate does not appear to have. */
  readonly missingEssential: readonly string[];
  /** Requirements the candidate does appear to have. */
  readonly covered: readonly string[];
  /** The requirement list actually scored against. */
  readonly required: readonly string[];
  readonly coverage: number;
  readonly coveragePoints: number;
  readonly titleMatchBonus: number;
  readonly titleMatchStrength: TitleMatchStrength;
  readonly matchedTitles: readonly string[];
  readonly rawScore: number;
  readonly missingPenalty: number;
  readonly scoringVersion: number;
}

/** Core role words, ignoring seniority modifiers and filler. */
function coreTitleWords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2 && !SENIORITY_WORDS.has(word) && !TITLE_STOPWORDS.has(word));
}

/** Words of a title, keeping seniority but dropping pure filler. */
function titleWords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2 && !['the', 'and', 'for'].includes(word));
}

/**
 * Strip company and department suffixes: "Role - Company", "Role | Team",
 * "Role at Company".
 */
function cleanJobTitle(title: string): string {
  let cleaned = title;
  for (const separator of [' - ', ' | ', ' — ', ' – ']) {
    if (cleaned.includes(separator)) cleaned = cleaned.split(separator)[0] as string;
  }
  return cleaned.replace(/\s+at\s+\S+.*$/i, '').trim();
}

function intersects(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

/**
 * Score one CV profile against one advert.
 *
 * Pure and synchronous. Identical input always gives identical output — the
 * user can re-run an analysis and get the same number, which a language model
 * cannot promise.
 */
export function matchProfileToJob(cvProfile: CvProfile, job: JobPosting): MatchResult {
  const jobText = `${job.title} ${job.description}`.toLowerCase();

  // Ultra-short tokens (one character, or two with no symbol) are ambiguous in
  // prose — "r" hits inside "R&D". Credit them only when the advert's own
  // posted skills corroborate, never on a bare text hit.
  const jobPosted = new Set<string>([
    ...job.keySkills.map((skill) => skill.toLowerCase()),
    ...job.keyRequirements.map((requirement) => requirement.toLowerCase()),
  ]);

  const skillHit = (term: string): boolean => {
    const t = (term || '').toLowerCase().trim();
    if (!t) return false;
    if (t.length <= 2 && !['#', '+', '.', '/'].some((symbol) => t.includes(symbol))) {
      return jobPosted.has(t);
    }
    return termInText(t, jobText);
  };

  // ── Forward match: which of the candidate's skills does the advert name? ──
  const matched: string[] = [];
  const seen = new Set<string>();

  for (const skill of cvProfile.skills) {
    const skillLower = skill.toLowerCase();
    if (seen.has(skillLower)) continue;
    if (skillHit(skillLower)) {
      matched.push(skill);
      seen.add(skillLower);
    }
    if (!seen.has(skillLower)) {
      for (const related of getSimilarTerms(skill)) {
        if (skillHit(related)) {
          matched.push(skill);
          seen.add(skillLower);
          break;
        }
      }
    }
  }

  for (const relatedSkill of cvProfile.relatedSkills) {
    const rsLower = relatedSkill.toLowerCase();
    if (seen.has(rsLower)) continue;
    if (skillHit(rsLower)) {
      matched.push(relatedSkill);
      seen.add(rsLower);
    }
  }

  // ── Reverse match: which of the advert's posted skills does the CV have? ──
  const cvSkillsLower = cvProfile.skills.map((skill) => skill.toLowerCase());
  const cvSkillsExpanded = new Set<string>(cvSkillsLower);
  for (const relatedSkill of cvProfile.relatedSkills)
    cvSkillsExpanded.add(relatedSkill.toLowerCase());
  for (const skill of cvSkillsLower) {
    for (const related of getSimilarTerms(skill)) cvSkillsExpanded.add(related.toLowerCase());
  }

  for (const jobSkill of job.keySkills) {
    const jsLower = jobSkill.toLowerCase();
    if (seen.has(jsLower)) continue;
    if (cvSkillsExpanded.has(jsLower)) {
      matched.push(jobSkill);
      seen.add(jsLower);
      continue;
    }
    for (const cvSkill of cvSkillsLower) {
      if (cvSkill.includes(jsLower) || jsLower.includes(cvSkill)) {
        matched.push(jobSkill);
        seen.add(jsLower);
        break;
      }
    }
  }

  // ── Title alignment ──────────────────────────────────────────────────────
  const jobTitleLower = job.title.toLowerCase();
  let titleMatchBonus = 0;
  let titleMatchStrength: TitleMatchStrength = 'none';
  const matchedTitles: string[] = [];
  const allTitles = [
    ...cvProfile.suggestedTitles,
    ...cvProfile.jobTitles,
    ...cvProfile.relatedTitles,
  ];

  const jobCoreWords = coreTitleWords(cleanJobTitle(jobTitleLower));
  const jobCoreSet = new Set(jobCoreWords);
  // Cross-category coverage: "Product Manager" plus "Business Analyst"
  // together cover "Product Analyst".
  const coveredJobWords = new Set<string>();

  for (const title of allTitles) {
    const words = titleWords(title);
    const candidateCore = coreTitleWords(title);
    const candidateCoreSet = new Set(candidateCore);

    if (candidateCore.length > 0 && jobCoreWords.length > 0) {
      const overlap = candidateCore.filter((word) => jobCoreSet.has(word));
      const sameSet =
        candidateCoreSet.size === jobCoreSet.size &&
        [...candidateCoreSet].every((word) => jobCoreSet.has(word));

      if (sameSet) {
        // Exact, ignoring seniority: "Business Analyst" is "Senior Business Analyst".
        matchedTitles.push(title);
        titleMatchBonus = Math.max(titleMatchBonus, 30);
        titleMatchStrength = 'exact';
        for (const word of overlap) coveredJobWords.add(word);
      } else {
        const ratio = overlap.length / Math.max(jobCoreWords.length, 1);
        if (ratio >= 0.75) {
          matchedTitles.push(title);
          titleMatchBonus = Math.max(titleMatchBonus, 25);
          if (titleMatchStrength !== 'exact') titleMatchStrength = 'strong';
          for (const word of overlap) coveredJobWords.add(word);
        } else if (ratio >= 0.5 || overlap.length >= 1) {
          const wordsFound = words.filter((word) => jobTitleLower.includes(word)).length;
          if (words.length > 0 && wordsFound >= words.length * 0.5) {
            matchedTitles.push(title);
            titleMatchBonus = Math.max(titleMatchBonus, 22);
            if (titleMatchStrength !== 'exact' && titleMatchStrength !== 'strong') {
              titleMatchStrength = 'partial';
            }
            for (const word of overlap) coveredJobWords.add(word);
          }
        }
      }
    }

    // Synonym / stem matching for titles nothing above claimed.
    if (!matchedTitles.includes(title) && words.length > 0) {
      let stemFound = 0;
      const synonymCovered = new Set<string>();
      for (const word of words) {
        if (jobTitleLower.includes(word)) {
          stemFound += 1;
          if (jobCoreSet.has(word)) synonymCovered.add(word);
        } else {
          for (const related of getSimilarTerms(word)) {
            if (jobTitleLower.includes(related.toLowerCase())) {
              stemFound += 1;
              break;
            }
          }
        }
      }
      if (stemFound >= words.length * 0.5) {
        matchedTitles.push(title);
        titleMatchBonus = Math.max(titleMatchBonus, 12);
        if (titleMatchStrength === 'none') titleMatchStrength = 'partial';
        for (const word of synonymCovered) coveredJobWords.add(word);
      }
    }
  }

  if (
    titleMatchStrength === 'partial' &&
    jobCoreWords.length > 0 &&
    coveredJobWords.size >= jobCoreWords.length &&
    matchedTitles.length >= 2
  ) {
    titleMatchBonus = Math.max(titleMatchBonus, 25);
    titleMatchStrength = 'strong';
  }

  // ── Requirement coverage ─────────────────────────────────────────────────
  const required = job.essentialSkills.length > 0 ? job.essentialSkills : job.keySkills;

  const isCovered = (requirement: string): boolean => {
    const rl = requirement.toLowerCase();
    if (seen.has(rl) || cvSkillsExpanded.has(rl)) return true;
    for (const cvSkill of cvSkillsExpanded) {
      if (termInText(rl, cvSkill) || termInText(cvSkill, rl)) return true;
    }
    const similar = new Set(getSimilarTerms(requirement).map((term) => term.toLowerCase()));
    return intersects(similar, cvSkillsExpanded);
  };

  const missingEssential = required.filter((requirement) => !isCovered(requirement));
  const covered = required.filter((requirement) => !missingEssential.includes(requirement));

  let coverage: number;
  let coveragePoints: number;
  if (required.length > 0) {
    const totalWeight = required.reduce((sum, r) => sum + skillWeight(r), 0) || 1.0;
    const coveredWeight = covered.reduce((sum, r) => sum + skillWeight(r), 0);
    coverage = coveredWeight / totalWeight;
    coveragePoints = coverage * COVERAGE_SCALE;
  } else {
    // A prose advert with nothing extractable: fall back to matched breadth
    // with diminishing returns, so breadth alone cannot dominate.
    coverage = 0;
    coveragePoints = Math.min(matched.length * SKILL_POINTS_PER_MATCH, COVERAGE_SCALE);
  }

  // The neutral baseline applies ONLY to a prose advert with no requirements
  // and no matches. When an advert states requirements and the candidate
  // covers none, a coverage of 0 flows through to the floor instead — "we
  // could not tell" and "they do not have it" are different answers.
  const hasSignal = required.length > 0 || matched.length > 0 || matchedTitles.length > 0;
  const rawScore = hasSignal
    ? Math.min(pythonRound(coveragePoints + titleMatchBonus), RAW_SCORE_CAP)
    : RAW_SCORE_UNMATCHED;

  const missingPenalty = required.length > 0 ? pythonRound((1 - coverage) * MISSING_MAX) : 0;
  const scoreFloor = Math.max(TITLE_SCORE_FLOOR[titleMatchStrength], MATCH_SCORE_HARD_FLOOR);
  const matchScore = Math.max(rawScore - missingPenalty, scoreFloor);

  return {
    // Clamped defensively. The arithmetic above cannot leave 0..100 today, but
    // a future weight edit could, and a score outside the range would be
    // rejected by `CvAnalysisSchema` in front of the user rather than here.
    matchScore: Math.max(0, Math.min(100, matchScore)),
    matched,
    missingEssential,
    covered,
    required,
    coverage,
    coveragePoints,
    titleMatchBonus,
    titleMatchStrength,
    matchedTitles,
    rawScore,
    missingPenalty,
    scoringVersion: KEYWORD_SCORING_VERSION,
  };
}
