/**
 * The cover-letter prompt — ONE call, ONE object: greeting, paragraphs,
 * sign-off, every claim in it traceable to the CV.
 *
 * PORTED FROM: backend/ai/prompts/document_gen.py  (CViper repo, @ dea8c15)
 *   `build_cover_letter_prompt`
 *   `build_cover_letter_system`
 * PORTED FROM: backend/ai/prompts/constants.py  (CViper repo, @ dea8c15)
 *   `NO_FABRICATION`  (lives in `constants.ts`)
 *
 * Upstream drift is pinned in CViper's `docs/port-parity-manifest.yaml`; its
 * guard fails there when this source changes. Symbols are named rather than
 * line numbers, which decay on the next edit upstream.
 *
 * ============================================================================
 * WHAT CHANGED, AND WHY
 * ============================================================================
 * 1. THE CV TEXT IS THE CANDIDATE. The source builds a "Candidate:" block from
 *    a parsed profile (core skills, years, strengths, achievements) plus an
 *    optional tailored-CV summary. This app has no parsed profile; it has the
 *    CV the user uploaded and, when the tailor step ran first, the tailored
 *    text. Both are fenced in whole. The model reads the facts where they are
 *    rather than a summary of them.
 *
 * 2. THREE FIELDS, NOT A LETTER. The source returns prose and the UI shows
 *    it. Here the greeting, the body paragraphs and the sign-off come back
 *    separately so `renderCoverLetter` can lay them out, the word count is
 *    honest (no address block, no date line), and the metric check runs over
 *    exactly the paragraphs.
 *
 * 3. NO TONE PRESET. The source's `tone_str` selects a register from a
 *    preference. This app has the candidate's own words about how they write
 *    (`Profile.writing_style`), which is better than a preset and is fenced
 *    as CANDIDATE NOTES.
 *
 * 4. The example opening paragraph is kept as a STRUCTURAL template with the
 *    source's own warning attached: do not copy the wording, omit a detail
 *    rather than invent one.
 */
import { sanitizeForPrompt, truncateForPrompt } from '@cviper/cv-parsing';

import { MAX_CV_CHARS, MAX_JOB_CHARS } from './build-prompt';
import { MAX_PROFILE_NOTES_CHARS } from './build-tailor-prompt';
import {
  FAIRNESS_GUARDRAIL,
  JSON_ONLY,
  NO_FABRICATION,
  UNTRUSTED_CONTENT_BOUNDARY,
} from './constants';

/**
 * How much tailored CV rides along as context.
 *
 * Smaller than `MAX_CV_CHARS`: the base CV is already in the prompt at full
 * budget, and the tailored text is there so the letter can complement it, not
 * so the model can read the same facts twice. The summary and the first role
 * are what the letter needs.
 */
export const MAX_TAILORED_CONTEXT_CHARS = 2500;

export interface CoverLetterPromptInput {
  readonly cvText: string;
  readonly jobText: string;
  /** The tailored CV as text, when the tailor step ran first. `null` otherwise. */
  readonly tailoredCvText: string | null;
  /** The candidate's own words on how they write. `null` when the profile is empty. */
  readonly profileNotes: string | null;
}

export interface CoverLetterPrompt {
  readonly system: string;
  readonly user: string;
}

/** `build_cover_letter_system`, then the four standing clauses. */
const SYSTEM = [
  'You are an expert career coach writing compelling cover letters. You use the',
  "candidate's achievements and quantified results to make the letter",
  'evidence-based and persuasive. You pair skill mentions with actions and',
  'measurable outcomes. You use power verbs and industry-standard terminology.',
  UNTRUSTED_CONTENT_BOUNDARY,
  NO_FABRICATION,
  FAIRNESS_GUARDRAIL,
  JSON_ONLY,
].join(' ');

/** The source's ten numbered requirements, reworded only where they named a field we do not have. */
const REQUIREMENTS = `Write a compelling, professional cover letter that:
1. Is 3-4 paragraphs, and no more than 400 words in total.
2. Highlights relevant experience and skills with specific evidence from the CV.
3. Shows enthusiasm for the role and the organisation specifically.
4. References specific details from the job advert.
5. Explains why the candidate is a great fit using concrete examples drawn ONLY from the candidate's actual experience and achievements in the CV.
6. Has a confident, professional tone that feels personal, not generic.
7. Avoids clichés like "I am writing to express my interest", "I am a highly motivated professional", "I believe I would be a great asset".
8. Pairs every skill mention with an action and a measurable result where the CV gives one.
9. Uses power verbs: Led, Drove, Architected, Delivered, Accelerated, Spearheaded, Engineered — avoids weak verbs like Helped, Assisted, Was involved in.
10. If a tailored CV is provided, complements it without repeating it verbatim.

Do not include an address block or a date line — start with the greeting.

CRITICAL: ${NO_FABRICATION} Only cite metrics, percentages, currency values, or timeframes that appear in the candidate's CV. If a figure is not there, describe the achievement qualitatively — do NOT invent numbers, employers, results, or dates.

Example opening paragraph (a STRUCTURAL template only — do NOT copy the wording, and replace every [bracket] with the candidate's real details from the CV; omit a detail rather than inventing one):
"Having spent [number of years from the CV] working on [a relevant area drawn from the CV], I was drawn to the [role title from the advert] role at [organisation from the advert]. [One sentence linking a genuine strength from the CV to a specific detail from the advert]."`;

const FIELD_RULES = `Field rules, in the order you must answer them:
- greeting: the opening line, e.g. "Dear Hiring Manager," — use a name only if the advert gives one.
- paragraphs: 3-4 paragraphs of body text, one string each. No greeting or sign-off inside them.
- sign_off: the closing line, e.g. "Yours sincerely,". Do not invent the candidate's name; if the CV gives one, you may use it.

${JSON_ONLY}`;

function fence(label: string, body: string, maxChars: number): string {
  const cleaned = truncateForPrompt(sanitizeForPrompt(body), maxChars);
  return `=== ${label} ===\n${cleaned}\n=== END ${label} ===`;
}

function optionalFence(label: string, body: string | null, maxChars: number): string | null {
  const cleaned = truncateForPrompt(sanitizeForPrompt(body ?? ''), maxChars);
  if (cleaned.trim() === '') return null;
  return `=== ${label} ===\n${cleaned}\n=== END ${label} ===`;
}

export function buildCoverLetterPrompt(input: CoverLetterPromptInput): CoverLetterPrompt {
  const tailored = optionalFence(
    'TAILORED CV (already written for this role — complement it, do not repeat it)',
    input.tailoredCvText,
    MAX_TAILORED_CONTEXT_CHARS,
  );
  const notes = optionalFence(
    'CANDIDATE NOTES (how they write, what to emphasise)',
    input.profileNotes,
    MAX_PROFILE_NOTES_CHARS,
  );

  const user = [
    'Write a professional cover letter for this job application.',
    '',
    fence('CV (the ONLY source of facts about the candidate)', input.cvText, MAX_CV_CHARS),
    '',
    fence('JOB ADVERT', input.jobText, MAX_JOB_CHARS),
    ...(tailored === null ? [] : ['', tailored]),
    ...(notes === null ? [] : ['', notes]),
    '',
    REQUIREMENTS,
    '',
    FAIRNESS_GUARDRAIL,
    '',
    FIELD_RULES,
  ].join('\n');

  return { system: SYSTEM, user };
}
