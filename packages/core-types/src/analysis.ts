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

// PHASE 1a RED: placeholder. The real shape lands in the GREEN commit.
export const CvAnalysisSuggestionSchema = z.object({});

// PHASE 1a RED: placeholder. The real shape lands in the GREEN commit.
export const CvAnalysisSchema = z.object({});

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

// PHASE 1a RED: placeholder. The real schema lands in the GREEN commit.
export const CV_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {},
  required: [],
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
export function deriveVerdict(_matchScore: number): Verdict {
  throw new Error('NOT_IMPLEMENTED: deriveVerdict');
}
