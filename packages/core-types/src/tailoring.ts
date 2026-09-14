/**
 * The three shapes the writing loop produces — a tailored CV, a cover letter,
 * and a reviewer's verdict on a draft — plus the pure renderers that turn the
 * first two into text a person can read, paste or save.
 *
 * PORTED FROM: backend/ai/prompts/document_gen.py  (CViper repo, @ dea8c15)
 *   `MANDATORY_STRUCTURE` — the section order `renderTailoredCv` emits.
 *
 * ============================================================================
 * ONE LEVEL DEEPER THAN `analysis.ts`, AND WHY THAT IS ACCEPTED
 * ============================================================================
 * `analysis.ts` is flat with one exception (`suggestions[]` of flat strings),
 * because a 3B quantised model loses the thread inside nested objects. This
 * schema goes ONE level further: `experience[]` is an array of roles, and each
 * role carries a `bullets[]` array. That is not a relaxation of the rule but
 * the minimum the feature needs. A CV genuinely HAS roles, and roles genuinely
 * have bullets — the alternative, a single string of CV text, would give the
 * app nothing it can reason about: no per-role company to check against the
 * original, no per-role dates to check for invented years, no bullets to
 * diff. The fabrication check (`@cviper/ai-providers/fabrication.ts`) and the
 * line diff both read the structure, and a flat string would lose both. So
 * roles nest bullets, and nothing nests any further.
 *
 * TWO REPRESENTATIONS, DELIBERATELY HAND-MAINTAINED — same rule as
 * `analysis.ts`: the Zod schema validates what came back, the JSON Schema is
 * what the provider is asked for, and `tailoring.test.ts` asserts their
 * required-key sets agree at every level.
 */
import { type JsonSchemaNode } from './analysis';
import { z } from './zod';

// --- Types ------------------------------------------------------------------

/** One role in the tailored CV. Four flat strings and a list of bullets. */
export type TailoredCvRole = {
  title: string;
  company: string;
  location: string;
  dates: string;
  bullets: string[];
};

export type TailoredCv = {
  summary: string;
  key_skills: string[];
  experience: TailoredCvRole[];
  education: string[];
  certifications: string[];
};

export type CoverLetter = {
  greeting: string;
  paragraphs: string[];
  sign_off: string;
};

export type DraftReviewVerdict = 'ready' | 'revise';

/** One thing a hiring manager would mark against the draft. */
export type DraftReviewIssue = {
  section: string;
  problem: string;
  suggestion: string;
};

export type DraftReview = {
  verdict: DraftReviewVerdict;
  issues: DraftReviewIssue[];
};

// --- Zod representation -----------------------------------------------------

const roleShape = {
  title: z.string(),
  company: z.string(),
  location: z.string(),
  dates: z.string(),
  bullets: z.array(z.string()),
};

const tailoredCvShape = {
  summary: z.string(),
  key_skills: z.array(z.string()),
  experience: z.array(z.looseObject(roleShape)),
  education: z.array(z.string()),
  certifications: z.array(z.string()),
};

const coverLetterShape = {
  greeting: z.string(),
  paragraphs: z.array(z.string()),
  sign_off: z.string(),
};

const reviewIssueShape = {
  section: z.string(),
  problem: z.string(),
  suggestion: z.string(),
};

const draftReviewShape = {
  verdict: z.enum(['ready', 'revise']),
  issues: z.array(z.looseObject(reviewIssueShape)),
};

/**
 * Loose, like `CvAnalysisSchema`, and for the same reason: the JSON Schema
 * closes what we ASK for, the Zod schema proves what CAME BACK has the
 * required fields, and never deletes a field a bigger model added.
 */
export const TailoredCvRoleSchema = z.looseObject(roleShape);
export const TailoredCvSchema = z.looseObject(tailoredCvShape);
export const CoverLetterSchema = z.looseObject(coverLetterShape);
export const DraftReviewIssueSchema = z.looseObject(reviewIssueShape);
export const DraftReviewSchema = z.looseObject(draftReviewShape);

/** Fails to compile if a Zod schema and its hand-written type drift apart. */
type AssertAssignable<TActual extends TExpected, TExpected> = TActual;

export type _TailoredCvSchemaMatchesType = AssertAssignable<
  z.infer<typeof TailoredCvSchema>,
  TailoredCv
>;
export type _TailoredCvTypeMatchesSchema = AssertAssignable<
  TailoredCv,
  z.infer<typeof TailoredCvSchema>
>;
export type _CoverLetterSchemaMatchesType = AssertAssignable<
  z.infer<typeof CoverLetterSchema>,
  CoverLetter
>;
export type _CoverLetterTypeMatchesSchema = AssertAssignable<
  CoverLetter,
  z.infer<typeof CoverLetterSchema>
>;
export type _DraftReviewSchemaMatchesType = AssertAssignable<
  z.infer<typeof DraftReviewSchema>,
  DraftReview
>;
export type _DraftReviewTypeMatchesSchema = AssertAssignable<
  DraftReview,
  z.infer<typeof DraftReviewSchema>
>;

// --- Hand-written JSON Schema representation --------------------------------

/**
 * Sent verbatim to the provider's structured-output slot.
 *
 * HAND-TUNED for a small model: every description is a short imperative that
 * repeats the one rule that matters — take it from the CV, invent nothing.
 * Every object is closed with `additionalProperties: false`. Property order is
 * the reading order of a CV, which is also the order a person rewrites one in.
 */
export const TAILORED_CV_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'key_skills', 'experience', 'education', 'certifications'],
  properties: {
    summary: {
      type: 'string',
      description: 'Three or four sentences aimed at this job. Facts from the CV only.',
    },
    key_skills: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ten to fifteen skills the CV already shows. Do not add skills from the advert.',
    },
    experience: {
      type: 'array',
      description: 'Every role in the CV, newest first. Do not drop or merge a role.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'company', 'location', 'dates', 'bullets'],
        properties: {
          title: { type: 'string', description: 'The job title exactly as the CV gives it.' },
          company: { type: 'string', description: 'The employer exactly as the CV gives it.' },
          location: {
            type: 'string',
            description: 'Where the role was, as the CV gives it. Empty string if not given.',
          },
          dates: {
            type: 'string',
            description: 'The dates exactly as the CV gives them, e.g. Jan 2020 – Present.',
          },
          bullets: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Achievements from the CV, reworded for this job. Numbers from the CV only.',
          },
        },
      },
    },
    education: {
      type: 'array',
      items: { type: 'string' },
      description: 'One line per qualification, from the CV only.',
    },
    certifications: {
      type: 'array',
      items: { type: 'string' },
      description: 'One line per certification the CV lists. Empty if the CV has none.',
    },
  },
} as const satisfies JsonSchemaNode;

export const COVER_LETTER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['greeting', 'paragraphs', 'sign_off'],
  properties: {
    greeting: {
      type: 'string',
      description: 'The opening line, e.g. Dear Hiring Manager.',
    },
    paragraphs: {
      type: 'array',
      items: { type: 'string' },
      description: 'Three or four paragraphs. Facts and figures from the CV only.',
    },
    sign_off: {
      type: 'string',
      description: 'The closing line, e.g. Yours sincerely.',
    },
  },
} as const satisfies JsonSchemaNode;

export const DRAFT_REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['issues', 'verdict'],
  properties: {
    issues: {
      type: 'array',
      description: 'What a hiring manager would mark against the draft. Empty if nothing.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'problem', 'suggestion'],
        properties: {
          section: { type: 'string', description: 'Which part of the draft.' },
          problem: { type: 'string', description: 'What is wrong there.' },
          suggestion: { type: 'string', description: 'What to change. Do not rewrite it.' },
        },
      },
    },
    verdict: {
      type: 'string',
      enum: ['ready', 'revise'],
      description: 'ready if there is nothing serious to fix, otherwise revise.',
    },
  },
} as const satisfies JsonSchemaNode;

// --- Renderers --------------------------------------------------------------

/** The blank line between sections and between roles. */
const GAP = '';

/** `Company | Location | Dates`, with any empty part left out rather than left as a bare bar. */
function roleLine(role: TailoredCvRole): string {
  return [role.company, role.location, role.dates]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' | ');
}

/**
 * The tailored CV as plain text, in `MANDATORY_STRUCTURE`'s order: the name
 * line when one is given, PROFESSIONAL SUMMARY, KEY SKILLS, PROFESSIONAL
 * EXPERIENCE (`Title` / `Company | Location | Dates` / `- bullet`), EDUCATION,
 * CERTIFICATIONS. An empty section is omitted rather than rendered as a bare
 * heading — a heading with nothing under it reads as "the model forgot", and
 * for CERTIFICATIONS the source structure says so explicitly.
 *
 * `name` is `null` when the app does not know it. Nothing here guesses one:
 * the model is never asked for the candidate's name, because a name is the
 * easiest thing in a CV to get subtly wrong and the hardest to check.
 */
export function renderTailoredCv(cv: TailoredCv, name: string | null): string {
  const lines: string[] = [];

  const trimmedName = name?.trim() ?? '';
  if (trimmedName !== '') {
    lines.push(trimmedName, GAP);
  }

  lines.push('PROFESSIONAL SUMMARY', cv.summary.trim(), GAP);

  if (cv.key_skills.length > 0) {
    lines.push('KEY SKILLS', cv.key_skills.join(', '), GAP);
  }

  if (cv.experience.length > 0) {
    lines.push('PROFESSIONAL EXPERIENCE');
    for (const role of cv.experience) {
      lines.push(GAP, role.title.trim());
      const header = roleLine(role);
      if (header !== '') lines.push(header);
      for (const bullet of role.bullets) {
        lines.push(`- ${bullet.trim()}`);
      }
    }
    lines.push(GAP);
  }

  if (cv.education.length > 0) {
    lines.push('EDUCATION', ...cv.education.map((entry) => entry.trim()), GAP);
  }

  if (cv.certifications.length > 0) {
    lines.push('CERTIFICATIONS', ...cv.certifications.map((entry) => entry.trim()), GAP);
  }

  // One trailing newline, never two: the last GAP becomes the file's final
  // line break.
  return lines.join('\n').replace(/\n+$/, '\n');
}

/** The cover letter as plain text: greeting, paragraphs, sign-off, one blank line apart. */
export function renderCoverLetter(letter: CoverLetter): string {
  const blocks = [letter.greeting, ...letter.paragraphs, letter.sign_off]
    .map((block) => block.trim())
    .filter((block) => block !== '');
  return `${blocks.join('\n\n')}\n`;
}

/** Words, as a person would count them: runs of non-whitespace. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length;
}
