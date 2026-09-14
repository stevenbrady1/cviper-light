/**
 * prepareInterview — one archived application, one profile, one validated
 * `InterviewPack`.
 *
 * PORTED FROM: backend/ai/prompts/career_insights.py  (CViper repo, @ dea8c15)
 *   `build_interview_prep_prompt` / `build_interview_prep_system` — see
 *   `prompt/build-interview-prompt.ts` for what the port kept and dropped.
 *
 * The pipeline is `analyzeCv`'s, unchanged in shape:
 *
 *   build prompt → provider.chatJson → extractJson → safeParse
 *     ├ ok   → Result.ok
 *     └ fail → ONE repair turn quoting the error and the rejected output
 *              → extractJson → safeParse → ok | Result.err
 *
 * A `Result`, like `analyzeCv` and unlike `extractJob`: a failed rehearsal has
 * no useful half-answer. There is no form to fall through to — the panel shows
 * the sentence and the button stays where it was.
 *
 * ============================================================================
 * NO CLAMP. THE FOUR FIELDS ARE LISTS OF PROSE, AND THERE IS NOTHING TO CLAMP.
 * ============================================================================
 * `analyzeCv` clamps because a 3B model writes `"87"` for `87`; `extractJob`
 * clamps because it writes `£45,000` for a pro-rata advert. Nothing here is a
 * number, a date or a currency. A list that came back as a string is a schema
 * failure the repair turn describes by path, which is the right tool for it.
 *
 * ============================================================================
 * NOTHING TO PREPARE FROM IS REFUSED BEFORE THE PROVIDER IS TOUCHED.
 * ============================================================================
 * The whole point of the prompt is "use only the candidate's real material".
 * With no CV, no cover letter, no worked examples and no headline there IS no
 * real material, and every suggested answer would be invented — the one thing
 * the prompt forbids. So that case is a `no-material` error, decided here
 * from the inputs, and it never costs the user a 30-second model load.
 *
 * ============================================================================
 * EXACTLY ONE RETRY. NO LOOP. NO BACKOFF.
 * ============================================================================
 * Same reasoning as `analyzeCv`: every attempt against a local model costs the
 * user 10-40 seconds in front of a spinner, and a model that produced the
 * wrong shape twice at temperature 0 will not produce the right one on the
 * fourth go. Provider-level failures are not retried at all.
 */
import {
  INTERVIEW_PACK_JSON_SCHEMA,
  InterviewPackSchema,
  err,
  ok,
  type InterviewPack,
  type Result,
} from '@cviper/core-types';

import { extractJson, type JsonFailureKind, type RepairStrategy } from './extract-json';
import { buildInterviewPrompt, type InterviewPromptInput } from './prompt/build-interview-prompt';
import { buildRepairPrompt } from './prompt/build-prompt';
import type { AiProvider, ProviderErrorKind } from './types';

/**
 * Output budget, in tokens.
 *
 * Six to eight STAR-shaped answers of four to six sentences each is the bulk
 * of it — around 1,200-1,500 tokens — plus three short lists. 2048 leaves
 * headroom for a chatty model without inviting an essay, and with a ~2,900-
 * token prompt sits well inside the 8192-token context the Ollama adapter asks
 * for. The same figure as `analyzeCv`, for the same amount of prose.
 */
export const DEFAULT_MAX_INTERVIEW_TOKENS = 2048;

/** The label OpenAI's `response_format.json_schema.name` carries for this task. */
const SCHEMA_NAME = 'interview_pack';

export interface PrepareInterviewOptions extends InterviewPromptInput {
  readonly provider: AiProvider;
  readonly model: string;
  readonly maxOutputTokens?: number;
}

export interface InterviewMeta {
  /** 0 when the first attempt validated, 1 when the repair turn rescued it. */
  readonly retryCount: 0 | 1;
  /** Which repair rung the JSON needed. 'clean' means none. */
  readonly repairStrategy: RepairStrategy;
}

export interface InterviewSuccess {
  readonly pack: InterviewPack;
  readonly meta: InterviewMeta;
}

export interface InterviewError {
  readonly kind: ProviderErrorKind | JsonFailureKind | 'schema-invalid' | 'no-material';
  /** Safe to show a user verbatim. */
  readonly message: string;
  readonly retryCount: 0 | 1;
}

/** Shown when there is nothing real for the model to build answers from. */
export const NO_MATERIAL_MESSAGE =
  'There is nothing to prepare from yet. Add a CV, or put a headline and a worked example ' +
  'on your profile, and try again.';

type InterviewParseFailure = Extract<
  ReturnType<typeof InterviewPackSchema.safeParse>,
  { success: false }
>;

/** Enough to fix the reply, not so many that the repair turn becomes a wall. */
const MAX_REPORTED_ISSUES = 8;

/**
 * Turn Zod's issue list into something a model can act on.
 *
 * The path matters more than the prose: "likely_questions.2.suggested_answer:
 * expected string" tells the model exactly which entry to fix.
 */
function describeZodError(error: InterviewParseFailure['error']): string {
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
  readonly pack: InterviewPack;
  readonly repairStrategy: RepairStrategy;
}

interface AttemptFailure {
  readonly kind: JsonFailureKind | 'schema-invalid';
  /** Fed back to the model on the repair turn. */
  readonly message: string;
  readonly raw: string;
}

/**
 * Is there anything real to build answers from?
 *
 * Whitespace counts as nothing: a CV whose extraction produced an empty
 * string is a CV the model cannot read, and a profile whose headline is three
 * spaces has no headline.
 */
function hasMaterial(input: InterviewPromptInput): boolean {
  const present = (text: string | null) => text !== null && text.trim().length > 0;
  return (
    present(input.cvText) ||
    present(input.coverLetter) ||
    present(input.profile.headline) ||
    input.profile.starExamples.length > 0
  );
}

/**
 * Parse one raw reply. Never calls the provider — so the retry logic above it
 * stays a single, readable `if`.
 */
function interpret(raw: string): Result<Attempt, AttemptFailure> {
  const extracted = extractJson(raw, INTERVIEW_PACK_JSON_SCHEMA.required);
  if (!extracted.ok) {
    return err({ kind: extracted.failure, message: extracted.message, raw });
  }

  const parsed = InterviewPackSchema.safeParse(extracted.value);
  if (!parsed.success) {
    return err({ kind: 'schema-invalid', message: describeZodError(parsed.error), raw });
  }

  return ok({ pack: parsed.data, repairStrategy: extracted.strategy });
}

export async function prepareInterview(
  options: PrepareInterviewOptions,
): Promise<Result<InterviewSuccess, InterviewError>> {
  // Refused BEFORE a provider is touched. See the header.
  if (!hasMaterial(options)) {
    return err({ kind: 'no-material', message: NO_MATERIAL_MESSAGE, retryCount: 0 });
  }

  const { system, user } = buildInterviewPrompt(options);

  const request = {
    model: options.model,
    system,
    schema: INTERVIEW_PACK_JSON_SCHEMA as object,
    schemaName: SCHEMA_NAME,
    temperature: 0,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_INTERVIEW_TOKENS,
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
      pack: firstAttempt.value.pack,
      meta: { retryCount: 0, repairStrategy: firstAttempt.value.repairStrategy },
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
    pack: secondAttempt.value.pack,
    meta: { retryCount: 1, repairStrategy: secondAttempt.value.repairStrategy },
  });
}
