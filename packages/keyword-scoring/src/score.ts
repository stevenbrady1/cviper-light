/**
 * `scoreByKeywords` — a full `CvAnalysis` with no API key, no Ollama, no
 * network and no model.
 *
 * ============================================================================
 * THIS IS THE FIRST THING A NEW USER SEES.
 * ============================================================================
 * Someone who has just installed CViper Light has not pasted an API key and has
 * not downloaded a 4GB model. If the app cannot analyse a CV until they do, the
 * app does nothing on first run and they close it. So this path has to produce a
 * real, defensible answer from a word list — and then say plainly that that is
 * what it did.
 *
 * The object returned is the SAME `CvAnalysis` the AI path returns, field for
 * field, so `App` renders one component either way. The only difference the
 * user should see is the label saying this was a basic keyword match.
 *
 * Pure and synchronous. No network, no Tauri, no filesystem, no clock, no
 * randomness — the same two documents always give the same score, which is
 * something the AI path cannot promise.
 */
import {
  deriveVerdict,
  err,
  ok,
  type CvAnalysis,
  type CvAnalysisSuggestion,
  type Result,
  type SuggestionPriority,
} from '@cviper/core-types';
import { atsScore, type AtsResult } from './ats';
import {
  cvTooShortError,
  emptyCvError,
  emptyJobDescriptionError,
  jobDescriptionTooShortError,
  type ScoringError,
} from './errors';
import { matchProfileToJob, type MatchResult } from './match';
import { buildCvProfile, buildJobPosting } from './profile';
import { DEFAULT_SKILL_WEIGHT, skillWeight } from './weights';

/**
 * Shortest text worth scanning, counted after whitespace is collapsed.
 *
 * Deliberately low. Rejecting real input is a much worse failure than scoring
 * a very short CV badly, and a job title on its own ("Business Analyst", 17
 * characters) is exactly the input that produces a confident-looking number
 * from nothing.
 */
export const MIN_SCORABLE_CHARS = 20;

/**
 * Characters that are invisible on screen and would otherwise corrupt a match.
 *
 * A soft hyphen (U+00AD) inside "Java-Script" is a real thing that comes out of
 * real PDFs. It is not in the token character class, so without stripping it
 * the scanner reads a `java` token that no human can see on the page and
 * credits a Java skill to a JavaScript CV.
 *
 * `@cviper/cv-parsing`'s `normalizeWhitespace` already does this — and more —
 * on every path that extracts a CV from a file. This is a two-line defence for
 * the case where text reaches the scorer some other way (a paste, a future
 * caller), not a second implementation of it: taking the dependency would pull
 * a DOCX parser into a pure function over two strings.
 *
 * WRITTEN AS ESCAPES ON PURPOSE. Pasting the literal characters in makes the
 * character class look empty in every editor, and the next person to read it
 * deletes it as dead code.
 */
const INVISIBLE = /[\u00ad\u200b\u2060\ufeff]/g;

/** Cheap, local hygiene. See `INVISIBLE` above for what this is and is not. */
function prepare(text: string): string {
  return (text ?? '').replace(INVISIBLE, '');
}

/**
 * The source's display rule for a skill name, from `job_summary` (line 851):
 * title-case it unless it carries a `/` or `.`, which would mangle `ci/cd`
 * into `Ci/Cd` and `node.js` into `Node.Js`.
 */
function displaySkill(skill: string): string {
  if (skill.includes('/') || skill.includes('.')) return skill;
  return skill.replace(/[A-Za-z]+/g, (word) => word[0]!.toUpperCase() + word.slice(1));
}

/** "1 thing" / "3 things". */
function plural(count: number, singular: string, pluralWord: string): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

// ── Summary ──────────────────────────────────────────────────────────────────

/**
 * The honest sentence.
 *
 * It must never suggest anything read the CV. A user who believes a model
 * assessed them will act on this number very differently from one who knows a
 * word list matched it, and only one of those beliefs is true here.
 */
function buildSummary(match: MatchResult, ats: AtsResult): string {
  const lead =
    'Keyword match only — this compared the words on your CV with the words in ' +
    'the advert, and nothing more.';

  const coverage =
    match.required.length > 0
      ? `Your CV shows ${match.covered.length} of the ${match.required.length} ` +
        `${match.required.length === 1 ? 'thing' : 'things'} this advert asks for, ` +
        `and uses ${ats.score}% of the wording an applicant tracking system would scan for.`
      : `This advert does not spell its requirements out in terms the word list ` +
        `recognises, so the score leans on the ${plural(match.matched.length, 'skill', 'skills')} ` +
        `your CV and the advert share, and on the ${ats.score}% of its wording your CV uses.`;

  const weighting =
    match.required.length > 0
      ? 'Rarer skills count for more than ones every advert asks for, so a specialist ' +
        'gap costs more than a missing buzzword.'
      : 'Treat it as a rough steer rather than a verdict.';

  return `${lead} ${coverage} ${weighting}`;
}

// ── Suggestions ──────────────────────────────────────────────────────────────

/**
 * Turn the biggest gaps into concrete edits, hardest-hitting first, capped at
 * five so the panel stays readable.
 *
 * Missing skills are ordered by RARITY WEIGHT, not by the order the advert
 * happened to list them: telling someone to add "Jira" above "Kubernetes"
 * would waste the one suggestion they actually read.
 */
function buildSuggestions(match: MatchResult, ats: AtsResult): CvAnalysisSuggestion[] {
  const suggestions: CvAnalysisSuggestion[] = [];

  const missingByImportance = [...match.missingEssential].sort(
    (a, b) => skillWeight(b) - skillWeight(a),
  );

  for (const skill of missingByImportance.slice(0, 3)) {
    const isRoleDefining = skillWeight(skill) >= DEFAULT_SKILL_WEIGHT;
    suggestions.push({
      section: 'Skills',
      issue: `The advert asks for ${displaySkill(skill)} and your CV does not mention it.`,
      recommendation:
        `If you have used ${displaySkill(skill)}, name it in your skills list and in the ` +
        'bullet point where you used it. If you have not, this is a genuine gap ' +
        'rather than a wording problem.',
      priority: isRoleDefining ? 'high' : 'medium',
    });
  }

  if (match.titleMatchStrength === 'none' || match.titleMatchStrength === 'partial') {
    suggestions.push({
      section: 'Job title',
      issue:
        match.titleMatchStrength === 'none'
          ? 'None of the job titles on your CV look like the one in the advert.'
          : 'The job titles on your CV only partly line up with the one in the advert.',
      recommendation:
        "Where it is honest to do so, use the advert's own job title in your personal " +
        'statement or as a bracketed alternative next to your current title.',
      priority: match.titleMatchStrength === 'none' ? 'high' : 'medium',
    });
  }

  const wordingGaps = ats.missingKeywords.slice(0, 5);
  if (wordingGaps.length > 0) {
    suggestions.push({
      section: 'Wording',
      issue: `The advert uses ${wordingGaps.map(displaySkill).join(', ')} and your CV does not.`,
      recommendation:
        'These are words a screening system looks for. Where you have done the ' +
        "work, use the advert's word for it rather than your own.",
      priority: ats.score < 60 ? 'high' : ats.score < 80 ? 'medium' : 'low',
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      section: 'Overall',
      issue: 'Nothing obvious is missing on a keyword comparison.',
      recommendation:
        'A word match cannot tell you whether the evidence behind those words is ' +
        'strong. Read the advert again and check each requirement has a result ' +
        'attached to it on your CV, not just a mention.',
      priority: 'low',
    });
  }

  const order: Record<SuggestionPriority, number> = { high: 0, medium: 1, low: 2 };
  return suggestions.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 5);
}

// ── ATS notes ────────────────────────────────────────────────────────────────

function buildAtsNotes(ats: AtsResult): string[] {
  return [
    `Applicant tracking system keyword score: ${ats.score} out of 100. That is the ` +
      "share of the advert's wording, weighted by how distinctive each term is, " +
      'that appears somewhere on your CV.',
    ...ats.suggestions,
  ];
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Score one CV against one job advert using keywords alone.
 *
 * Returns `Result.err` for input there is nothing to measure — never a zero
 * dressed up as a verdict.
 */
export function scoreByKeywords(
  cvText: string,
  jobDescription: string,
): Result<CvAnalysis, ScoringError> {
  const cv = prepare(cvText);
  const advert = prepare(jobDescription);

  const cvLength = cv.trim().length;
  if (cvLength === 0) return err(emptyCvError());

  const advertLength = advert.trim().length;
  if (advertLength === 0) return err(emptyJobDescriptionError());

  if (cvLength < MIN_SCORABLE_CHARS) return err(cvTooShortError(cvLength, MIN_SCORABLE_CHARS));
  if (advertLength < MIN_SCORABLE_CHARS) {
    return err(jobDescriptionTooShortError(advertLength, MIN_SCORABLE_CHARS));
  }

  const profile = buildCvProfile(cv);
  const job = buildJobPosting(advert);
  const match = matchProfileToJob(profile, job);
  const ats = atsScore(cv, advert);

  return ok({
    // Evidence first, conclusion last — the same reading order the JSON schema
    // imposes on a model, kept here so the two paths stay comparable.
    matched_skills: match.matched.slice(0, 10).map(displaySkill),
    missing_skills: match.missingEssential.slice(0, 10).map(displaySkill),
    matched_keywords: [...ats.keywordMatches],
    keyword_gaps: [...ats.missingKeywords],
    ats_notes: buildAtsNotes(ats),
    suggestions: buildSuggestions(match, ats),
    summary: buildSummary(match, ats),
    match_score: match.matchScore,
    // Derived, never decided here — exactly as the AI path does it, so the
    // score and the verdict can never contradict each other on screen.
    verdict: deriveVerdict(match.matchScore),
  });
}
