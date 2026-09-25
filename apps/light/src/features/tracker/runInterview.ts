/**
 * Running one interview preparation — the tracker's second door to a model.
 *
 * Deliberately shaped like `runExtraction.ts`, for the same two reasons: the
 * transport factory is INJECTED so a test can prove a path never built one,
 * and every message that reaches the user comes from the layer that knew what
 * went wrong rather than being reworded here into a shrug.
 *
 * ============================================================================
 * NOTHING HERE CAN FAIL IN A WAY THE CALLER HAS TO HANDLE.
 * ============================================================================
 * `prepareInterview` returns a `Result`, and this function folds it into an
 * `InterviewOutcome` — a discriminated union a component renders one way or
 * the other. There is no throw and no rejected promise: a refusal, a stopped
 * daemon and a model that could not hold the schema all arrive as
 * `available: false` with a sentence.
 *
 * ============================================================================
 * A CLOUD CALL WITHOUT CONSENT NEVER BUILDS A TRANSPORT (Apple 5.1.2(i))
 * ============================================================================
 * What leaves the machine on this path is MORE than the extraction path sends:
 * the CV, the cover letter, the profile's worked examples and the advert, all
 * at once. The gate is the SAME `isCloudKind` / `hasConsent` pair
 * `runAnalysis.ts` and `runExtraction.ts` use, imported from
 * `features/analysis/consent.ts` rather than copied, and
 * `lib/ai-call-sites-consent.contract.test.ts` derives this file into its
 * population because it imports `createTauriTransport`.
 *
 * `ollama` is structurally exempt, exactly as it is for the other two:
 * `ConsentProviderKind` is `Exclude<ProviderId, 'ollama'>`, so there is no
 * branch here for a local model to fall into.
 */
import {
  createAnthropicProvider,
  createOllamaProvider,
  createOpenAiProvider,
  prepareInterview,
  type AiProvider,
  type ChatTransport,
  type InterviewMeta,
  type InterviewPromptInput,
} from '@cviper/ai-providers';
import { type InterviewPack } from '@cviper/core-types';

import { createTauriTransport } from '../../ai/transport';

import { isCloudKind, readStoredConsent, type ConsentProviderKind } from '../analysis/consent';
import { providerLabel } from '../analysis/model';
import { type ProviderOption } from '../analysis/providers';

export interface InterviewRequest {
  readonly option: ProviderOption;
  /** The materials, already gathered. Sanitised and truncated inside the prompt builder. */
  readonly input: InterviewPromptInput;
}

/**
 * What the panel gets back. One shape for success, one for everything else.
 *
 * `reason` is safe to show verbatim: it is either this file's own sentence or
 * the message the provider or the orchestrator wrote for the user.
 */
export type InterviewOutcome =
  | { readonly available: true; readonly pack: InterviewPack; readonly meta: InterviewMeta }
  | { readonly available: false; readonly reason: string };

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
      // Unreachable: the panel filters this out before a user can pick it.
      // Answered with `null` rather than a throw so a future option added to
      // the union becomes a message, not a blank screen.
      return null;
  }
}

/** The fail-open shape, built here so the refusals below cannot drift. */
function unavailable(reason: string): InterviewOutcome {
  return { available: false, reason };
}

const NOT_IN_THIS_BUILD =
  'That way of preparing an interview is not available in this build. Choose a local model ' +
  'or a provider you have a key for.';

export async function runInterview(
  request: InterviewRequest,
  createTransport: () => ChatTransport = createTauriTransport,
  hasConsent: (kind: ConsentProviderKind) => Promise<boolean> = readStoredConsent,
): Promise<InterviewOutcome> {
  const model = request.option.model;

  // Checked BEFORE the factory is touched, so "this path cannot reach the
  // network" is provable rather than intended.
  if (request.option.kind === 'keyword' || model === null) {
    return unavailable(NOT_IN_THIS_BUILD);
  }

  // ── The consent gate (Apple 5.1.2(i)) ────────────────────────────────────
  // The same check `runExtraction` makes, from the same file, for the same
  // reason — and with more at stake, because this path sends the CV and the
  // profile's worked examples as well as the advert. Refused BEFORE
  // `createTransport()` is ever called. See `runInterview.consent.test.ts`.
  if (isCloudKind(request.option.kind)) {
    const consented = await hasConsent(request.option.kind);
    if (!consented) {
      const label = providerLabel(request.option.kind);
      // Reached only when the panel's own dialog (L-171) and this check
      // disagree — a consent withdrawn between the press and the run, or a
      // store that could not be read. The route it names is the button the
      // user just pressed; never "grant it elsewhere", the detour L-171 closed.
      return unavailable(
        `${label} needs your permission before your CV and this advert can be sent to it. ` +
          'Press “Prepare for this interview” again and the app will ask — or prepare with a ' +
          'local model instead.',
      );
    }
  }

  const provider = providerFor(request.option, createTransport());
  if (provider === null) return unavailable(NOT_IN_THIS_BUILD);

  const result = await prepareInterview({ ...request.input, provider, model });
  if (!result.ok) return unavailable(result.error.message);

  return { available: true, pack: result.value.pack, meta: result.value.meta };
}
