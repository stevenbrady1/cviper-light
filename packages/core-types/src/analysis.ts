/**
 * The CV-vs-job analysis result — the FLAT schema.
 *
 * WHY FLAT: this shape must be producible by a 3-billion-parameter quantised
 * model running locally through Ollama. Small models fail on nesting: they
 * open an object, lose the thread, and emit unparseable JSON. Every field here
 * is a scalar or an array of scalars, with exactly ONE exception —
 * `suggestions[]`, whose items are four flat string fields. Do not add a fifth
 * level of structure. Do not nest an object inside a suggestion.
 *
 * TWO REPRESENTATIONS, DELIBERATELY HAND-MAINTAINED:
 *   1. `CvAnalysisSchema`      — Zod. Validates what a provider actually sent.
 *   2. `CV_ANALYSIS_JSON_SCHEMA` — JSON Schema. Sent to Ollama's `format`
 *      parameter and to the cloud providers' structured-output fields.
 *
 * They are NOT generated from each other. Small models are extremely sensitive
 * to schema wording, so the JSON Schema needs hand-tuned descriptions, and we
 * refuse to let that tuning leak into runtime validation. The price is drift
 * risk; the guard against it is a test asserting the two agree on their
 * required-key sets. Change one, change the other, in the same commit.
 */
import { z } from 'zod';

export type Verdict = 'strong' | 'possible' | 'weak';

export type SuggestionPriority = 'high' | 'medium' | 'low';

/**
 * One actionable CV edit. Four flat strings — see the nesting note above.
 */
export type CvAnalysisSuggestion = {
  section: string;
  issue: string;
  recommendation: string;
  priority: SuggestionPriority;
};

export type CvAnalysis = {
  match_score: number;
  verdict: Verdict;
  summary: string;
  matched_skills: string[];
  missing_skills: string[];
  keyword_gaps: string[];
  matched_keywords: string[];
  suggestions: CvAnalysisSuggestion[];
  ats_notes: string[];
};

// --- Zod representation -----------------------------------------------------

const suggestionShape = {
  section: z.string(),
  issue: z.string(),
  recommendation: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
};

const cvAnalysisShape = {
  match_score: z.number().int().min(0).max(100),
  verdict: z.enum(['strong', 'possible', 'weak']),
  summary: z.string(),
  matched_skills: z.array(z.string()),
  missing_skills: z.array(z.string()),
  keyword_gaps: z.array(z.string()),
  matched_keywords: z.array(z.string()),
  suggestions: z.array(z.looseObject(suggestionShape)),
  ats_notes: z.array(z.string()),
};

/**
 * BOTH SCHEMAS ARE DELIBERATELY LOOSE while the JSON Schema below sets
 * `additionalProperties: false`. That looks like a contradiction and is not:
 *
 *   - The JSON Schema constrains what we ASK a model to produce. Closing it is
 *     mandatory (Anthropic rejects open schemas) and keeps small models on the
 *     rails.
 *   - The Zod schema validates what came BACK, including from a bigger cloud
 *     model or a backup file written by a future version. Its job is to prove
 *     the required fields are present and correctly typed, not to delete
 *     fields it does not recognise. Stripping here would silently eat a richer
 *     result on its way into the user's export file.
 */
export const CvAnalysisSuggestionSchema = z.looseObject(suggestionShape);

export const CvAnalysisSchema = z.looseObject(cvAnalysisShape);

/** Fails to compile if the Zod schema and the hand-written type drift apart. */
type AssertAssignable<TActual extends TExpected, TExpected> = TActual;

export type _CvAnalysisSchemaMatchesType = AssertAssignable<
  z.infer<typeof CvAnalysisSchema>,
  CvAnalysis
>;
export type _CvAnalysisTypeMatchesSchema = AssertAssignable<
  CvAnalysis,
  z.infer<typeof CvAnalysisSchema>
>;

// --- Hand-written JSON Schema representation --------------------------------

/**
 * The subset of JSON Schema this package emits. Narrow on purpose: if a field
 * is not on this type, we do not send it to a provider.
 */
export interface JsonSchemaNode {
  readonly type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  readonly description?: string;
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: JsonSchemaNode;
  readonly enum?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
}

/**
 * Sent verbatim to Ollama's `format` parameter and to the cloud providers'
 * structured-output fields.
 *
 * HAND-TUNED. Descriptions are short imperatives because a 3B model treats
 * them as instructions, not documentation, and a long one derails it. Keep
 * every object closed with `additionalProperties: false` — Anthropic's
 * structured outputs reject a schema without it. No `$defs`, no `$ref`: small
 * models cannot follow an indirection.
 *
 * ============================================================================
 * THE PROPERTY ORDER IS LOAD-BEARING. EVIDENCE FIRST, CONCLUSION LAST.
 * ============================================================================
 * Every provider we send this to enforces the schema with CONSTRAINED
 * DECODING — Ollama compiles `format` into a llama.cpp grammar, OpenAI's
 * `strict: true` and Anthropic's `output_config.format` do the equivalent — and
 * a grammar walks the properties in the order they are declared here. Declaring
 * `match_score` first forces the model to emit its final score as the very
 * first token of its answer, BEFORE it has written a word of the skill audit,
 * the keyword screen or the ATS notes that are supposed to produce that score.
 *
 * It cannot reason before it has answered, so it does not reason. Measured
 * against a local model on one realistic CV and advert, the same candidate came
 * back at 92 with the score declared first and 85 with it declared last — and
 * the prompt's own calibration example puts that candidate at 84. The output
 * was schema-valid every time. That is the "valid but inert" failure: nothing
 * errored, nothing retried, and the number was wrong.
 *
 * So the reading order below is the REASONING order:
 *
 *   1-2  the skill audit
 *   3-4  the keyword screen
 *   5    the rest of the ATS screen
 *   6    the concrete edits, which depend on everything above
 *   7    the prose summary — the model's reasoning, written out
 *   8    match_score — the conclusion, now that there is something to conclude
 *   9    verdict — a function of the score, so it cannot precede it
 *
 * `required` is listed in the same order for the same reason: it is the list a
 * grammar walks to decide what must come next.
 *
 * THIS IS NOT A SCHEMA CHANGE AND DOES NOT BUMP `BACKUP_SCHEMA_VERSION`. Same
 * nine fields, same types, same required set. JSON object key order is
 * meaningless to `JSON.parse`, to Zod and to every consumer of a `CvAnalysis`,
 * and this schema is not the export format — nothing that reads a user's backup
 * file can tell the difference. `analysis.test.ts` pins the order; the drift
 * guard in `@cviper/ai-providers/schema-order.ts` pins it a second time, from
 * the far side of the package boundary.
 */
export const CV_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'matched_skills',
    'missing_skills',
    'matched_keywords',
    'keyword_gaps',
    'ats_notes',
    'suggestions',
    'summary',
    'match_score',
    'verdict',
  ],
  properties: {
    matched_skills: {
      type: 'array',
      items: { type: 'string' },
      description: 'Skills the job asks for that the CV already shows.',
    },
    missing_skills: {
      type: 'array',
      items: { type: 'string' },
      description: 'Skills the job asks for that the CV does not show.',
    },
    matched_keywords: {
      type: 'array',
      items: { type: 'string' },
      description: 'Words in the advert that the CV already uses.',
    },
    keyword_gaps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Words in the advert that an ATS would look for and not find.',
    },
    ats_notes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Formatting problems that could break CV parsing software.',
    },
    suggestions: {
      type: 'array',
      description: 'Specific edits to make to the CV.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'issue', 'recommendation', 'priority'],
        properties: {
          section: { type: 'string', description: 'CV section to change.' },
          issue: { type: 'string', description: 'What is wrong there.' },
          recommendation: { type: 'string', description: 'The change to make.' },
          priority: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description: 'How much this change matters.',
          },
        },
      },
    },
    summary: {
      type: 'string',
      description: 'Two sentences on the fit, addressed to the candidate.',
    },
    match_score: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
      description: 'How well the CV fits the job, 0 to 100.',
    },
    verdict: {
      type: 'string',
      enum: ['strong', 'possible', 'weak'],
      description: 'Overall call on the fit.',
    },
  },
} as const satisfies JsonSchemaNode;

// --- Verdict ----------------------------------------------------------------

/**
 * Derive the verdict from the score. IN TYPESCRIPT, NEVER FROM THE MODEL.
 *
 * A small model will happily return `match_score: 72` and `verdict: "strong"`
 * in the same breath — it is generating tokens, not doing arithmetic. A
 * self-contradicting result is worse than a wrong one, because the user sees
 * both numbers. So the model's `verdict` is parsed (the field stays in the
 * schema so the model still reasons about it) and then thrown away: this
 * function is the only thing that decides.
 */
export function deriveVerdict(matchScore: number): Verdict {
  if (matchScore >= 75) return 'strong';
  if (matchScore >= 60) return 'possible';
  // Anything else, INCLUDING NaN, lands here. A score we cannot read is not
  // evidence of a good match, so the safe answer is the pessimistic one.
  return 'weak';
}
