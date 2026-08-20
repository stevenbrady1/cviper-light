/**
 * The pasted-advert extraction prompt — ONE call, ONE flat object, nine fields.
 *
 * PORTED FROM: c:\Dev\job-match-pro\backend\ai\prompts\search_helpers.py
 *   `build_email_job_extraction_prompt`  — line 72
 *   `build_email_job_extraction_system`  — line 122
 *   and the comment block at line 60, which is the reason the source prompt is
 *   worth porting at all rather than writing fresh.
 *
 * That comment says a recruiter email is NOT a job-board posting: it is
 * conversational, the client employer is often deliberately obscured ("a Tier 1
 * investment bank"), the money is a day rate rather than a salary band, and the
 * terms a London contractor actually decides on arrive in prose. All of that is
 * still true of anything a user pastes into this app, which is why the source's
 * wording is kept rather than replaced.
 *
 * ============================================================================
 * WHAT CHANGED, AND WHY — read this before "restoring" anything.
 * ============================================================================
 * 1. NINE FIELDS, NOT SEVENTEEN. The source's JSON template lists `agency`,
 *    `recruiter_name`, `recruiter_email`, `ir35_status`, `contract_type`,
 *    `contract_duration`, `notice_period`, `seniority_level`, `benefits[]`,
 *    `essential_skills[]`, `desirable_skills[]` and a nested `estimated_salary`
 *    object. `JobExtraction` has none of them. Naming a field the schema does
 *    not have is the single most reliable way to make a 3B model emit a key the
 *    closed schema then rejects — so every one of those names is ABSENT here,
 *    and a test asserts it stays absent.
 *
 * 2. NO JSON TEMPLATE IS PASTED IN. The source prints the whole object shape
 *    into the prompt. We do not, for the same reason `build-prompt.ts` does not:
 *    the machine-readable schema already travels in the provider's
 *    structured-output slot, where it is enforced by constrained decoding, and a
 *    second prose copy is a second thing to keep in step. The FIELD RULES below
 *    name the nine keys in schema order, which is what the template was for.
 *
 * 3. THE AGENCY DISTINCTION IS DELIBERATELY COLLAPSED. The source's CRITICAL
 *    block insists `company` (the end client) and `agency` (the recruiter who
 *    sent the email) are different organisations and must never be copied into
 *    each other. We have no `agency` field, so the rule is INVERTED: an agency
 *    posting records the agency as `company`. That throws away a distinction the
 *    source considered important, and it is safe here for exactly one reason —
 *    THE USER REVIEWS EVERY FIELD BEFORE ANYTHING IS SAVED. The prompt says so
 *    out loud, because a model told "put the agency in `company`" with no
 *    explanation tends to start second-guessing it.
 *
 * 4. THREE SALARY RULES THE SOURCE DOES NOT HAVE. Day rate, hourly rate and pro
 *    rata all resolve to `null` here, with the wording preserved in
 *    `description`. The source annualises the first two (× 230 working days,
 *    × 1840 hours) and has ZERO handling for the third. See `salary-wording.ts`.
 *
 * 5. HYBRID AND REMOTE WORDING IS KEPT VERBATIM IN `location`. The source
 *    reduces "City of London (hybrid, 3 days on site)" to "City of London" and
 *    has no work-mode field anywhere in the pipeline, so the fact is simply
 *    lost. Three days on site is the difference between a job someone can take
 *    and one they cannot.
 *
 * 6. `temperature` is not set here. The source passes 0.1; this package types
 *    it as the literal `0` (see `types.ts`) so "turn the creativity up" is a
 *    compile error. Extraction is transcription, not composition.
 */
import { sanitizeForPrompt, truncateForPrompt } from '@cviper/cv-parsing';

import { JSON_ONLY } from './constants';

/**
 * How much pasted advert reaches the model, in characters.
 *
 * The source truncates a paste at 50,000 characters at the HTTP boundary,
 * because it is talking to a cloud model with a large window. Ours has to fit a
 * 3B local model: the Ollama adapter asks for `num_ctx: 8192`, this prompt's
 * scaffolding is roughly 2,600 characters, and the answer needs about 350
 * tokens. At ~3.7 characters per token, 6,000 characters of advert is ~1,620
 * tokens, leaving comfortable headroom.
 *
 * Bigger than `MAX_JOB_CHARS` (4,000) in `build-prompt.ts` on purpose: that
 * budget shares a window with 6,000 characters of CV and a page of calibration
 * anchors. This prompt has neither, and a pasted advert routinely arrives with
 * an Outlook signature and a quoted thread attached.
 */
export const MAX_ADVERT_CHARS = 6000;

export interface ExtractionPromptInput {
  readonly text: string;
}

export interface ExtractionPrompt {
  readonly system: string;
  readonly user: string;
}

/**
 * The advert as the MODEL sees it: sanitised, then truncated.
 *
 * ============================================================================
 * EXPORTED SO THE CLAMP READS THE SAME TEXT THE MODEL READ.
 * ============================================================================
 * `clampExtraction` decides whether to overrule a salary by reading the advert.
 * If it read the raw paste while the model read a sanitised, truncated one, the
 * two would be arguing about different documents — and the disagreement would
 * show up only on long pastes, which is the worst possible place for it. One
 * function, called by both.
 *
 * Sanitise BEFORE truncating: sanitising removes text, so truncating first
 * would spend budget on content about to be deleted anyway.
 */
export function extractionSourceText(text: string): string {
  return truncateForPrompt(sanitizeForPrompt(text), MAX_ADVERT_CHARS);
}

/**
 * The system message.
 *
 * Ported from `build_email_job_extraction_system` (line 122) with ONE deletion:
 * the source's parenthetical fluency list reads "(day rates, IR35
 * determinations, umbrella/PSC engagement, notice periods)". IR35, umbrella/PSC
 * and notice periods are dropped because we return no field for any of them,
 * and naming a concept with nowhere to put it is how a small model starts
 * inventing keys. Day rates stay — they are precisely the thing this schema has
 * to REFUSE to turn into a number, so the model needs to recognise one.
 *
 * The null-not-guess rationale is ported verbatim, review step included: it is
 * the sentence that makes the instruction make sense rather than sound arbitrary.
 */
const SYSTEM = [
  'You are a meticulous job-advert parser for UK contract and permanent roles,',
  'with particular fluency in London banking and finance conventions, including',
  'day rates and part-time pro rata pay. You extract only what is written. When a',
  'detail is absent you return null rather than guessing — the user reviews every',
  'field before saving, so a missing value costs them a few seconds while an',
  'invented one costs them a bad decision.',
  JSON_ONLY,
].join(' ');

/**
 * The CRITICAL block — the most valuable thing in the source prompt.
 *
 * Bullets 1, 2 and 5 are the source's, reworded only where they named a field
 * we do not have. Bullet 3 REPLACES the source's company-versus-agency rule
 * (see the header, change 3). Bullet 4 is the source's `estimated_salary` rule
 * rewritten for a flat schema with no period field.
 */
const CRITICAL = `CRITICAL — do not guess, do not invent, do not fabricate:
- If a value is not stated in the text, return null. NEVER infer, estimate or invent a title, company, location, date or salary that is not there. An empty field is correct and useful; a plausible-looking wrong field is not.
- If the text is not a job advert at all (a newsletter, a personal message, a shopping list), return null for every field.
- If a recruitment agency posted the role rather than the employer, record the AGENCY in \`company\`. Do not guess who the end client is from a description like "a Tier 1 investment bank" — write that description in \`description\` instead. The person reading your answer will correct the company themselves before anything is saved.
- Only put a YEARLY figure in \`salary_min\` and \`salary_max\`. If the pay is stated any other way, both are null.
- Quote the advert's own words. Do not expand a technology stack into related tools the advert never mentions.
- Ignore quoted history in a forwarded thread if it describes a different role; extract the role the message is actually about.`;

/**
 * The field-by-field rules, in SCHEMA ORDER.
 *
 * The order matters twice over: it is the order the constrained decoder will
 * force anyway (see `JOB_EXTRACTION_JSON_SCHEMA`), and a prompt that lists the
 * fields in a different order from the grammar is a prompt actively fighting
 * the decoder.
 */
const FIELD_RULES = `Field rules, in the order you must answer them:
- title: the job title, word for word. null if the advert gives none.
- company: the organisation hiring. If a recruiter posted it rather than the employer, the recruiter's own firm goes here. null if no organisation is named.
- location: where the role is based, WORD FOR WORD. Keep any hybrid, remote, on-site or days-per-week wording exactly as written — "City of London (hybrid, 3 days on site)" stays whole, and "Fully remote (UK)" stays whole. Do not reduce it to a city. null if the advert does not say.
- url: a link to the advert if one appears in the text. null otherwise.
- description: two to four sentences on the role. If pay is stated as a day rate, an hourly rate, pro rata, or in words rather than numbers, COPY THAT WORDING HERE word for word — it is the only place it survives. null only if there is nothing at all to summarise.
- posted_date: the date the advert was posted, as YYYY-MM-DD. null unless a date is actually stated. Do not use today's date.
- salary_currency: the three-letter code for the money, e.g. GBP, USD, EUR. null whenever salary_min and salary_max are both null.
- salary_min and salary_max: the bottom and top of the YEARLY salary, as plain whole numbers with no symbols, commas or "k".
  * "£45k-£55k" is 45000 and 55000, currency GBP.
  * "£95,000" alone is 95000 for both.
  * A day rate ("£650 per day", "£650/day") is null, null. Do NOT multiply it up to a yearly figure.
  * An hourly rate ("£50 per hour", "£25/hr") is null, null.
  * Pro rata pay ("£45,000 pro rata") is null, null — that is a full-time figure for a part-time job, and the real pay is not stated.
  * Money described only in words — Competitive, Negotiable, DOE, Depending on experience, TBD, Market rate, Not specified — is null, null, and the currency is null too.
  In every one of those null cases, the advert's own wording belongs in description.

${JSON_ONLY}`;

function fence(body: string): string {
  return `=== JOB ADVERT ===\n${extractionSourceText(body)}\n=== END JOB ADVERT ===`;
}

export function buildExtractionPrompt(input: ExtractionPromptInput): ExtractionPrompt {
  const user = [
    'Extract the job details from this advert, email or role spec.',
    JSON_ONLY,
    '',
    fence(input.text),
    '',
    CRITICAL,
    '',
    FIELD_RULES,
  ].join('\n');

  return { system: SYSTEM, user };
}
