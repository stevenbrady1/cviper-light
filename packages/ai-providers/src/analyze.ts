/**
 * analyzeCv — one CV, one advert, one validated `CvAnalysis`.
 *
 * The pipeline:
 *
 *   build prompt → provider.chatJson → extractJson → clamp → safeParse
 *     ├ ok   → overwrite verdict from match_score → Result.ok
 *     └ fail → ONE repair turn quoting the error and the rejected output
 *              → extractJson → clamp → safeParse → ok | Result.err
 *
 * ============================================================================
 * EXACTLY ONE RETRY. NO LOOP. NO BACKOFF.
 * ============================================================================
 * The obvious "improvement" here is a retry loop. It is wrong for this app.
 * Every attempt against a local model costs the user 10-40 seconds in front of
 * a spinner, there is no rate limit to back off from, and a model that produced
 * the wrong shape twice at temperature 0 is not going to produce the right one
 * on the fourth go — the input is deterministic, so a third attempt is the same
 * dice roll with more waiting. `retryCount` travels back in the metadata so the
 * UI can say "recovered on retry" rather than pretending it went smoothly.
 *
 * Provider-level failures are NOT retried at all. An auth failure, a stopped
 * daemon and a truncated answer are all conditions a second identical request
 * cannot fix — and for truncation a retry is actively worse, because the repair
 * turn is longer than the original.
 */
import {
  CV_ANALYSIS_JSON_SCHEMA,
  CvAnalysisSchema,
  deriveVerdict,
  err,
  ok,
  type CvAnalysis,
  type Result,
} from '@cviper/core-types';
import { clampAnalysis } from './clamp';
import { extractJson, type JsonFailureKind, type RepairStrategy } from './extract-json';
import { buildAnalysisPrompt, buildRepairPrompt } from './prompt/build-prompt';
import { reasoningFirstSchema } from './schema-order';
import type { AiProvider, ProviderErrorKind } from './types';

/**
 * Default output budget, in tokens.
 *
 * The flat schema with 3-5 suggestions lands around 700-1100 tokens. 2048
 * leaves headroom for a chatty model without inviting one to ramble, and sits
 * comfortably inside the 8192-token context the Ollama adapter asks for
 * alongside a ~3900-token prompt.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

/**
 * The schema as it goes on the wire: identical to `CV_ANALYSIS_JSON_SCHEMA`
 * except that the conclusion fields come last. Computed once — it is the same
 * object for every call.
 */
const WIRE_SCHEMA = reasoningFirstSchema(CV_ANALYSIS_JSON_SCHEMA) as object;

export interface AnalyzeCvOptions {
  readonly provider: AiProvider;
  readonly model: string;
  readonly cvText: string;
  readonly jobText: string;
  readonly maxOutputTokens?: number;
}

export interface AnalysisMeta {
  /** 0 when the first attempt validated, 1 when the repair turn rescued it. */
  readonly retryCount: 0 | 1;
  /** Named entries from `clamp.ts`. Empty means the model got it exactly right. */
  readonly clampsApplied: readonly string[];
  /** Which repair rung the JSON needed. 'clean' means none. */
  readonly repairStrategy: RepairStrategy;
}

export interface AnalysisSuccess {
  readonly analysis: CvAnalysis;
  readonly meta: AnalysisMeta;
}

export interface AnalysisError {
  readonly kind: ProviderErrorKind | JsonFailureKind | 'schema-invalid';
  /** Safe to show a user verbatim. */
  readonly message: string;
  readonly retryCount: 0 | 1;
}

/**
 * The failure half of `CvAnalysisSchema.safeParse`.
 *
 * Derived from the schema rather than imported from `zod`, so this package
 * needs no direct dependency on a validation library it never calls itself —
 * and so the type cannot drift from the schema it describes.
 */
type AnalysisParseFailure = Extract<
  ReturnType<typeof CvAnalysisSchema.safeParse>,
  { success: false }
>;

/**
 * Turn Zod's issue list into something a model can act on.
 *
 * The path matters more than the prose: "match_score: expected number, received
 * string" tells the model exactly which key to fix, which is the whole point of
 * the repair turn.
 */
function describeZodError(error: AnalysisParseFailure['error']): string {
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

/** Enough to fix the reply, not so many that the repair turn becomes a wall. */
const MAX_REPORTED_ISSUES = 8;

interface Attempt {
  readonly analysis: CvAnalysis;
  readonly clampsApplied: readonly string[];
  readonly repairStrategy: RepairStrategy;
}

type AttemptFailure =
  | { readonly kind: JsonFailureKind; readonly message: string; readonly raw: string }
  | { readonly kind: 'schema-invalid'; readonly message: string; readonly raw: string };

/**
 * Parse one raw reply. Never calls the provider — so the retry logic above it
 * stays a single, readable `if`.
 */
function interpret(raw: string): Result<Attempt, AttemptFailure> {
  const extracted = extractJson(raw, CV_ANALYSIS_JSON_SCHEMA.required);
  if (!extracted.ok) {
    return err({ kind: extracted.failure, message: extracted.message, raw });
  }

  // Clamp BEFORE validating. A 3B model gets the edges wrong in a new way every
  // run, and spending the one retry on `"87"` instead of `87` is a waste of the
  // user's time when the answer underneath is sound.
  const clamped = clampAnalysis(extracted.value);
  const parsed = CvAnalysisSchema.safeParse(clamped.value);

  if (!parsed.success) {
    return err({ kind: 'schema-invalid', message: describeZodError(parsed.error), raw });
  }

  return ok({
    analysis: {
      ...parsed.data,
      // ======================================================================
      // THE VERDICT IS DERIVED HERE, AND ONLY HERE.
      // ======================================================================
      // Whatever the model said is discarded. It is a token generator, not a
      // comparator, and a result that says 72 and "strong" in the same breath
      // is worse than a wrong one — the user can see both.
      verdict: deriveVerdict(parsed.data.match_score),
    },
    clampsApplied: clamped.applied,
    repairStrategy: extracted.strategy,
  });
}

export async function analyzeCv(
  options: AnalyzeCvOptions,
): Promise<Result<AnalysisSuccess, AnalysisError>> {
  const { system, user } = buildAnalysisPrompt({
    cvText: options.cvText,
    jobText: options.jobText,
  });
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  const request = {
    model: options.model,
    system,
    // Resequenced so the model emits its evidence before its score. Same nine
    // fields; without this every provider's constrained decoder forces the
    // conclusion out first and llama3.2 returns `match_score: 0` every time.
    // See `schema-order.ts` for the measurements.
    schema: WIRE_SCHEMA,
    temperature: 0,
    maxOutputTokens,
  } as const;

  // ── Attempt 1 ─────────────────────────────────────────────────────────────
  const first = await options.provider.chatJson({ ...request, user });
  if (!first.ok) {
    // A provider failure ends it. See the header: none of these are fixable by
    // asking the same question again.
    return err({ kind: first.error.kind, message: first.error.message, retryCount: 0 });
  }

  const firstAttempt = interpret(first.value);
  if (firstAttempt.ok) {
    return ok({
      analysis: firstAttempt.value.analysis,
      meta: {
        retryCount: 0,
        clampsApplied: firstAttempt.value.clampsApplied,
        repairStrategy: firstAttempt.value.repairStrategy,
      },
    });
  }

  // ── Attempt 2: the one repair turn ────────────────────────────────────────
  const repairUser = buildRepairPrompt(user, firstAttempt.error.raw, firstAttempt.error.message);
  const second = await options.provider.chatJson({ ...request, user: repairUser });
  if (!second.ok) {
    return err({ kind: second.error.kind, message: second.error.message, retryCount: 1 });
  }

  const secondAttempt = interpret(second.value);
  if (!secondAttempt.ok) {
    return err({
      kind: secondAttempt.error.kind,
      message: secondAttempt.error.message,
      retryCount: 1,
    });
  }

  return ok({
    analysis: secondAttempt.value.analysis,
    meta: {
      retryCount: 1,
      clampsApplied: secondAttempt.value.clampsApplied,
      repairStrategy: secondAttempt.value.repairStrategy,
    },
  });
}
