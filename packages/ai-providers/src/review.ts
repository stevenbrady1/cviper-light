/**
 * reviewDraft — a hiring manager's read of one draft: a verdict and a list of
 * issues, never a rewrite.
 *
 * Same runner as the other two (`tailor-pipeline.ts`). The reviewer's output
 * is advice, so there is nothing to check it against afterwards — the worst a
 * bad review can do is be ignored, which is what the user will do with it.
 */
import {
  DRAFT_REVIEW_JSON_SCHEMA,
  DraftReviewSchema,
  err,
  ok,
  type DraftReview,
  type Result,
} from '@cviper/core-types';

import { buildReviewPrompt, type ReviewKind } from './prompt/build-review-prompt';
import {
  runStructuredCall,
  type PipelineError,
  type PipelineMeta,
  type SchemaIssue,
} from './tailor-pipeline';
import type { AiProvider } from './types';

/**
 * Output budget, in tokens. Half a dozen issues of two sentences each is
 * about 400 tokens; 1024 is the same headroom the extraction gets.
 */
export const DEFAULT_MAX_REVIEW_TOKENS = 1024;

const SCHEMA_NAME = 'draft_review';

export interface ReviewDraftOptions {
  readonly provider: AiProvider;
  readonly model: string;
  /** The rendered draft, exactly as the user sees it. */
  readonly draftText: string;
  readonly jobText: string;
  /** The ORIGINAL CV, which is the only thing a claim may rest on. */
  readonly cvText: string;
  readonly kind: ReviewKind;
  readonly maxOutputTokens?: number;
}

export type ReviewMeta = PipelineMeta;
export type ReviewError = PipelineError;

export interface ReviewSuccess {
  readonly review: DraftReview;
  readonly meta: ReviewMeta;
}

function parseReview(value: unknown): Result<DraftReview, readonly SchemaIssue[]> {
  const parsed = DraftReviewSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(parsed.error.issues);
}

export async function reviewDraft(
  options: ReviewDraftOptions,
): Promise<Result<ReviewSuccess, ReviewError>> {
  const { system, user } = buildReviewPrompt({
    draftText: options.draftText,
    jobText: options.jobText,
    cvText: options.cvText,
    kind: options.kind,
  });

  const result = await runStructuredCall<DraftReview>({
    provider: options.provider,
    request: {
      model: options.model,
      system,
      schema: DRAFT_REVIEW_JSON_SCHEMA as object,
      schemaName: SCHEMA_NAME,
      temperature: 0,
      maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_REVIEW_TOKENS,
    },
    user,
    requiredKeys: DRAFT_REVIEW_JSON_SCHEMA.required,
    parse: parseReview,
  });

  return result.ok ? ok({ review: result.value.value, meta: result.value.meta }) : result;
}
