/**
 * Running one analysis — the single place the two paths meet.
 *
 * ============================================================================
 * THE KEYWORD PATH NEVER BUILDS A TRANSPORT.
 * ============================================================================
 * Not "does not use one" — never constructs one. The transport is a parameter
 * with a default, so the basic match returns before the factory is ever
 * touched, and `runAnalysis.test.ts` asserts the factory was not called at all.
 * That is a stronger guarantee than watching for an outbound request: it says
 * the code could not have made one.
 *
 * ============================================================================
 * BOTH PATHS PRODUCE THE SAME `CvAnalysis`
 * ============================================================================
 * `scoreByKeywords` was written to return exactly the shape `analyzeCv`
 * returns, field for field, so everything above this file renders one component
 * either way. The ONLY difference the user should see is the label saying which
 * one ran — and that label is not optional. A keyword scan presented as an AI
 * reading would be the app's one genuinely dishonest moment.
 */
import {
  analyzeCv,
  createAnthropicProvider,
  createOllamaProvider,
  createOpenAiProvider,
  type AiProvider,
  type ChatTransport,
} from '@cviper/ai-providers';
import { err, ok, type CvAnalysis, type Result } from '@cviper/core-types';
import { KEYWORD_SCORING_VERSION, scoreByKeywords } from '@cviper/keyword-scoring';

import { createTauriTransport } from '../../ai/transport';

import { type ProviderOption } from './providers';

export interface RunRequest {
  readonly option: ProviderOption;
  readonly cvText: string;
  readonly jobText: string;
}

export interface RunSuccess {
  readonly analysis: CvAnalysis;
  /** Stored on the analysis row: `keyword`, `ollama`, `anthropic`, `openai`. */
  readonly provider: string;
  /** Stored on the analysis row: the model id, or the scorer's version. */
  readonly model: string;
  /** True when the model's first answer was unusable and the repair turn saved it. */
  readonly retried: boolean;
}

export interface RunFailure {
  /** Legible enough to put in front of a user with no further translation. */
  readonly message: string;
}

/**
 * The scorer's identity, recorded where a model id would go.
 *
 * Versioned because the scoring rules can change: two runs of the same CV
 * against the same advert that produced different numbers would otherwise look
 * like the app contradicting itself, when in fact the engine moved.
 */
const KEYWORD_MODEL = `keyword-v${KEYWORD_SCORING_VERSION}`;

/** How a chosen option becomes a provider adapter. */
function providerFor(option: ProviderOption, transport: ChatTransport): AiProvider | null {
  switch (option.kind) {
    case 'ollama':
      return createOllamaProvider(transport);
    case 'anthropic':
      return createAnthropicProvider(transport);
    case 'openai':
      return createOpenAiProvider(transport);
    case 'keyword':
      // Unreachable: the keyword path returns before this is called. Answered
      // with `null` rather than a throw so a future option added to the union
      // fails as a message rather than as a blank screen.
      return null;
  }
}

/**
 * Run one analysis.
 *
 * `createTransport` is injected so the keyword path can be PROVED not to build
 * one. In the app it defaults to the real Tauri transport, which is the only
 * thing in the process that knows a provider call leaves the machine.
 */
export async function runAnalysis(
  request: RunRequest,
  createTransport: () => ChatTransport = createTauriTransport,
): Promise<Result<RunSuccess, RunFailure>> {
  // ── The keyword path, and everything's input guard ───────────────────────
  // `scoreByKeywords` is pure, synchronous and free, and it refuses input there
  // is nothing to measure with better wording than anything this file could
  // write. So it runs FIRST on every path: on the basic match it is the answer,
  // and on the AI paths it is the cheapest possible way to find out that a
  // 30-second model call was never going to work.
  const scored = scoreByKeywords(request.cvText, request.jobText);

  if (request.option.kind === 'keyword') {
    return scored.ok
      ? ok({
          analysis: scored.value,
          provider: 'keyword',
          model: KEYWORD_MODEL,
          retried: false,
        })
      : err({ message: scored.error.message });
  }

  if (!scored.ok) {
    // The same refusal, before a single token is generated or a single request
    // is billed. See above.
    return err({ message: scored.error.message });
  }

  // ── The AI paths ─────────────────────────────────────────────────────────
  const provider = providerFor(request.option, createTransport());
  const model = request.option.model;

  if (provider === null || model === null) {
    return err({
      message:
        'That way of running the analysis is not available in this build. ' +
        'Choose another option.',
    });
  }

  const analysed = await analyzeCv({
    provider,
    model,
    cvText: request.cvText,
    jobText: request.jobText,
  });

  if (!analysed.ok) {
    // Passed through verbatim. Every message that reaches here was written for
    // a user — by the Rust transport for a stopped daemon, by the adapter for a
    // rejected key, by `extract-json` for a truncated answer — and rewording
    // them here would replace advice with a shrug.
    return err({ message: analysed.error.message });
  }

  return ok({
    analysis: analysed.value.analysis,
    provider: request.option.kind,
    model,
    retried: analysed.value.meta.retryCount > 0,
  });
}
