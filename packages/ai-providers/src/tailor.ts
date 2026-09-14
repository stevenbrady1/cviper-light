/**
 * tailorCv — one CV, one advert, one validated `TailoredCv`.
 *
 * The pipeline is `runStructuredCall` (see `tailor-pipeline.ts`): one call,
 * one repair turn, never a loop. There is no clamp step — every field is a
 * string or a list of strings, and a wrong string is not something a clamp
 * can fix.
 *
 * ============================================================================
 * THIS FUNCTION DOES NOT CHECK FOR FABRICATION. THE CALLER DOES.
 * ============================================================================
 * `checkFabrication` in `fabrication.ts` is pure and runs over the original
 * text and the result. It is kept OUT of this pipeline on purpose: a CV that
 * failed the check is still a CV the user should see — flagged, in gold, with
 * every invented company named — because the alternative is a second model
 * call that costs another thirty seconds and may invent something else. The
 * view runs the check and shows the report first. This function's job ends
 * at "valid shape".
 */
import {
  TAILORED_CV_JSON_SCHEMA,
  TailoredCvSchema,
  err,
  ok,
  type Result,
  type TailoredCv,
} from '@cviper/core-types';

import { buildTailorPrompt } from './prompt/build-tailor-prompt';
import {
  runStructuredCall,
  type PipelineError,
  type PipelineMeta,
  type SchemaIssue,
} from './tailor-pipeline';
import type { AiProvider } from './types';

/**
 * Output budget, in tokens.
 *
 * A full CV — a summary, a dozen skills, four or five roles with three to
 * five bullets each, education — lands around 1,500-2,500 tokens. 4096 leaves
 * headroom for a long career without inviting an essay, and with the ~3,000
 * token prompt sits inside the 8192-token context the Ollama adapter asks for.
 */
export const DEFAULT_MAX_TAILOR_TOKENS = 4096;

/** The label OpenAI's `response_format.json_schema.name` carries for this task. */
const SCHEMA_NAME = 'tailored_cv';

export interface TailorCvOptions {
  readonly provider: AiProvider;
  readonly model: string;
  readonly cvText: string;
  readonly jobText: string;
  /** The candidate's own notes on how they write. `null` for none. */
  readonly profileNotes: string | null;
  readonly maxOutputTokens?: number;
}

export type TailorMeta = PipelineMeta;
export type TailorError = PipelineError;

export interface TailorSuccess {
  readonly cv: TailoredCv;
  readonly meta: TailorMeta;
}

function parseTailoredCv(value: unknown): Result<TailoredCv, readonly SchemaIssue[]> {
  const parsed = TailoredCvSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(parsed.error.issues);
}

export async function tailorCv(
  options: TailorCvOptions,
): Promise<Result<TailorSuccess, TailorError>> {
  const { system, user } = buildTailorPrompt({
    cvText: options.cvText,
    jobText: options.jobText,
    profileNotes: options.profileNotes,
  });

  const result = await runStructuredCall<TailoredCv>({
    provider: options.provider,
    request: {
      model: options.model,
      system,
      schema: TAILORED_CV_JSON_SCHEMA as object,
      schemaName: SCHEMA_NAME,
      temperature: 0,
      maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_TAILOR_TOKENS,
    },
    user,
    requiredKeys: TAILORED_CV_JSON_SCHEMA.required,
    parse: parseTailoredCv,
  });

  return result.ok ? ok({ cv: result.value.value, meta: result.value.meta }) : result;
}
