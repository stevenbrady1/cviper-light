/**
 * How a chosen option becomes a provider adapter — shared by the three run
 * modules in this folder, and the sentences they refuse with.
 *
 * Deliberately NOT the consent gate. Each run module holds its own
 * `hasConsent(` check ahead of its own `createTransport()`, because
 * `lib/ai-call-sites-consent.contract.test.ts` reads every module that can
 * build the transport and wants to see the check IN that module, in that
 * order. A gate hidden inside a helper would be one the guard could not
 * order, and a helper that builds the transport would be one more call site.
 */
import {
  createAnthropicProvider,
  createOllamaProvider,
  createOpenAiProvider,
  type AiProvider,
  type ChatTransport,
} from '@cviper/ai-providers';

import { providerLabel } from '../analysis/model';
import { type ProviderOption } from '../analysis/providers';
import { type ConsentProviderKind } from '../analysis/consent';

export function providerFor(option: ProviderOption, transport: ChatTransport): AiProvider | null {
  switch (option.kind) {
    case 'ollama':
      return createOllamaProvider(transport);
    case 'anthropic':
      return createAnthropicProvider(transport);
    case 'openai':
      return createOpenAiProvider(transport);
    case 'keyword':
      // Unreachable: `tailorOptions` filters this out before a user can pick
      // it, and every run module refuses it before reaching here. Answered
      // with `null` rather than a throw so a future option added to the union
      // becomes a message, not a blank screen.
      return null;
  }
}

/** Said when the basic match is asked to write. It cannot. */
export const KEYWORD_CANNOT_WRITE =
  'The basic match compares words; it cannot write. Choose a local model or your own key.';

/** Said when a chosen option has no adapter in this build. */
export const OPTION_UNAVAILABLE =
  'That way of running this is not available in this build. Choose another option.';

/** Said when a cloud kind is chosen and the user has not agreed to it yet. */
export function consentRefusal(kind: ConsentProviderKind): string {
  return (
    `${providerLabel(kind)} needs your permission before your CV and the advert can be ` +
    'sent to it. Choose to allow it when asked, or pick another way to run this.'
  );
}
