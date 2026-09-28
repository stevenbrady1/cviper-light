/**
 * The pasted-advert extraction prompt — ONE call, ONE flat object, eleven fields.
 *
 * PORTED FROM: backend/ai/prompts/search_helpers.py  (CViper repo, @ e8a5e8b0)
 *   `build_email_job_extraction_prompt`
 *   `build_email_job_extraction_system`
 *   and the comment block above them, which is the reason the source prompt is
 *   worth porting at all rather than writing fresh.
 *
 * Upstream drift is pinned in CViper's `docs/port-parity-manifest.yaml`; its
 * guard fails there when this source changes. Symbols are named rather than
 * line numbers, which decay on the next edit upstream.
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
 * 1. ELEVEN FIELDS, NOT SEVENTEEN. The source's JSON template lists
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
 * 3. `company` and `agency` stay separate when both are named. If the client is
 *    not named, the agency remains `company` for backward compatibility.
 *    The review form shows both values before anything is saved.
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

import { JSON_ONLY, UNTRUSTED_CONTENT_BOUNDARY } from './constants';

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
 *
 * The trust boundary (L-153) follows: a pasted advert or a forwarded recruiter
 * email is exactly the text an attacker gets to write, and the system message
 * has to say out loud that it is material, not instructions. The source puts
 * the same clause in the user turn ahead of the fence; here it lives in the
 * system message with the other standing rules. Every system message in this
 * package carries it — see `untrusted-boundary.contract.test.ts`.
 */
const SYSTEM = [
  'You are a meticulous job-advert parser for UK contract and permanent roles,',
  'with particular fluency in London banking and finance conventions, including',
  'day rates and part-time pro rata pay. You extract only what is written. When a',
  'detail is absent you return null rather than guessing — the user reviews every',
  'field before saving, so a missing value costs them a few seconds while an',
  'invented one costs them a bad decision.',
  UNTRUSTED_CONTENT_BOUNDARY,
  JSON_ONLY,
].join(' ');

/**
 * The CRITICAL block — the most valuable thing in the source prompt.
 *
 * Bullets 1, 2 and 5 are the source's, reworded only where they named a field
 * we do not have. Bullet 3 preserves the company-versus-agency distinction.
 * Bullet 4 uses the existing job-model periods;
 * pro-rata and unsupported units remain unrepresented.
 */
const CRITICAL = `CRITICAL — do not guess, do not invent, do not fabricate:
- If a value is not stated in the text, return null. NEVER infer, estimate or invent a title, company, location, date or salary that is not there. An empty field is correct and useful; a plausible-looking wrong field is not.
- If the text is not a job advert at all (a newsletter, a personal message, a shopping list), return null for every field.
- If a recruitment agency posted the role and the advert names the client, put the client in \`company\` and the recruiting firm in \`agency\`. If no client is named, put the recruiting firm in BOTH \`company\` and \`agency\` so older records keep their meaning. Never infer a client from wording like "a Tier 1 investment bank"; keep that wording in \`description\`. For a direct employer, put the employer in \`company\` and return null for \`agency\`.
- Put the amount as stated in \`salary_min\` and \`salary_max\`, and name its supported unit in \`salary_period\`. Never convert or annualise an amount.
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
- company: the named hiring client. If no client is named and an agency posted the role, use that agency name for compatibility. For a direct employer, use the employer name. null if no organisation is named.
- agency: the recruitment agency that posted or sent the role. Keep it separate from a named client. null for a direct employer or when no agency is named.
- location: where the role is based, WORD FOR WORD. Keep any hybrid, remote, on-site or days-per-week wording exactly as written — "City of London (hybrid, 3 days on site)" stays whole, and "Fully remote (UK)" stays whole. Do not reduce it to a city. null if the advert does not say.
- url: a link to the advert if one appears in the text. null otherwise.
- description: two to four sentences on the role. If pay is stated as a day rate, an hourly rate, pro rata, or in words rather than numbers, COPY THAT WORDING HERE word for word — it is the only place it survives. null only if there is nothing at all to summarise.
- posted_date: the date the advert was posted, as YYYY-MM-DD. null unless a date is actually stated. Do not use today's date.
- salary_period: the unit of the amount: year, day, or hour. Use year for yearly pay, day for a day rate, and hour for hourly pay. null for pro rata, unsupported units, or no stated figure.
- salary_currency: the three-letter code for the money, e.g. GBP, USD, EUR. null whenever salary_min and salary_max are both null.
- salary_min and salary_max: the bottom and top amounts for the stated period, as plain whole numbers with no symbols, commas or "k".
  * "£45k-£55k" is 45000 and 55000, currency GBP, period year.
  * "£95,000" alone is 95000 for both, period year.
  * A day rate ("£650 per day", "£650/day") is 650 for both, period day. Do NOT multiply it up to a yearly figure.
  * An hourly rate ("£50 per hour", "£25/hr") is 50 for both, period hour.
  * Pro rata pay ("£45,000 pro rata") is null for both amounts and period — the real pay is not stated.
  * Unsupported units such as weekly pay are null for both amounts and period.
  * Money described only in words — Competitive, Negotiable, DOE, Depending on experience, TBD, Market rate, Not specified — is null, null, and the currency is null too.
  In every null case, the advert's own wording belongs in description.

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
