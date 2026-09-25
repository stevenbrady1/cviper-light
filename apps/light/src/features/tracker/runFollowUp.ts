/**
 * Running one draft — the tracker's second door to a model, shaped exactly
 * like the first (`runExtraction.ts`).
 *
 * The transport factory is INJECTED so a test can prove a path never built
 * one, and every message that reaches the user comes from the layer that knew
 * what went wrong rather than being reworded here into a shrug.
 *
 * ============================================================================
 * NOTHING HERE CAN FAIL IN A WAY THE CALLER HAS TO HANDLE.
 * ============================================================================
 * `draftFollowUp` returns a `Result`; this function turns it into an outcome.
 * A component calling it cannot forget the failure case, because there is no
 * failure case — there is an outcome whose `available` is false and whose
 * `reason` is a sentence for the panel.
 *
 * ============================================================================
 * NOTHING HERE SENDS ANYTHING.
 * ============================================================================
 * The outcome is a subject and a body. No address is read, no mail client is
 * opened, no request is made on the user's behalf. `followUp.noSend.contract.test.ts`
 * reads this file's shipped text and fails on `mailto:` or a `send`.
 *
 * ============================================================================
 * A CLOUD DRAFT WITHOUT CONSENT NEVER BUILDS A TRANSPORT (Apple 5.1.2(i))
 * ============================================================================
 * What leaves the machine on this path is the user's CV, their cover letter
 * and the advert — more personal than the paste path, not less. The gate is
 * the SAME `isCloudKind` / `hasConsent` pair `runExtraction.ts` and
 * `runAnalysis.ts` use, imported from `features/analysis/consent.ts` rather
 * than copied, and it runs BEFORE `createTransport()` is ever called.
 * `lib/ai-call-sites-consent.contract.test.ts` derives the list of call sites
 * and checks the order in each.
 *
 * `ollama` is structurally exempt, exactly as it is everywhere else:
 * `ConsentProviderKind` is `Exclude<ProviderId, 'ollama'>`, so there is no
 * branch here for a local model to fall into and nothing to remember.
 */
import {
  createAnthropicProvider,
  createOllamaProvider,
  createOpenAiProvider,
  draftFollowUp,
  type AiProvider,
  type ChatTransport,
  type FollowUpKind,
  type FollowUpMaterials,
  type FollowUpMeta,
} from '@cviper/ai-providers';
import { type FollowUpDraft } from '@cviper/core-types';

import { createTauriTransport } from '../../ai/transport';

import { isCloudKind, readStoredConsent, type ConsentProviderKind } from '../analysis/consent';
import { providerLabel } from '../analysis/model';
import { type ProviderOption } from '../analysis/providers';

export interface FollowUpRequest {
  readonly option: ProviderOption;
  readonly kind: FollowUpKind;
  readonly jobTitle: string;
  readonly company: string;
  /** Days since the last activity, for a follow-up. `null` for a thank-you. */
  readonly daysQuiet: number | null;
  readonly materials: FollowUpMaterials;
  readonly writingStyle: string | null;
}

export type FollowUpOutcome =
  | { readonly available: true; readonly draft: FollowUpDraft; readonly meta: FollowUpMeta }
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
function unavailable(reason: string): FollowUpOutcome {
  return { available: false, reason };
}

const NOT_IN_THIS_BUILD =
  'That way of drafting is not available in this build. Write the note by hand.';

export async function runFollowUp(
  request: FollowUpRequest,
  createTransport: () => ChatTransport = createTauriTransport,
  hasConsent: (kind: ConsentProviderKind) => Promise<boolean> = readStoredConsent,
): Promise<FollowUpOutcome> {
  const model = request.option.model;

  // Checked BEFORE the factory is touched, so "this path cannot reach the
  // network" is provable rather than intended. The keyword match has no model
  // and cannot write prose; refused with a sentence, never a throw.
  if (request.option.kind === 'keyword' || model === null) {
    return unavailable(NOT_IN_THIS_BUILD);
  }

  // ── The consent gate (Apple 5.1.2(i)) ────────────────────────────────────
  // The same check `runExtraction` makes, from the same file, for the same
  // reason — and with more at stake, because the CV goes too. Only the two
  // cloud kinds reach it, and it is refused BEFORE `createTransport()` is ever
  // called. See `runFollowUp.consent.test.ts`.
  if (isCloudKind(request.option.kind)) {
    const consented = await hasConsent(request.option.kind);
    if (!consented) {
      const label = providerLabel(request.option.kind);
      // Reached only when the panel's own dialog (L-171) and this check
      // disagree — a consent withdrawn between the press and the run, or a
      // store that could not be read. The route it names is the button the
      // user just pressed; never "grant it elsewhere", the detour L-171 closed.
      return unavailable(
        `${label} needs your permission before your CV and the advert can be sent to it. ` +
          'Press the draft button again and the app will ask — or write the note by hand.',
      );
    }
  }

  const provider = providerFor(request.option, createTransport());
  if (provider === null) return unavailable(NOT_IN_THIS_BUILD);

  const result = await draftFollowUp({
    provider,
    model,
    kind: request.kind,
    jobTitle: request.jobTitle,
    company: request.company,
    daysQuiet: request.daysQuiet,
    materials: request.materials,
    writingStyle: request.writingStyle,
  });

  return result.ok
    ? { available: true, draft: result.value.draft, meta: result.value.meta }
    : unavailable(result.error.message);
}
