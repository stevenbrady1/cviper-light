/**
 * The structured-call runner the three writing pipelines share.
 *
 *   provider.chatJson → extractJson → safeParse
 *     ├ ok   → Result.ok
 *     └ fail → ONE repair turn quoting the error and the rejected output
 *              → extractJson → safeParse → ok | Result.err
 *
 * `analyzeCv` and `extractJob` each carry their own copy of this loop because
 * each has a clamp step in the middle and a different failure contract. The
 * tailored CV, the cover letter and the review have no clamp — nothing numeric
 * to nudge — and the same `Result` contract, so a third, fourth and fifth copy
 * would be three places to get the retry count wrong. This is the one place.
 *
 * ============================================================================
 * EXACTLY ONE RETRY. NO LOOP. NO BACKOFF.
 * ============================================================================
 * Same reasoning as `analyze.ts`: locally every attempt is 10-40 seconds in
 * front of a spinner, there is no rate limit to back off from, and a model
 * that got the shape wrong twice at temperature 0 will not get it right on
 * the fourth go. Provider-level failures are not retried at all.
 */
import { err, ok, type Result } from '@cviper/core-types';

import { extractJson, type JsonFailureKind, type RepairStrategy } from './extract-json';
import { buildRepairPrompt } from './prompt/build-prompt';
import type { AiProvider, ChatJsonRequest, ProviderErrorKind } from './types';

export interface PipelineMeta {
  /** 0 when the first attempt validated, 1 when the repair turn rescued it. */
  readonly retryCount: 0 | 1;
  /** Which repair rung the JSON needed. 'clean' means none. */
  readonly repairStrategy: RepairStrategy;
}

export interface PipelineError {
  readonly kind: ProviderErrorKind | JsonFailureKind | 'schema-invalid';
  /** Safe to show a user verbatim. */
  readonly message: string;
  readonly retryCount: 0 | 1;
}

/** One Zod issue, as the caller's schema reports it. */
export interface SchemaIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** Enough to fix the reply, not so many that the repair turn becomes a wall. */
const MAX_REPORTED_ISSUES = 8;

/**
 * Turn a Zod issue list into something a model can act on. The path matters
 * more than the prose: "experience.0.bullets: expected array" names the key.
 */
export function describeSchemaIssues(issues: readonly SchemaIssue[]): string {
  const lines = issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue): string => {
      const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('\n');

  return issues.length > MAX_REPORTED_ISSUES
    ? `${lines}\n…and ${issues.length - MAX_REPORTED_ISSUES} more.`
    : lines;
}

export interface StructuredCallOptions<T> {
  readonly provider: AiProvider;
  /** Everything but the user turn, which changes on the repair attempt. */
  readonly request: Omit<ChatJsonRequest, 'user'>;
  readonly user: string;
  /** The schema's top-level `required`, for `extractJson`'s key check. */
  readonly requiredKeys: readonly string[];
  /** The caller's `Schema.safeParse`, reduced to a `Result`. */
  readonly parse: (value: unknown) => Result<T, readonly SchemaIssue[]>;
}

type AttemptFailure = {
  readonly kind: JsonFailureKind | 'schema-invalid';
  readonly message: string;
  readonly raw: string;
};

function interpret<T>(
  raw: string,
  options: StructuredCallOptions<T>,
): Result<{ value: T; repairStrategy: RepairStrategy }, AttemptFailure> {
  const extracted = extractJson(raw, options.requiredKeys);
  if (!extracted.ok) {
    return err({ kind: extracted.failure, message: extracted.message, raw });
  }

  const parsed = options.parse(extracted.value);
  if (!parsed.ok) {
    return err({ kind: 'schema-invalid', message: describeSchemaIssues(parsed.error), raw });
  }

  return ok({ value: parsed.value, repairStrategy: extracted.strategy });
}

export async function runStructuredCall<T>(
  options: StructuredCallOptions<T>,
): Promise<Result<{ value: T; meta: PipelineMeta }, PipelineError>> {
  // ── Attempt 1 ─────────────────────────────────────────────────────────────
  const first = await options.provider.chatJson({ ...options.request, user: options.user });
  if (!first.ok) {
    return err({ kind: first.error.kind, message: first.error.message, retryCount: 0 });
  }

  const firstAttempt = interpret(first.value, options);
  if (firstAttempt.ok) {
    return ok({
      value: firstAttempt.value.value,
      meta: { retryCount: 0, repairStrategy: firstAttempt.value.repairStrategy },
    });
  }

  // ── Attempt 2: the one repair turn ────────────────────────────────────────
  const repairUser = buildRepairPrompt(
    options.user,
    firstAttempt.error.raw,
    firstAttempt.error.message,
  );
  const second = await options.provider.chatJson({ ...options.request, user: repairUser });
  if (!second.ok) {
    return err({ kind: second.error.kind, message: second.error.message, retryCount: 1 });
  }

  const secondAttempt = interpret(second.value, options);
  if (!secondAttempt.ok) {
    return err({
      kind: secondAttempt.error.kind,
      message: secondAttempt.error.message,
      retryCount: 1,
    });
  }

  return ok({
    value: secondAttempt.value.value,
    meta: { retryCount: 1, repairStrategy: secondAttempt.value.repairStrategy },
  });
}
