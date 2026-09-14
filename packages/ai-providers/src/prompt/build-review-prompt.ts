/**
 * The review prompt — a hiring manager reads the draft and lists what is
 * wrong with it. The reviewer NEVER rewrites.
 *
 * Not a port. CViper's writing loop has an ATS refinement pass
 * (`build_ats_refinement_prompt` in `document_gen.py`) that rewrites the CV in
 * place; this app deliberately does not, because a rewrite that runs after the
 * fabrication check has already passed is a rewrite the check never saw. So
 * the second model call is a CRITIC, not an editor: it returns a verdict and a
 * list of issues, the user reads them, and the draft on screen is the one the
 * check ran on. What the reviewer looks for — targeting, missed keywords,
 * generic language, unsupported claims — is the same four things the ATS
 * pass tried to fix.
 *
 * `NO_FABRICATION` is in the system message even though this call writes
 * nothing, because the fourth thing it checks for IS fabrication: the reviewer
 * has to know that a claim in the draft with no support in the CV is an issue,
 * not an embellishment to admire.
 */
import { sanitizeForPrompt, truncateForPrompt } from '@cviper/cv-parsing';

import { MAX_CV_CHARS, MAX_JOB_CHARS } from './build-prompt';
import { JSON_ONLY, NO_FABRICATION, UNTRUSTED_CONTENT_BOUNDARY } from './constants';

/** The draft is the thing under review, so it gets the CV's full budget. */
export const MAX_DRAFT_CHARS = MAX_CV_CHARS;

export type ReviewKind = 'cv' | 'cover_letter';

export interface ReviewPromptInput {
  /** The rendered draft — a tailored CV or a cover letter — as the user sees it. */
  readonly draftText: string;
  readonly jobText: string;
  /** The ORIGINAL CV: the only thing a claim in the draft may rest on. */
  readonly cvText: string;
  readonly kind: ReviewKind;
}

export interface ReviewPrompt {
  readonly system: string;
  readonly user: string;
}

const SYSTEM = [
  'You are a hiring manager reading an application for a role you are filling.',
  'You are critical, specific and fair. You NEVER rewrite the draft — you only',
  'list what is wrong with it and what would fix it, so the candidate can make',
  'the change themselves.',
  UNTRUSTED_CONTENT_BOUNDARY,
  NO_FABRICATION,
  JSON_ONLY,
].join(' ');

function whatToLookFor(kind: ReviewKind): string {
  const noun = kind === 'cv' ? 'CV' : 'cover letter';
  return `Read the ${noun} the way you would in the first thirty seconds of screening. Look for exactly four kinds of problem:
1. TARGETING — does the ${noun} speak to THIS advert, or would it do for any role? Name the parts that are not aimed at this job.
2. MISSED KEYWORDS — exact terms the advert uses for things the ORIGINAL CV shows the candidate can do, that the ${noun} does not use. Only terms the original CV supports: a keyword the candidate cannot back is not a miss.
3. GENERIC LANGUAGE — clichés, filler, subjective self-praise with no evidence ("highly motivated", "excellent communicator"), weak verbs.
4. UNSUPPORTED CLAIMS — any company, role, date, achievement, number, skill or certification in the ${noun} that the ORIGINAL CV does not contain. This is the most serious kind. Quote the claim.

Do NOT rewrite anything. Do NOT praise. If there is genuinely nothing serious, say so with an empty issues list and the verdict "ready".`;
}

const FIELD_RULES = `Field rules, in the order you must answer them:
- issues: one entry per problem, most serious first. section names the part of the draft (e.g. Summary, Key skills, the role at a named company, Paragraph 2). problem says what is wrong in one or two sentences. suggestion says what to change — an instruction to the candidate, never the rewritten text.
- verdict: "revise" if any issue is an unsupported claim or the targeting is weak; "ready" otherwise.

${JSON_ONLY}`;

function fence(label: string, body: string, maxChars: number): string {
  const cleaned = truncateForPrompt(sanitizeForPrompt(body), maxChars);
  return `=== ${label} ===\n${cleaned}\n=== END ${label} ===`;
}

export function buildReviewPrompt(input: ReviewPromptInput): ReviewPrompt {
  const draftLabel =
    input.kind === 'cv' ? 'DRAFT CV (under review)' : 'DRAFT COVER LETTER (under review)';

  const user = [
    'Review this draft against the advert and the original CV.',
    JSON_ONLY,
    '',
    fence(draftLabel, input.draftText, MAX_DRAFT_CHARS),
    '',
    fence('JOB ADVERT', input.jobText, MAX_JOB_CHARS),
    '',
    fence('ORIGINAL CV (the only source a claim may rest on)', input.cvText, MAX_CV_CHARS),
    '',
    whatToLookFor(input.kind),
    '',
    FIELD_RULES,
  ].join('\n');

  return { system: SYSTEM, user };
}
