/**
 * extractJob — one pasted advert, one validated `JobExtraction`, never a throw.
 *
 * PORTED FROM: c:\Dev\job-match-pro\backend\ai\services\search_helpers.py
 *   `extract_job_from_email`            — line 130
 *   `_email_extraction_unavailable`     — line 115 (the fail-open contract)
 *   `_normalise_email_fields`           — line 222 (lives in `extraction-clamp.ts`)
 *
 * The pipeline is `analyzeCv`'s, unchanged in shape:
 *
 *   build prompt → provider.chatJson → extractJson → clamp → safeParse
 *     ├ ok   → Result
 *     └ fail → ONE repair turn quoting the error and the rejected output
 *              → extractJson → clamp → safeParse → ok | unavailable
 *
 * ============================================================================
 * ONE DELIBERATE DIFFERENCE FROM `analyzeCv`: THIS RETURNS NO `Result`.
 * ============================================================================
 * `analyzeCv` returns `Result<AnalysisSuccess, AnalysisError>` because a failed
 * analysis has no useful half-answer — there is nothing to show but the error.
 * An extraction does: the review form. The source app is explicit about this
 * (`_email_extraction_unavailable`, and its docstring's "there is no keyword
 * heuristic here that would beat the user typing the fields themselves"), and
 * the app's own requirement is that a failure falls through to the blank manual
 * form with the paste preserved.
 *
 * So every path returns a `JobExtractionOutcome`, and a failure is
 * `available: false` carrying `EMPTY_JOB_EXTRACTION` plus a sentence the user
 * can read. There is no error channel to forget to handle, and no exception
 * that can reach the component and blank the screen. That is a type-level
 * guarantee rather than a promise: a caller CANNOT write the crashing version.
 *
 * The provider call is additionally wrapped in try/catch. Our three adapters
 * return `Result` and never throw, so that looks redundant — it is not. "Never
 * an exception that blocks the user" has to hold for the fourth adapter too,
 * and a rejected promise from a future one would otherwise propagate straight
 * through this function into a React render.
 *
 * ============================================================================
 * EXACTLY ONE RETRY. NO LOOP. NO BACKOFF.
 * ============================================================================
 * Same reasoning as `analyzeCv`: every attempt against a local model costs the
 * user 5-30 seconds in front of a spinner, there is no rate limit to back off
 * from, and a model that produced the wrong shape twice at temperature 0 will
 * not produce the right one on the fourth go. Provider-level failures are not
 * retried at all — a stopped daemon, a rejected key and a truncated answer are
 * all conditions a second identical request cannot fix.
 *
 * ============================================================================
 * NOT PORTED, AND WHY
 * ============================================================================
 * - The source's `logger.info` / `logger.warning` calls, and the AC-13 rule
 *   they enforce (never log an excerpt of the pasted body). There is no logging
 *   transport in this package at all, so the rule holds by construction. The
 *   `reason` returned to the caller is provider metadata only — a test asserts
 *   a rejected promise's message never reaches it verbatim.
 * - `router.select_provider(...)` and the registry check. Choosing a provider
 *   is the app's job here (`features/tracker/runExtraction.ts`), and the
 *   "no AI configured" case never reaches this function.
 * - `temperature=0.1`. This package types temperature as the literal `0`.
 */
import {
  EMPTY_JOB_EXTRACTION,
  JOB_EXTRACTION_JSON_SCHEMA,
  JobExtractionSchema,
  err,
  ok,
  type JobExtraction,
  type Result,
} from '@cviper/core-types';

import { extractJson, type JsonFailureKind, type RepairStrategy } from './extract-json';
import { clampExtraction } from './extraction-clamp';
import { buildRepairPrompt } from './prompt/build-prompt';
import { buildExtractionPrompt, extractionSourceText } from './prompt/build-extraction-prompt';
import type { AiProvider } from './types';

/**
 * Output budget, in tokens.
 *
 * Nine short fields plus a two-to-four-sentence description lands around 250
 * tokens. 1024 leaves room for a chatty model without inviting one to write an
 * essay, and sits well inside the 8192-token context the Ollama adapter asks
 * for alongside a ~2,000-token prompt. Half of `analyzeCv`'s 2048, because
 * there are no `suggestions[]` here.
 */
export const DEFAULT_MAX_EXTRACTION_TOKENS = 1024;

/** The label OpenAI's `response_format.json_schema.name` carries for this task. */
const SCHEMA_NAME = 'job_extraction';

export interface ExtractJobOptions {
  readonly provider: AiProvider;
  readonly model: string;
  /** Exactly what the user pasted. Sanitised and truncated inside. */
  readonly text: string;
  readonly maxOutputTokens?: number;
}

export interface JobExtractionMeta {
  /** 0 when the first attempt validated, 1 when the repair turn was spent. */
  readonly retryCount: 0 | 1;
  /** Named entries from `extraction-clamp.ts`. Empty means the model was exact. */
  readonly clampsApplied: readonly string[];
  /** Which repair rung the JSON needed. 'clean' means none. */
  readonly repairStrategy: RepairStrategy;
}

export interface JobExtractionOutcome {
  /** False means nothing was extracted. The fields are empty, never partial. */
  readonly available: boolean;
  /** Always a complete nine-field object. `EMPTY_JOB_EXTRACTION` when unavailable. */
  readonly extraction: JobExtraction;
  /** Safe to show a user verbatim. Non-null exactly when `available` is false. */
  readonly reason: string | null;
  readonly meta: JobExtractionMeta;
}

/** Shown when the user pressed Extract with nothing worth sending. */
const NOTHING_TO_EXTRACT =
  'There was nothing to read in that paste. Copy the whole advert — the title, ' +
  'the company and the description — and try again, or fill the form in by hand.';

/** Shown when a provider failed in a way we could not classify at all. */
const UNCLASSIFIED =
  'The extraction could not be completed. Fill the form in by hand, or try again.';

type ParseFailure = Extract<ReturnType<typeof JobExtractionSchema.safeParse>, { success: false }>;

/** Enough to fix the reply, not so many that the repair turn becomes a wall. */
const MAX_REPORTED_ISSUES = 8;

/**
 * Turn Zod's issue list into something a model can act on.
 *
 * The path matters more than the prose: "salary_min: expected number, received
 * string" tells the model exactly which key to fix, which is the whole point of
 * the repair turn.
 */
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
  readonly extraction: JobExtraction;
  readonly clampsApplied: readonly string[];
  readonly repairStrategy: RepairStrategy;
}

interface AttemptFailure {
  readonly kind: JsonFailureKind | 'schema-invalid';
  /** Fed back to the model on the repair turn. Never shown to the user as-is. */
  readonly message: string;
  readonly raw: string;
}

/**
 * Parse one raw reply. Never calls the provider — so the retry logic above it
 * stays a single, readable `if`.
 *
 * `sourceText` is the advert AS THE MODEL SAW IT, so the clamp and the model
 * are reading the same document. See `extractionSourceText`.
 */
function interpret(raw: string, sourceText: string): Result<Attempt, AttemptFailure> {
  const extracted = extractJson(raw, JOB_EXTRACTION_JSON_SCHEMA.required);
  if (!extracted.ok) {
    return err({ kind: extracted.failure, message: extracted.message, raw });
  }

  // Clamp BEFORE validating — and this is also where the salary overrule fires,
  // so a model that answered £45,000 for a pro-rata advert is corrected rather
  // than validated.
  const clamped = clampExtraction(extracted.value, sourceText);
  const parsed = JobExtractionSchema.safeParse(clamped.value);

  if (!parsed.success) {
    return err({ kind: 'schema-invalid', message: describeZodError(parsed.error), raw });
  }

  return ok({
    extraction: parsed.data,
    clampsApplied: clamped.applied,
    repairStrategy: extracted.strategy,
  });
}

function unavailable(reason: string, retryCount: 0 | 1): JobExtractionOutcome {
  return {
    available: false,
    // Deliberately NOT a partially-populated fallback. The source says it best:
    // there is no heuristic here that beats the user typing the fields
    // themselves, and half-guessed values defeat the point of the review screen.
    extraction: EMPTY_JOB_EXTRACTION,
    reason,
    meta: { retryCount, clampsApplied: [], repairStrategy: 'clean' },
  };
}

export async function extractJob(options: ExtractJobOptions): Promise<JobExtractionOutcome> {
  const sourceText = extractionSourceText(options.text);

  // Nothing worth sending. Checked BEFORE a provider is touched, so an empty
  // paste never costs the user a 30-second model load.
  if (sourceText.length === 0) return unavailable(NOTHING_TO_EXTRACT, 0);

  const { system, user } = buildExtractionPrompt({ text: options.text });

  const request = {
    model: options.model,
    system,
    schema: JOB_EXTRACTION_JSON_SCHEMA as object,
    schemaName: SCHEMA_NAME,
    temperature: 0,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_EXTRACTION_TOKENS,
  } as const;

  /**
   * Call the provider, absorbing anything it does other than return.
   *
   * `null` means "it blew up in a way that is not a `ProviderError`". See the
   * header: our adapters cannot do this, a future one could, and the fail-open
   * promise has to survive it. The thrown value is NOT read — a rejection can
   * carry a URL or a header, and this string goes on screen.
   */
  async function ask(userPrompt: string): Promise<Result<string, string> | null> {
    try {
      const reply = await options.provider.chatJson({ ...request, user: userPrompt });
      return reply.ok ? ok(reply.value) : err(reply.error.message);
    } catch {
      return null;
    }
  }

  // ── Attempt 1 ─────────────────────────────────────────────────────────────
  const first = await ask(user);
  if (first === null) return unavailable(UNCLASSIFIED, 0);
  if (!first.ok) {
    // A provider failure ends it. See the header: none of these are fixable by
    // asking the same question again.
    return unavailable(first.error, 0);
  }

  const firstAttempt = interpret(first.value, sourceText);
  if (firstAttempt.ok) {
    return {
      available: true,
      extraction: firstAttempt.value.extraction,
      reason: null,
      meta: {
        retryCount: 0,
        clampsApplied: firstAttempt.value.clampsApplied,
        repairStrategy: firstAttempt.value.repairStrategy,
      },
    };
  }

  // ── Attempt 2: the one repair turn ────────────────────────────────────────
  const repairUser = buildRepairPrompt(user, firstAttempt.error.raw, firstAttempt.error.message);
  const second = await ask(repairUser);
  if (second === null) return unavailable(UNCLASSIFIED, 1);
  if (!second.ok) return unavailable(second.error, 1);

  const secondAttempt = interpret(second.value, sourceText);
  if (!secondAttempt.ok) {
    // Twice. Hand back the empty form with an explanation rather than an error
    // the user can do nothing with.
    return unavailable(
      'The model could not read that advert into the form. Fill in what you need by hand — ' +
        'your paste is still here.',
      1,
    );
  }

  return {
    available: true,
    extraction: secondAttempt.value.extraction,
    reason: null,
    meta: {
      retryCount: 1,
      clampsApplied: secondAttempt.value.clampsApplied,
      repairStrategy: secondAttempt.value.repairStrategy,
    },
  };
}
