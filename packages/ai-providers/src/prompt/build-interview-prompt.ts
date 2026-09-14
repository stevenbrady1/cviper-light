/**
 * The interview prep prompt — ONE call, ONE flat object, four fields.
 *
 * PORTED FROM: backend/ai/prompts/career_insights.py  (CViper repo, @ dea8c15)
 *   `build_interview_prep_prompt`
 *   `build_interview_prep_system`
 *
 * Upstream drift is pinned in CViper's `docs/port-parity-manifest.yaml`; its
 * guard fails there when this source changes. Symbols are named rather than
 * line numbers, which decay on the next edit upstream.
 *
 * ============================================================================
 * WHAT CHANGED, AND WHY — read this before "restoring" anything.
 * ============================================================================
 * 1. FOUR FIELDS, NOT SIX. The source asks for `likely_questions`,
 *    `technical_questions`, `talking_points`, `company_research`,
 *    `questions_to_ask` and `red_flag_questions`. `company_research` is
 *    DELETED: no web research is possible offline, and a model asked for
 *    research it cannot do writes fiction. `red_flag_questions` is DELETED:
 *    the source builds it from a "potential concerns" analysis (`flags_str`)
 *    this app never runs. `technical_questions` is DELETED and folded into
 *    `likely_questions`: a second list with a differently-shaped item is the
 *    schema breadth a small model loses the thread on. `gaps_to_bridge` is
 *    ADDED — see `interview.ts` in core-types. Naming a field the schema does
 *    not have is the single most reliable way to make a 3B model emit a key
 *    the closed schema then rejects, so none of the three deleted names
 *    appears here, and a test asserts they stay absent.
 *
 * 2. THE CANDIDATE IS THE ARCHIVED APPLICATION AND THE PROFILE, NOT A PARSED
 *    CV PROFILE. The source is handed `skills_str`, `experience_years`,
 *    `job_titles` and an `achievements_str` from its CV parser. This app has
 *    the CV text itself, the cover letter that was sent, the advert as posted
 *    and the profile's worked examples (`star_examples`) — richer material,
 *    fenced whole rather than summarised, because the STAR examples ARE the
 *    "actual achievements as evidence" the source's prompt asks the model to
 *    use, and a model reading them verbatim has nothing to reconstruct.
 *
 * 3. THE BRIDGE RULE IS NEW. The source says "use the candidate's actual
 *    achievements"; it never says what to do when there is no matching
 *    achievement, and a model left to decide invents one. Here the system
 *    message says it outright: acknowledge the gap, connect adjacent
 *    experience, never invent. The `gaps_to_bridge` field exists so the
 *    model has somewhere honest to put what it found.
 *
 * 4. NO JSON TEMPLATE IS PASTED IN, for the reason `build-prompt.ts` gives:
 *    the machine-readable schema travels in the provider's structured-output
 *    slot, and the FIELD RULES below name the four keys in schema order.
 *
 * 5. `temperature` is not set here. This package types it as the literal `0`
 *    (see `types.ts`), and rehearsing an interview from the same material
 *    should produce the same rehearsal.
 */
import { sanitizeForPrompt, truncateForPrompt } from '@cviper/cv-parsing';

import { FAIRNESS_GUARDRAIL, JSON_ONLY, UNTRUSTED_CONTENT_BOUNDARY } from './constants';

/**
 * Input budgets, in characters.
 *
 * Four fenced materials share one 8192-token window with a ~2,000-character
 * scaffold and a 2048-token answer. At roughly 3.7 characters per token,
 * 3,500 + 3,500 + 1,500 + 2,000 characters of material is ~2,850 tokens,
 * which with the scaffold and the answer lands near 5,900 — comfortable
 * headroom, and the same "what the model can hold in mind, not what it will
 * accept" reasoning `build-prompt.ts` records.
 *
 * The advert and the CV get the two largest budgets because the questions come
 * from one and the evidence from the other. The letter is smaller: it restates
 * the CV, and its value is the framing the candidate already chose.
 */
export const MAX_INTERVIEW_ADVERT_CHARS = 3500;
export const MAX_INTERVIEW_CV_CHARS = 3500;
export const MAX_INTERVIEW_LETTER_CHARS = 1500;
/** The rendered STAR block as a whole, after each example is capped. */
export const MAX_INTERVIEW_STAR_CHARS = 2000;
/** Per STAR field. Six examples of four fields at this size is the block cap. */
const MAX_STAR_FIELD_CHARS = 300;
/** Beyond this many examples the block cap truncates mid-example anyway. */
const MAX_STAR_EXAMPLES = 6;
/** Title, company, headline, and each career goal. */
const MAX_SHORT_FIELD_CHARS = 200;
const MAX_CAREER_GOALS = 5;

export interface InterviewStarExample {
  readonly title: string;
  readonly situation: string;
  readonly task: string;
  readonly action: string;
  readonly result: string;
}

export interface InterviewPromptProfile {
  readonly headline: string | null;
  readonly starExamples: readonly InterviewStarExample[];
  readonly careerGoals: readonly string[];
}

export interface InterviewPromptInput {
  readonly jobTitle: string;
  readonly company: string;
  /** The advert as archived, or the job's description. `null` when there is neither. */
  readonly advert: string | null;
  /** The CV that was sent, or the most recent parsed CV. `null` when there is neither. */
  readonly cvText: string | null;
  readonly coverLetter: string | null;
  readonly profile: InterviewPromptProfile;
}

export interface InterviewPrompt {
  readonly system: string;
  readonly user: string;
}

/**
 * The system message.
 *
 * The first three sentences are `build_interview_prep_system`, verbatim. Then
 * the trust boundary (L-153) — every material in the user turn is either
 * something the user pasted or something a recruiter wrote, and the system
 * message has to say out loud that it is material, not instructions. Then the
 * fairness constraint, because a rehearsal that steers a candidate by their
 * name or their employment gap is the same unfairness as a score that does.
 * Then the bridge rule (header, change 3). `JSON_ONLY` closes, as every
 * system message in this package does — see `untrusted-boundary.contract.test.ts`.
 */
const SYSTEM = [
  'You are an expert interview coach who prepares candidates to excel.',
  "Use the candidate's real achievements in suggested answers. Be specific",
  'and practical. Help the candidate both impress AND evaluate the opportunity.',
  UNTRUSTED_CONTENT_BOUNDARY,
  FAIRNESS_GUARDRAIL,
  "Use only the candidate's real material. Where the advert asks for something",
  'the material does not show, write a bridge answer that acknowledges the gap',
  'and connects adjacent experience — never invent experience.',
  JSON_ONLY,
].join(' ');

/**
 * The field-by-field rules, in SCHEMA ORDER.
 *
 * The order is the order the constrained decoder will force anyway (see
 * `INTERVIEW_PACK_JSON_SCHEMA`), and a prompt that lists the fields in a
 * different order from the grammar is a prompt actively fighting the decoder.
 * The counts are the source's, scaled to a local model's output budget: 8-10
 * likely questions became 6-8, 5-7 talking points became 4-6, and 4-6
 * questions to ask are unchanged.
 */
const FIELD_RULES = `Field rules, in the order you must answer them:
- likely_questions: 6 to 8 questions this interviewer is likely to ask, given THIS advert. Each has question and suggested_answer. Shape every answer Situation, Task, Action, Result, and build it from the candidate's worked examples and CV — name the real project, the real team, the real outcome. Where the advert asks for something the material does not show, the answer says so plainly and connects the nearest real experience. Do not invent a project, a number or an employer.
- talking_points: 4 to 6 points the candidate should raise themselves — their strongest real evidence for this advert, one sentence each.
- questions_to_ask: 4 to 6 questions the candidate should ask the interviewer. Each must be specific to something written in this advert — a named responsibility, tool, team, phrase or condition. Nothing that could be asked at any interview.
- gaps_to_bridge: the things the advert asks for that the candidate's material does not show. Short phrases, one gap each. An empty list is the correct answer when there are none.

${JSON_ONLY}`;

/** What a fence says when there is nothing to put in it. */
const NOT_SUPPLIED = '(not supplied)';

/*
 * ============================================================================
 * EVERY FENCE LABEL STARTS WITH `CV` OR `JOB`. THAT IS NOT A NAMING QUIRK.
 * ============================================================================
 * `sanitizeForPrompt` strips a forged fence from a paste — but only one whose
 * label starts with `CV` or `JOB`, because those were the only two fences in
 * the package when the pattern was written. A fence called `COVER LETTER`
 * would be unprotected: a letter containing the line `=== END COVER LETTER ===`
 * would close our section and whatever followed would read as ours. So the
 * candidate-side materials are `CV PROFILE`, `CV EXAMPLES`, `CV` and
 * `CV LETTER`, and the job side is `JOB`. `build-interview-prompt.test.ts`
 * plants a forged closer in each and asserts it does not survive.
 */

/** Sanitise, then truncate — sanitising removes text, so it goes first. */
function clean(body: string, maxChars: number): string {
  return truncateForPrompt(sanitizeForPrompt(body), maxChars);
}

/** A short single-line value: cleaned, with any newlines folded away. */
function short(value: string): string {
  return clean(value, MAX_SHORT_FIELD_CHARS)
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

function fence(label: string, body: string): string {
  return `=== ${label} ===\n${body}\n=== END ${label} ===`;
}

/** A material that may be absent. The fence is always there; the body says which. */
function optionalFence(label: string, body: string | null, maxChars: number): string {
  const cleaned = body === null ? '' : clean(body, maxChars);
  return fence(label, cleaned.trim().length === 0 ? NOT_SUPPLIED : cleaned);
}

/**
 * The candidate's own words about themselves: the headline and the goals.
 *
 * Both are profile fields the user typed, so they are cleaned like everything
 * else — the boundary applies to what the user wrote too, because a profile
 * restored from a backup file is text this app did not author.
 */
function candidateBlock(profile: InterviewPromptProfile): string {
  const headline = profile.headline === null ? '' : short(profile.headline);
  const goals = profile.careerGoals
    .slice(0, MAX_CAREER_GOALS)
    .map(short)
    .filter((goal) => goal.length > 0);

  const lines = [
    `Headline: ${headline.length === 0 ? NOT_SUPPLIED : headline}`,
    `Career goals: ${goals.length === 0 ? NOT_SUPPLIED : goals.join('; ')}`,
  ];
  return fence('CV PROFILE', lines.join('\n'));
}

/**
 * The worked examples, as short numbered STAR blocks.
 *
 * Each field is capped so one long example cannot crowd out the others, and
 * the rendered block is capped again so a profile with twenty examples still
 * fits the window. Rendered in the shape interviewers ask for — Situation,
 * Task, Action, Result — so the model can lift an answer's skeleton straight
 * from the material rather than reassembling it.
 */
function starBlock(examples: readonly InterviewStarExample[]): string {
  if (examples.length === 0) return fence('CV EXAMPLES', NOT_SUPPLIED);

  const field = (value: string) => clean(value, MAX_STAR_FIELD_CHARS).trim();
  const rendered = examples
    .slice(0, MAX_STAR_EXAMPLES)
    .map((example, index) =>
      [
        `${index + 1}. ${field(example.title)}`,
        `   Situation: ${field(example.situation)}`,
        `   Task: ${field(example.task)}`,
        `   Action: ${field(example.action)}`,
        `   Result: ${field(example.result)}`,
      ].join('\n'),
    )
    .join('\n\n');

  return fence('CV EXAMPLES', truncateForPrompt(rendered, MAX_INTERVIEW_STAR_CHARS));
}

/**
 * The job. Title and company are on their own lines so the model has them
 * even when the advert is missing — a pack for "Credit Risk Analyst at Lloyds"
 * with no advert is thin but honest; one with no title is nothing.
 */
function jobBlock(input: InterviewPromptInput): string {
  const advert = input.advert === null ? '' : clean(input.advert, MAX_INTERVIEW_ADVERT_CHARS);
  const lines = [
    `Title: ${short(input.jobTitle)}`,
    `Company: ${short(input.company)}`,
    'Advert:',
    advert.trim().length === 0 ? NOT_SUPPLIED : advert,
  ];
  return fence('JOB', lines.join('\n'));
}

export function buildInterviewPrompt(input: InterviewPromptInput): InterviewPrompt {
  const user = [
    'Prepare interview materials for this candidate applying to this job.',
    JSON_ONLY,
    '',
    candidateBlock(input.profile),
    '',
    starBlock(input.profile.starExamples),
    '',
    optionalFence('CV', input.cvText, MAX_INTERVIEW_CV_CHARS),
    '',
    optionalFence('CV LETTER', input.coverLetter, MAX_INTERVIEW_LETTER_CHARS),
    '',
    jobBlock(input),
    '',
    FIELD_RULES,
  ].join('\n');

  return { system: SYSTEM, user };
}
