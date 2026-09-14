/**
 * The tailoring prompt — ONE call, ONE object: the candidate's own CV rewritten
 * for one advert, and nothing in it that was not in the CV.
 *
 * PORTED FROM: backend/ai/prompts/document_gen.py  (CViper repo, @ dea8c15)
 *   `build_tailored_cv_prompt`
 *   `build_tailored_cv_system`
 *   `MANDATORY_STRUCTURE`
 *   `SENIORITY_INSTRUCTIONS`
 * PORTED FROM: backend/ai/prompts/constants.py  (CViper repo, @ dea8c15)
 *   `NO_FABRICATION`  (lives in `constants.ts`)
 *
 * Upstream drift is pinned in CViper's `docs/port-parity-manifest.yaml`; its
 * guard fails there when this source changes. Symbols are named rather than
 * line numbers, which decay on the next edit upstream.
 *
 * ============================================================================
 * WHAT CHANGED, AND WHY — read this before "restoring" anything.
 * ============================================================================
 * 1. STRUCTURED OUTPUT, NOT A TEXT BLOCK. The source asks for the CV as plain
 *    text laid out to `MANDATORY_STRUCTURE`, and the app then runs a
 *    fabrication heuristic over that text. Here the structure IS the schema
 *    (`TAILORED_CV_JSON_SCHEMA`): the section order is enforced by the
 *    decoder, `renderTailoredCv` prints it in the source's order, and — the
 *    reason it is worth the one extra level of nesting — every employer, date
 *    and certification arrives as its own field, so `fabrication.ts` can
 *    check each one against the original instead of guessing from prose.
 *    The prose of `MANDATORY_STRUCTURE` survives as the FIELD RULES below:
 *    what the summary's four sentences do, how skills are chosen, what a
 *    role must show.
 *
 * 2. NO SENIORITY INPUT. The source keys `SENIORITY_INSTRUCTIONS` on a
 *    seniority the caller worked out beforehand. This app has no such field,
 *    so the five adaptations are condensed into ONE ladder the model reads
 *    against the advert itself — the same verbs and emphases, chosen by the
 *    model from the role rather than by a lookup we cannot do.
 *
 * 3. NO VERIFIED-SKILLS BLOCK, NO ROLE COUNT, NO REGIONAL BLOCK. Each of
 *    those is computed server-side in the source from data this app does not
 *    hold (a parsed skills list, a role count, a region). The rules that
 *    depended on them are reworded to point at the CV text directly: skills
 *    the CV shows, every role the CV lists.
 *
 * 4. THE TARGET COMPANY IS NOT INTERPOLATED. The source writes the advert's
 *    company into the constraint ("The target job company (X) is where the
 *    candidate is APPLYING"). We do not know it as a field here — the advert
 *    is fenced text — so the rule is stated once, generically, and the
 *    fabrication check enforces it afterwards on every `company` field.
 *
 * 5. `temperature` is not set here; this package types it as the literal `0`.
 */
import { sanitizeForPrompt, truncateForPrompt } from '@cviper/cv-parsing';

import { MAX_CV_CHARS, MAX_JOB_CHARS } from './build-prompt';
import {
  FAIRNESS_GUARDRAIL,
  JSON_ONLY,
  NO_FABRICATION,
  UNTRUSTED_CONTENT_BOUNDARY,
} from './constants';

/**
 * How much of the candidate's own notes reaches the model.
 *
 * Small on purpose: the notes are a few lines on how the user writes and what
 * they want emphasised, not a third document. Anything longer is somebody
 * pasting a second CV into the wrong box.
 */
export const MAX_PROFILE_NOTES_CHARS = 1500;

export interface TailorPromptInput {
  readonly cvText: string;
  readonly jobText: string;
  /**
   * The candidate's own words about how they write and what to emphasise —
   * `Profile.writing_style` and the like. `null` when the profile is empty.
   */
  readonly profileNotes: string | null;
}

export interface TailorPrompt {
  readonly system: string;
  readonly user: string;
}

/**
 * The system message: `build_tailored_cv_system`, with the four standing
 * clauses after the role sentence.
 *
 * Order matters to a small model: the role, then the boundary (the fenced
 * text is material), then the one rule this whole feature turns on
 * (`NO_FABRICATION`), then fairness, then the output format last.
 */
const SYSTEM = [
  'You are a CV reformatting engine. You rewrite an existing CV for a specific',
  'job application using ONLY content from the base CV. You never fabricate',
  'companies, roles, dates, or achievements. Every role from the base CV appears',
  'in the output.',
  UNTRUSTED_CONTENT_BOUNDARY,
  NO_FABRICATION,
  FAIRNESS_GUARDRAIL,
  JSON_ONLY,
].join(' ');

/** The source's CRITICAL CONSTRAINT, first, before the model reads a word of the CV. */
const CRITICAL = `You are reformatting an EXISTING CV for a specific job. You must ONLY use content from the base CV below. This is a REWRITE task, not a creative writing task.

CRITICAL CONSTRAINT — READ THIS FIRST:
- You are NOT writing a new CV. You are REFORMATTING the candidate's existing CV.
- Every company name, job title, date, qualification, and achievement MUST come from the base CV below.
- If you output a company name that does not appear in the base CV, your output is WRONG.
- The company in the job advert is where the candidate is APPLYING — it must NOT appear as a past employer unless it genuinely appears in the base CV.`;

/**
 * `SENIORITY_INSTRUCTIONS`, condensed into one ladder (see the header, change
 * 2). Every verb list and every emphasis is the source's; only the lookup is
 * gone.
 */
const SENIORITY_LADDER = `SENIORITY ADAPTATION — judge the level the advert is pitched at, then match it:
- Junior or entry level: emphasise hands-on delivery, learning velocity and tools mastered; verbs like Built, Implemented, Developed, Tested, Shipped, Deployed, Configured; say WHAT was built and WITH WHAT.
- Mid level: balance delivery with growing ownership; end-to-end delivery, problem-solving, collaboration; verbs like Built, Implemented, Optimised, Delivered, Designed, Shipped, Improved.
- Senior: ownership, mentoring and architectural decisions; cross-team impact; verbs like Architected, Designed, Optimised, Mentored, Drove, Delivered, Championed.
- Lead or principal: strategy, stakeholder management and organisational impact; team building, hiring, process, vision; verbs like Led, Shaped, Influenced, Governed, Established, Spearheaded, Transformed.
- Director and above: commercial impact, budget ownership, board-level reporting, transformation; verbs like Drove, Transformed, Governed, Established, Championed, Directed, Negotiated.
Only the emphasis and the verbs change with the level. The facts do not.`;

/**
 * The source's numbered RULES, with three edits: rule 5's role count is
 * stated against the CV rather than a supplied number; rule 9's "verified
 * skills list" is the CV itself; the FORMATTING rules that describe a text
 * layout (single column, bullet glyphs, section headers) are gone because
 * the renderer decides those now.
 */
const RULES = `RULES — EVERY RULE IS MANDATORY:

SOURCE INTEGRITY (non-negotiable):
1. ALL content must come from the base CV above. Do NOT invent jobs, companies, dates, skills, certifications, achievements, metrics, or personal details.
2. Keep all factual details (dates, company names, qualifications, job titles) exactly as they appear in the base CV.
3. Do NOT inject skills or technologies from the job advert that are absent from the candidate's CV — even if listed as "essential" or "desirable".
4. If the candidate does not have a qualification or certification, do NOT add one. If the base CV has no certifications, return an empty certifications list.
5. EVERY SINGLE ROLE from the base CV MUST appear in the output. Count the roles in the base CV and return the same count. Do NOT remove, merge, combine, or skip any employer — even very old or seemingly irrelevant ones. Shortening a role to one bullet is acceptable; removing it entirely is NOT.

TAILORING (what you CAN change):
6. Reorder bullets within a role to put job-relevant achievements first. For each bullet you keep, apply the "SO WHAT?" test: does it demonstrate a capability the advert explicitly asks for? If not, condense it or move it below more relevant bullets.
7. Rephrase bullets using stronger action verbs and the CAR pattern (Action → Result, with the CV's own metrics).
8. Write the summary as a TARGETED VALUE PROPOSITION for this specific role. Scan ALL roles in the base CV — not just the most recent — for the achievement most relevant to the target job, and surface it in the summary even if it comes from an older role.
9. Select 10-15 skills ONLY from what the base CV shows. Order them to mirror the advert's own priorities. No invented tools or technologies.
10. For older or less relevant roles: reduce to 1-2 bullets. NEVER delete a role entirely.

TERMINOLOGY ALIGNMENT:
11. Where the candidate has equivalent experience described in different words from the advert, use the advert's exact phrasing. If the CV says "automated deployment" and the advert says "CI/CD pipeline", write "CI/CD pipeline". If the CV says "Agile" and the advert says "Scrum", write "Scrum". This applies to skills, methodologies and domain terms, and only where the experience is genuinely equivalent.

QUANTIFICATION COACHING:
12. If the base CV lacks quantified achievements, reframe bullets using SCOPE INDICATORS instead of inventing metrics: team size, project duration, technology scale, frequency, or coverage — and only where the base CV supports the indicator. Never introduce a number, percentage or currency value that is not in the base CV.

TONE:
13. Professional, concise, factual. No first person ("I", "my"). No storytelling.
14. No subjective claims ("excellent communicator", "highly skilled") unless present verbatim in the base CV.
15. Every bullet starts with a strong action verb.`;

/**
 * `MANDATORY_STRUCTURE`'s prose, as field rules in SCHEMA ORDER — the order
 * the constrained decoder walks, so the prompt and the grammar agree.
 */
const FIELD_RULES = `Field rules, in the order you must answer them:
- summary: 3-4 sentences as a VALUE PROPOSITION for THIS role, not a biography. Sentence 1: the candidate's strongest alignment to the role's primary requirement. Sentence 2: the single most impressive QUANTIFIED achievement relevant to this role, from any role in the CV. Sentence 3: a differentiator competing candidates are unlikely to have. Sentence 4: a forward-looking line connecting the candidate's trajectory to this role. All of it from the base CV.
- key_skills: 10-15 skills the base CV shows, most relevant to the advert first. No skills from the advert that the candidate does not have.
- experience: EVERY role from the base CV, newest first. Each has title, company, location and dates copied exactly from the base CV (location may be an empty string if the CV gives none), and bullets — achievements reworded for this job, each starting with an action verb, with numbers only where the base CV has them.
- education: one line per qualification, from the base CV only. No invented qualifications.
- certifications: one line per certification the base CV lists. An empty list if it lists none. No invented certifications.

${JSON_ONLY}`;

function fence(label: string, body: string, maxChars: number): string {
  // Sanitise BEFORE truncating, as `build-prompt.ts` does: sanitising removes
  // text, so truncating first would spend budget on content about to go.
  const cleaned = truncateForPrompt(sanitizeForPrompt(body), maxChars);
  return `=== ${label} ===\n${cleaned}\n=== END ${label} ===`;
}

/**
 * The candidate's notes, fenced like everything else the user typed — they
 * are the user's own words, but the fence and the sanitiser cost nothing and
 * a note that closed our section by accident would be a confusing failure.
 * `null` when there is nothing to say.
 */
function notesFence(notes: string | null): string | null {
  const cleaned = truncateForPrompt(sanitizeForPrompt(notes ?? ''), MAX_PROFILE_NOTES_CHARS);
  if (cleaned.trim() === '') return null;
  return `=== CANDIDATE NOTES (how they write, what to emphasise) ===\n${cleaned}\n=== END CANDIDATE NOTES ===`;
}

export function buildTailorPrompt(input: TailorPromptInput): TailorPrompt {
  const notes = notesFence(input.profileNotes);

  const user = [
    CRITICAL,
    '',
    fence('BASE CV (the ONLY source of truth)', input.cvText, MAX_CV_CHARS),
    '',
    fence(
      'JOB ADVERT (tailor for this role — do NOT invent experience to match it)',
      input.jobText,
      MAX_JOB_CHARS,
    ),
    ...(notes === null ? [] : ['', notes]),
    '',
    SENIORITY_LADDER,
    '',
    RULES,
    '',
    FAIRNESS_GUARDRAIL,
    '',
    FIELD_RULES,
  ].join('\n');

  return { system: SYSTEM, user };
}
