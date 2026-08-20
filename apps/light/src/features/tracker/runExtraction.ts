/**
 * Running one extraction — the tracker's single door to a model.
 *
 * Deliberately shaped like `features/analysis/runAnalysis.ts`, for the same two
 * reasons: the transport factory is INJECTED so a test can prove a path never
 * built one, and every message that reaches the user comes from the layer that
 * knew what went wrong rather than being reworded here into a shrug.
 *
 * ============================================================================
 * NOTHING HERE CAN FAIL IN A WAY THE CALLER HAS TO HANDLE.
 * ============================================================================
 * `extractJob` returns a `JobExtractionOutcome` on every path, never a
 * `Result`, so this function has no error channel either. A component calling
 * it cannot forget the failure case, because there is no failure case — there
 * is an outcome whose `available` is false and whose fields are empty, and the
 * review form renders it exactly as it renders any other.
 */
import {
  createAnthropicProvider,
  createOllamaProvider,
  createOpenAiProvider,
  extractJob,
  type AiProvider,
  type ChatTransport,
  type JobExtractionOutcome,
} from '@cviper/ai-providers';
import { EMPTY_JOB_EXTRACTION } from '@cviper/core-types';

import { createTauriTransport } from '../../ai/transport';

import { type ProviderOption } from '../analysis/providers';

export interface ExtractionRequest {
  readonly option: ProviderOption;
  /** Exactly what the user pasted. Sanitised and truncated inside `extractJob`. */
  readonly text: string;
}

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
      // Unreachable: `extractionOptions` filters this out before a user can
      // pick it. Answered with `null` rather than a throw so a future option
      // added to the union becomes a message, not a blank screen.
      return null;
  }
}

/** The fail-open shape, built here so the two refusals below cannot drift. */
function unavailable(reason: string): JobExtractionOutcome {
  return {
    available: false,
    extraction: EMPTY_JOB_EXTRACTION,
    reason,
    meta: { retryCount: 0, clampsApplied: [], repairStrategy: 'clean' },
  };
}

export async function runExtraction(
  request: ExtractionRequest,
  createTransport: () => ChatTransport = createTauriTransport,
): Promise<JobExtractionOutcome> {
  const model = request.option.model;

  // Checked BEFORE the factory is touched, so "this path cannot reach the
  // network" is provable rather than intended.
  if (request.option.kind === 'keyword' || model === null) {
    return unavailable(
      'That way of reading the advert is not available in this build. Fill the form in by hand.',
    );
  }

  const provider = providerFor(request.option, createTransport());
  if (provider === null) {
    return unavailable(
      'That way of reading the advert is not available in this build. Fill the form in by hand.',
    );
  }

  return extractJob({ provider, model, text: request.text });
}
