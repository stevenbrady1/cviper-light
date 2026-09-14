/**
 * writeCoverLetter — one CV, one advert, optionally the tailored CV for
 * context, one validated `CoverLetter`.
 *
 * Same runner as `tailorCv` (`tailor-pipeline.ts`): one call, one repair turn.
 * Same division of labour too: this returns a valid SHAPE, and the caller
 * runs `checkLetterClaims` over it and shows the metric flags in gold rather
 * than spending another model call trying to make the letter honest by
 * asking again.
 */
import {
  COVER_LETTER_JSON_SCHEMA,
  CoverLetterSchema,
  err,
  ok,
  type CoverLetter,
  type Result,
} from '@cviper/core-types';

import { buildCoverLetterPrompt } from './prompt/build-cover-letter-prompt';
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
 * Four paragraphs under 400 words is about 550 tokens. 1024 leaves room for a
 * model that runs long without inviting a second page, and the view says so
 * in gold when the count passes 400.
 */
export const DEFAULT_MAX_COVER_LETTER_TOKENS = 1024;

const SCHEMA_NAME = 'cover_letter';

export interface WriteCoverLetterOptions {
  readonly provider: AiProvider;
  readonly model: string;
  readonly cvText: string;
  readonly jobText: string;
  /** The tailored CV as text, when the tailor step ran first. `null` otherwise. */
  readonly tailoredCvText: string | null;
  /** The candidate's own notes on how they write. `null` for none. */
  readonly profileNotes: string | null;
  readonly maxOutputTokens?: number;
}

export type CoverLetterMeta = PipelineMeta;
export type CoverLetterError = PipelineError;

export interface CoverLetterSuccess {
  readonly letter: CoverLetter;
  readonly meta: CoverLetterMeta;
}

function parseCoverLetter(value: unknown): Result<CoverLetter, readonly SchemaIssue[]> {
  const parsed = CoverLetterSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(parsed.error.issues);
}

export async function writeCoverLetter(
  options: WriteCoverLetterOptions,
): Promise<Result<CoverLetterSuccess, CoverLetterError>> {
  const { system, user } = buildCoverLetterPrompt({
    cvText: options.cvText,
    jobText: options.jobText,
    tailoredCvText: options.tailoredCvText,
    profileNotes: options.profileNotes,
  });

  const result = await runStructuredCall<CoverLetter>({
    provider: options.provider,
    request: {
      model: options.model,
      system,
      schema: COVER_LETTER_JSON_SCHEMA as object,
      schemaName: SCHEMA_NAME,
      temperature: 0,
      maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_COVER_LETTER_TOKENS,
    },
    user,
    requiredKeys: COVER_LETTER_JSON_SCHEMA.required,
    parse: parseCoverLetter,
  });

  return result.ok ? ok({ letter: result.value.value, meta: result.value.meta }) : result;
}
