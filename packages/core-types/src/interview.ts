/**
 * The interview prep pack — ONE flat object, four fields, one level of nesting.
 *
 * PORTED FROM: backend/ai/prompts/career_insights.py  (CViper repo, @ dea8c15)
 *   the JSON shape `build_interview_prep_prompt` asks for — six fields.
 *
 * Upstream drift is pinned in CViper's `docs/port-parity-manifest.yaml`; its
 * guard fails there when this source changes. Symbols are named rather than
 * line numbers, which decay on the next edit upstream.
 *
 * ============================================================================
 * FOUR FIELDS, NOT SIX. WHAT WAS DROPPED, AND WHY.
 * ============================================================================
 * The source asks a large cloud model for `likely_questions`,
 * `technical_questions`, `talking_points`, `company_research`,
 * `questions_to_ask` and `red_flag_questions`. Ours has to be produced by a
 * 3-billion-parameter quantised model running locally, with nothing but the
 * archived application and the profile to read from:
 *
 *   - `company_research` is DELETED. The source's paragraph is "what the
 *     candidate should know about the company" — offline, with no web access,
 *     the only company knowledge in reach is whatever the advert says, and a
 *     model asked for research it cannot do writes confident fiction.
 *   - `red_flag_questions` is DELETED. The source derives it from a separate
 *     "potential concerns" analysis (`flags_str`) this app never runs; with no
 *     flags to investigate, the field is a prompt to invent concerns.
 *   - `technical_questions` is DELETED, and its useful half folded into
 *     `likely_questions`: a second question list with a differently-shaped
 *     item (`key_points` instead of `suggested_answer`) is exactly the schema
 *     breadth a small model loses the thread on.
 *   - `gaps_to_bridge` is ADDED. It is the honest counterpart to the bridge
 *     rule in the prompt: where the advert asks for something the candidate's
 *     material does not show, the pack NAMES it rather than papering over it.
 *
 * Same discipline as the other ports: TAKE THE PROMPT WISDOM, KEEP A SHAPE A
 * SMALL MODEL CAN HOLD. Every field is an array; the one nested object is the
 * two-string likely-question item, and `interview.test.ts` asserts nothing
 * deeper exists.
 *
 * TWO REPRESENTATIONS, DELIBERATELY HAND-MAINTAINED — the same arrangement as
 * `analysis.ts`, for the same reason:
 *   1. `InterviewPackSchema`        — Zod. Validates what a provider sent.
 *   2. `INTERVIEW_PACK_JSON_SCHEMA` — JSON Schema. Goes in Ollama's `format`
 *      and the cloud providers' structured-output slots.
 * They are NOT generated from each other, because the JSON Schema's
 * descriptions are hand-tuned instructions to a small model and that tuning
 * must not leak into runtime validation. The guard against drift is a test
 * asserting the two agree on their required-key sets. Change one, change the
 * other, in the same commit.
 */
import { z } from './zod';

import { type JsonSchemaNode } from './analysis';

/** One question the interviewer is likely to ask, with an answer to rehearse. */
export type LikelyQuestion = {
  question: string;
  suggested_answer: string;
};

export type InterviewPack = {
  likely_questions: LikelyQuestion[];
  talking_points: string[];
  questions_to_ask: string[];
  /** Named honestly, never hidden: what the advert wants that the material does not show. */
  gaps_to_bridge: string[];
};

// --- Zod representation -----------------------------------------------------

const likelyQuestionShape = {
  question: z.string(),
  suggested_answer: z.string(),
};

/**
 * LOOSE, while the JSON Schema below is closed. Not a contradiction — the same
 * split `analysis.ts` documents at length: the JSON Schema constrains what we
 * ASK for (closing it is mandatory; Anthropic rejects an open schema), and Zod
 * validates what came BACK without deleting fields it does not recognise.
 */
export const LikelyQuestionSchema = z.looseObject(likelyQuestionShape);

const interviewPackShape = {
  likely_questions: z.array(LikelyQuestionSchema),
  talking_points: z.array(z.string()),
  questions_to_ask: z.array(z.string()),
  gaps_to_bridge: z.array(z.string()),
};

export const InterviewPackSchema = z.looseObject(interviewPackShape);

/** Fails to compile if the Zod schema and the hand-written type drift apart. */
type AssertAssignable<TActual extends TExpected, TExpected> = TActual;

export type _InterviewPackSchemaMatchesType = AssertAssignable<
  z.infer<typeof InterviewPackSchema>,
  InterviewPack
>;
export type _InterviewPackTypeMatchesSchema = AssertAssignable<
  InterviewPack,
  z.infer<typeof InterviewPackSchema>
>;

// --- Hand-written JSON Schema representation --------------------------------

/**
 * Sent verbatim to Ollama's `format` and the cloud providers' structured-output
 * fields.
 *
 * HAND-TUNED. Descriptions are short imperatives because a 3B model treats them
 * as instructions rather than documentation. The counts (6-8, 4-6, 4-6) are
 * in the descriptions rather than as `minItems`/`maxItems`, because a hard
 * bound turns a model that ran out of things to say into a schema failure and
 * a spent repair turn, when a shorter list was the honest answer.
 *
 * The property order is the REASONING order, for the same constrained-decoding
 * reason `job-extraction.ts` records: the questions come first, because
 * writing them is what surfaces the gaps; the gaps come last, once the model
 * has already had to bridge them in the answers above.
 */
export const INTERVIEW_PACK_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['likely_questions', 'talking_points', 'questions_to_ask', 'gaps_to_bridge'],
  properties: {
    likely_questions: {
      type: 'array',
      description:
        '6 to 8 questions this interviewer is likely to ask for this advert. Each ' +
        'suggested_answer is shaped Situation, Task, Action, Result and is drawn from the ' +
        "candidate's own worked examples and CV. Where the material shows no matching " +
        'experience, the answer names that gap honestly and connects the nearest real ' +
        'experience. Never invent experience.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'suggested_answer'],
        properties: {
          question: {
            type: 'string',
            description: 'The question, as an interviewer would ask it.',
          },
          suggested_answer: {
            type: 'string',
            description:
              'A short STAR-shaped answer using only what the candidate actually did. ' +
              'Four to six sentences.',
          },
        },
      },
    },
    talking_points: {
      type: 'array',
      description:
        '4 to 6 points the candidate should raise themselves — their strongest real ' +
        'evidence for this advert, each one sentence.',
      items: { type: 'string' },
    },
    questions_to_ask: {
      type: 'array',
      description:
        '4 to 6 questions for the candidate to ask the interviewer, each specific to ' +
        'something in THIS advert — a named responsibility, tool, team or phrase. Nothing ' +
        'generic.',
      items: { type: 'string' },
    },
    gaps_to_bridge: {
      type: 'array',
      description:
        "Things the advert asks for that the candidate's material does not show. Short " +
        'phrases, one gap each. An empty list means there are none.',
      items: { type: 'string' },
    },
  },
} as const satisfies JsonSchemaNode;

// --- Plain-text rendering ---------------------------------------------------

/** A heading in the saved text: shouted, so it survives any font. */
function heading(title: string): string {
  return title.toUpperCase();
}

/** A bulleted list, or the word that says the list is empty on purpose. */
function bullets(items: readonly string[]): string {
  return items.length === 0 ? 'None.' : items.map((item) => `- ${item}`).join('\n');
}

/**
 * The pack as the text of a saved `interview_pack` document.
 *
 * Plain text, not Markdown or JSON: a document archived against an application
 * is something the user reads back before the interview, possibly by pasting
 * it into a note on their phone. Numbered questions with the answer indented
 * beneath each, bulleted lists for the rest, and every section present even
 * when empty — a missing heading reads as "the model forgot", while "None."
 * reads as the answer it is.
 */
export function renderInterviewPack(pack: InterviewPack): string {
  const questions =
    pack.likely_questions.length === 0
      ? 'None.'
      : pack.likely_questions
          .map((item, index) => `${index + 1}. ${item.question}\n   ${item.suggested_answer}`)
          .join('\n\n');

  return [
    heading('Likely questions'),
    '',
    questions,
    '',
    heading('Talking points'),
    '',
    bullets(pack.talking_points),
    '',
    heading('Questions to ask'),
    '',
    bullets(pack.questions_to_ask),
    '',
    heading('Gaps to bridge'),
    '',
    bullets(pack.gaps_to_bridge),
    '',
  ].join('\n');
}
