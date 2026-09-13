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
 *
 * ============================================================================
 * A CLOUD EXTRACTION WITHOUT CONSENT NEVER BUILDS A TRANSPORT (Apple 5.1.2(i))
 * ============================================================================
 * What leaves the machine on this path is whatever is in the advert box — the
 * whole advert or a recruiter's email, that person's name and address
 * included. Until L-115 it left with nothing disclosed and nothing recorded,
 * while the analysis path next door had been gated since the guideline landed.
 *
 * The gate is the SAME `isCloudKind` / `hasConsent` pair `runAnalysis.ts` uses,
 * imported from `features/analysis/consent.ts` rather than copied: one check,
 * two call sites, and `lib/ai-call-sites-consent.contract.test.ts` now derives
 * the list of call sites instead of being told it.
 *
 * `ollama` is structurally exempt, exactly as it is for analysis:
 * `ConsentProviderKind` is `Exclude<ProviderId, 'ollama'>`, so there is no
 * branch here for a local model to fall into and nothing to remember.
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

import { isCloudKind, readStoredConsent, type ConsentProviderKind } from '../analysis/consent';
import { providerLabel } from '../analysis/model';
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
  hasConsent: (kind: ConsentProviderKind) => Promise<boolean> = readStoredConsent,
): Promise<JobExtractionOutcome> {
  const model = request.option.model;

  // Checked BEFORE the factory is touched, so "this path cannot reach the
  // network" is provable rather than intended.
  if (request.option.kind === 'keyword' || model === null) {
    return unavailable(
      'That way of reading the advert is not available in this build. Fill the form in by hand.',
    );
  }

  // ── The consent gate (Apple 5.1.2(i)) ────────────────────────────────────
  // The same check `runAnalysis` makes, from the same file, for the same
  // reason: what goes to the provider here is the whole advert or recruiter
  // email, names and addresses included. Only the two cloud kinds reach it —
  // `isCloudKind` narrows to `ConsentProviderKind`, which structurally excludes
  // 'ollama' — and it is refused BEFORE `createTransport()` is ever called. See
  // `runExtraction.consent.test.ts`, and `lib/ai-call-sites-consent.contract.test.ts`
  // for the guard that now watches every call site rather than one.
  if (isCloudKind(request.option.kind)) {
    const consented = await hasConsent(request.option.kind);
    if (!consented) {
      const label = providerLabel(request.option.kind);
      // Says the PRECONDITION, not just the destination. The consent dialog
      // only opens when "Check this CV" runs, and that button is disabled with
      // "Choose a CV first." — so "grant it on the Analysis screen" on its own
      // sends somebody with no CV yet to a screen that will not ask. A paste-flow
      // affordance of its own is L-141 (#81); until then this sentence is the
      // route, and it has to be a route that works.
      return unavailable(
        `${label} needs your permission before the advert can be sent to it. Grant it on the ` +
          `Analysis screen: choose a CV there and run a check with ${label}, and it will ask ` +
          '— or fill the form in by hand.',
      );
    }
  }

  const provider = providerFor(request.option, createTransport());
  if (provider === null) {
    return unavailable(
      'That way of reading the advert is not available in this build. Fill the form in by hand.',
    );
  }

  return extractJob({ provider, model, text: request.text });
}
