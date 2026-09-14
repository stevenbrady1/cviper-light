/**
 * draftFollowUp — one application's materials in, one validated `FollowUpDraft`
 * out, and nothing sent anywhere.
 *
 * The pipeline is `analyzeCv`'s, unchanged in shape:
 *
 *   build prompt → provider.chatJson → extractJson → safeParse
 *     ├ ok   → Result.ok
 *     └ fail → ONE repair turn quoting the error and the rejected output
 *              → extractJson → safeParse → ok | Result.err
 *
 * There is no clamp stage: two strings have no edges to clamp. The schema
 * trims them and refuses an empty one, which is the whole of the validation a
 * draft needs.
 *
 * ============================================================================
 * A `Result`, LIKE `analyzeCv`, NOT AN OUTCOME LIKE `extractJob`
 * ============================================================================
 * `extractJob` returns a fail-open outcome because a failed extraction has a
 * useful half-answer (the blank form with the paste in it). A failed draft has
 * none: two empty boxes are not a draft. So the error is a proper error, with a
 * message the panel shows verbatim, and the app's call site
 * (`features/tracker/runFollowUp.ts`) turns it into the never-throws outcome
 * a component wants.
 *
 * The provider call is wrapped in try/catch all the same. Our three adapters
 * return `Result` and never throw; the fourth one might, and a rejected
 * promise must not reach a React render. The thrown value is NOT read — a
 * rejection can carry a URL or a header, and this string goes on screen.
 *
 * ============================================================================
 * EXACTLY ONE RETRY. NO LOOP. NO BACKOFF.
 * ============================================================================
 * Same reasoning as `analyzeCv`: every attempt against a local model costs the
 * user seconds in front of a spinner, there is no rate limit to back off from,
 * and a model that produced the wrong shape twice at temperature 0 will not
 * produce the right one on the fourth go.
 *
 * ============================================================================
 * TEMPERATURE 0, EVEN FOR PROSE
 * ============================================================================
 * This package types temperature as the literal `0` and that is not relaxed
 * here. A follow-up is not a creative task: it restates what the materials say,
 * and the one thing it must not do is invent. Determinism is the point.
 */
import {
  FOLLOW_UP_JSON_SCHEMA,
  FollowUpDraftSchema,
  err,
  ok,
  type FollowUpDraft,
  type Result,
} from '@cviper/core-types';

import { extractJson, type JsonFailureKind, type RepairStrategy } from './extract-json';
import { buildFollowUpPrompt, type FollowUpPromptInput } from './prompt/build-follow-up-prompt';
import { buildRepairPrompt } from './prompt/build-prompt';
import type { AiProvider, ProviderErrorKind } from './types';

/**
 * Output budget, in tokens.
 *
 * A subject and a sub-120-word body land around 200 tokens. 512 leaves room
 * for a chatty model without inviting an essay — a follow-up that needs more
 * than this is one nobody will read to the end.
 */
export const DEFAULT_MAX_FOLLOW_UP_TOKENS = 512;

/** The label OpenAI's `response_format.json_schema.name` carries for this task. */
const SCHEMA_NAME = 'follow_up_draft';

export interface DraftFollowUpOptions extends FollowUpPromptInput {
  readonly provider: AiProvider;
  readonly model: string;
  readonly maxOutputTokens?: number;
}

export interface FollowUpMeta {
  /** 0 when the first attempt validated, 1 when the repair turn rescued it. */
  readonly retryCount: 0 | 1;
  /** Which repair rung the JSON needed. 'clean' means none. */
  readonly repairStrategy: RepairStrategy;
}

export interface FollowUpSuccess {
  readonly draft: FollowUpDraft;
  readonly meta: FollowUpMeta;
}

export interface FollowUpError {
  readonly kind: ProviderErrorKind | JsonFailureKind | 'schema-invalid' | 'unclassified';
  /** Safe to show a user verbatim. */
  readonly message: string;
  readonly retryCount: 0 | 1;
}

/** Shown when a provider failed in a way we could not classify at all. */
const UNCLASSIFIED = 'The draft could not be written. Try again, or write it by hand.';

/** Shown when the model produced the wrong shape twice. */
const WRONG_SHAPE_TWICE =
  'The model did not return a usable draft. Try a different model, or write it by hand.';

type ParseFailure = Extract<ReturnType<typeof FollowUpDraftSchema.safeParse>, { success: false }>;

/** Enough to fix the reply, not so many that the repair turn becomes a wall. */
const MAX_REPORTED_ISSUES = 8;

function describeZodError(error: ParseFailure['error']): string {
  const lines = error.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue): string => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('\n');

  return error.issues.length > MAX_REPORTED_ISSUES
    ? `${lines}\n…and ${error.issues.length - MAX_REPORTED_ISSUES} more.`
    : lines;
}

interface Attempt {
  readonly draft: FollowUpDraft;
  readonly repairStrategy: RepairStrategy;
}

interface AttemptFailure {
  readonly kind: JsonFailureKind | 'schema-invalid';
  /** Fed back to the model on the repair turn. Never shown to the user as-is. */
  readonly message: string;
  readonly raw: string;
}

/** Parse one raw reply. Never calls the provider. */
function interpret(raw: string): Result<Attempt, AttemptFailure> {
  const extracted = extractJson(raw, FOLLOW_UP_JSON_SCHEMA.required);
  if (!extracted.ok) {
    return err({ kind: extracted.failure, message: extracted.message, raw });
  }

  const parsed = FollowUpDraftSchema.safeParse(extracted.value);
  if (!parsed.success) {
    return err({ kind: 'schema-invalid', message: describeZodError(parsed.error), raw });
  }

  return ok({ draft: parsed.data, repairStrategy: extracted.strategy });
}

export async function draftFollowUp(
  options: DraftFollowUpOptions,
): Promise<Result<FollowUpSuccess, FollowUpError>> {
  const { system, user } = buildFollowUpPrompt(options);

  const request = {
    model: options.model,
    system,
    schema: FOLLOW_UP_JSON_SCHEMA as object,
    schemaName: SCHEMA_NAME,
    temperature: 0,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_FOLLOW_UP_TOKENS,
  } as const;

  /** `null` means the provider threw rather than returned. See the header. */
  async function ask(userPrompt: string): Promise<Result<string, FollowUpError> | null> {
    try {
      const reply = await options.provider.chatJson({ ...request, user: userPrompt });
      return reply.ok
        ? ok(reply.value)
        : err({ kind: reply.error.kind, message: reply.error.message, retryCount: 0 });
    } catch {
      return null;
    }
  }

  // ── Attempt 1 ─────────────────────────────────────────────────────────────
  const first = await ask(user);
  if (first === null) return err({ kind: 'unclassified', message: UNCLASSIFIED, retryCount: 0 });
  // A provider failure ends it. None of these are fixable by asking again.
  if (!first.ok) return first;

  const firstAttempt = interpret(first.value);
  if (firstAttempt.ok) {
    return ok({
      draft: firstAttempt.value.draft,
      meta: { retryCount: 0, repairStrategy: firstAttempt.value.repairStrategy },
    });
  }

  // ── Attempt 2: the one repair turn ────────────────────────────────────────
  const repairUser = buildRepairPrompt(user, firstAttempt.error.raw, firstAttempt.error.message);
  const second = await ask(repairUser);
  if (second === null) return err({ kind: 'unclassified', message: UNCLASSIFIED, retryCount: 1 });
  if (!second.ok) return err({ ...second.error, retryCount: 1 });

  const secondAttempt = interpret(second.value);
  if (!secondAttempt.ok) {
    return err({ kind: secondAttempt.error.kind, message: WRONG_SHAPE_TWICE, retryCount: 1 });
  }

  return ok({
    draft: secondAttempt.value.draft,
    meta: { retryCount: 1, repairStrategy: secondAttempt.value.repairStrategy },
  });
}
