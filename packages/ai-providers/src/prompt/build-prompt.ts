/**
 * The fused analysis prompt — ONE call, ONE flat object.
 *
 * The production app makes TWO AI calls (fit scoring, then ATS scoring), each
 * returning its own nested object. CViper Light makes one call to a small local
 * model and returns one flat object, so the two prompts are fused here per
 * `prompt-builder.md` §3: every instruction has to land in exactly one field of
 * the flat schema, or it is an invitation for the model to invent a key.
 *
 * Layout, and why (§3.1): reasoning steps first, then calibration, then the
 * fairness constraint, then the field rules last — so the final tokens the
 * model reads are the keys it must emit.
 *
 * ============================================================================
 * THE SCHEMA IS NOT PASTED INTO THIS PROMPT.
 * ============================================================================
 * `prompt-builder.md` §3.1 proposed ending with "JSON_ONLY + the flat schema".
 * It is not done here, and the reason is a hard constraint that arrived after
 * that note was written: `verdict` must not appear in the prompt AT ALL, and
 * `CV_ANALYSIS_JSON_SCHEMA` — which is locked, and correctly still contains
 * `verdict` — would have dragged the word straight back in.
 *
 * The alternative, printing the schema minus `verdict`, is worse: all three
 * providers enforce the real schema with hard structured output (Ollama's
 * `format` is a decoding grammar, OpenAI's `strict: true` and Anthropic's
 * `output_config.format` likewise), so the model would be reading "emit these
 * eight keys" while the decoder forced a ninth.
 *
 * So the machine-readable schema travels in the provider's structured-output
 * slot only, and the prose ends with FIELD RULES naming the eight fields the
 * model must actually think about. The rules are what §3.1 wanted the schema
 * for — the exact keys, last.
 */
import { sanitizeForPrompt, truncateForPrompt } from '@cviper/cv-parsing';

import {
  ATS_SCORE_ANCHORS,
  FAIRNESS_GUARDRAIL,
  FIT_SCORE_ANCHORS,
  FIT_SCORE_WEIGHTS,
  JSON_ONLY,
} from './constants';

/**
 * Input budgets, in characters.
 *
 * The source used 8000/4000 against cloud models. `prompt-builder.md` §3.5
 * question 3 says to pick ours from the local model's context window instead.
 * At roughly 3.7 chars per token, 6000 + 4000 characters of content plus about
 * 4500 characters of scaffolding is ~3900 tokens of prompt, which leaves room
 * for a 2048-token answer inside the 8192-token `num_ctx` the Ollama adapter
 * asks for. A 131k context window is not 131k of comprehension in a 3.2B model,
 * so the budget is set by what the model can actually hold in mind, not by what
 * it will accept.
 *
 * The job description gets the smaller budget because adverts are padded with
 * boilerplate — benefits, equal-opportunities statements, application
 * instructions — while a CV is nearly all signal.
 */
export const MAX_CV_CHARS = 6000;
export const MAX_JOB_CHARS = 4000;

export interface AnalysisPromptInput {
  readonly cvText: string;
  readonly jobText: string;
}

export interface AnalysisPrompt {
  readonly system: string;
  readonly user: string;
}

/**
 * The fused system message (§3.2): `build_job_match_system` with the evaluation
 * axes from `build_ats_scoring_system` spliced in. No new claims — the union of
 * the two, because one call gets one system message.
 */
const SYSTEM = [
  'You are an expert recruiter who also screens CVs the way a modern Applicant',
  'Tracking System does. Be honest and constructive. Consider skill proficiency',
  'levels — a candidate with expert Python skills is a stronger match for a',
  'Python-heavy role than one with basic Python. You also judge keyword density,',
  'semantic intent (action+tool+impact), impact language (metrics, percentages,',
  'currency), scannability (standard headers, parseable dates) and skill',
  'clustering.',
  FAIRNESS_GUARDRAIL,
  JSON_ONLY,
].join(' ');

/**
 * Steps 1-4 are verbatim from `build_job_match_prompt` (job_matching.py lines
 * 88-91).
 *
 * Step 5 is new: the 7-factor ATS rubric from `build_ats_scoring_prompt`
 * (scoring.py lines 19-26), condensed, weights intact.
 *
 * Step 6 is the source's Step 5 REWORDED. The original said "Compute the final
 * match_score as the weighted sum of sub-scores using the weights below". We
 * return no sub-scores, and instructing a model to sum fields it is not
 * returning is exactly what makes a small model emit stray keys.
 */
const REASONING_STEPS = `Work through these steps, then answer.

Step 1 — SKILL AUDIT: For each essential skill, note if the candidate has it and at what proficiency. Weight: expert=100%, advanced=80%, intermediate=50%, basic=25%, missing=0%.

Step 2 — EXPERIENCE FIT: Compare years and seniority. Note over/under-qualified.

Step 3 — INDUSTRY & TRAJECTORY: Is the industry relevant? Is this a step up, lateral, step down, or career change?

Step 4 — COMPETENCY FIT: Assess soft skills against role requirements. Weight competencies more for senior/lead roles.

Step 5 — ATS SCREEN: Evaluate these factors (weighted by importance):
  1. KEYWORD MATCH (30%): Are the job's key skills and technologies in the CV using exact industry terminology?
  2. SEMANTIC INTENT (20%): Do bullets pair skills with actions and measurable outcomes (Action + Tool + Impact)?
  3. IMPACT LANGUAGE (15%): Does the CV use metrics, percentages, currency, and timeframes?
  4. SCANNABILITY (15%): Standard section headers, parseable dates, flat layout (no tables/columns)?
  5. SKILL CLUSTERING (10%): Dedicated skills section near the top with logical grouping?
  6. TITLE ALIGNMENT (5%): Do recent job titles or summary align with the target role?
  7. FORMATTING (5%): Concise bullets (1-2 lines), no images/graphics/non-standard fonts?

Step 6 — SYNTHESISE: Weigh the findings from Steps 1-4 using the weights below and choose a single match_score from 0-100. The ATS screen in Step 5 must NOT move that number — it describes how readable the CV is, not how well the candidate fits.`;

/**
 * §3.3 — the ATS bands become a severity ladder for prose. The old app returned
 * an `ats_score` integer; the flat schema has no such field and is not getting
 * one, so the bands still calibrate what "major structural issues" means while
 * `match_score` stays the only number in the output.
 */
const ATS_LADDER = `Judge ATS readiness against these bands (do NOT output a number for it): ${ATS_SCORE_ANCHORS} Write the findings as short ats_notes strings, worst problem first.`;

/**
 * §3.4 — the field-by-field mapping, as instructions.
 *
 * The `missing_skills` / `keyword_gaps` paragraph is the one that earns its
 * place: left implicit, a small model copies one array into the other, and the
 * user gets the same list twice under two headings.
 */
const FIELD_RULES = `Field rules:
- match_score is the only whole number you output. Nothing else in your answer is a score.
- summary: 2-3 sentences, addressed to the candidate, explaining the score.
- matched_skills: from Step 1 — skills the job asks for that the CV shows.
- missing_skills: from Step 1 — skills the job asks for that the candidate cannot do. This is about CAPABILITY.
- keyword_gaps: from Step 5 factor 1 — exact words or terms in the advert that are absent from the CV page. The candidate may well be able to do these; the exact term an ATS scans for simply is not written down. NEVER copy missing_skills into keyword_gaps: missing_skills is what they cannot do, keyword_gaps is what they did not write.
- matched_keywords: from Step 5 factor 1 — important words from the advert that already appear in the CV.
- ats_notes: from Step 5 factors 2 to 7 only. Formatting, structure, impact language, scannability. Do NOT put keywords here — they have their own two fields.
- suggestions: 3-5 items, worst first. Each has section (Skills, Experience, Summary, Formatting, Education), issue (what is wrong), recommendation (the change to make), and priority, which must be exactly one of high, medium or low.

${JSON_ONLY}`;

function fence(label: string, body: string, maxChars: number): string {
  // Sanitise BEFORE truncating: sanitising removes text, so truncating first
  // would spend budget on content that is about to be deleted anyway.
  const cleaned = truncateForPrompt(sanitizeForPrompt(body), maxChars);
  return `=== ${label} ===\n${cleaned}\n=== END ${label} ===`;
}

export function buildAnalysisPrompt(input: AnalysisPromptInput): AnalysisPrompt {
  const user = [
    fence('CV', input.cvText, MAX_CV_CHARS),
    '',
    fence('JOB', input.jobText, MAX_JOB_CHARS),
    '',
    REASONING_STEPS,
    FIT_SCORE_WEIGHTS,
    FIT_SCORE_ANCHORS,
    '',
    ATS_LADDER,
    '',
    FAIRNESS_GUARDRAIL,
    '',
    FIELD_RULES,
  ].join('\n');

  return { system: SYSTEM, user };
}

/** How much of a rejected reply is quoted back on the repair turn. */
const MAX_QUOTED_OUTPUT_CHARS = 4000;

/**
 * The single repair turn.
 *
 * ============================================================================
 * PLAIN PROSE, AND THE ORIGINAL TASK COMES WITH IT.
 * ============================================================================
 * Quoting only the broken output would let the model fix the SHAPE but not the
 * CONTENT: if `summary` came back missing, there is nothing to write a summary
 * from unless the CV and the advert are still in view. Locally a second call
 * costs seconds, not money, so the whole original task is re-sent.
 *
 * The rejected output is sanitised before being quoted. It came from a model
 * that was reading an attacker-influenced job advert, so it is untrusted text
 * on its way back into a prompt — the one place a forged fence would otherwise
 * get a free ride.
 */
export function buildRepairPrompt(
  originalUser: string,
  rejectedOutput: string,
  validationError: string,
): string {
  const cleaned = truncateForPrompt(sanitizeForPrompt(rejectedOutput), MAX_QUOTED_OUTPUT_CHARS);
  const quoted = cleaned.trim().length > 0 ? cleaned : '(the reply was empty)';

  return `${originalUser}

=== YOUR PREVIOUS REPLY ===
${quoted}
=== END PREVIOUS REPLY ===

That reply was rejected because it did not match the required output. The problem was:

${validationError}

Answer the same task again as a single corrected JSON object. Keep everything that was already right, fix only what the problem above describes, and do not explain yourself. ${JSON_ONLY}`;
}
