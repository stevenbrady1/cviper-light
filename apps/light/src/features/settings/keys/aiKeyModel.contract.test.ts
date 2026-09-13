/**
 * Every AI key card's `secret` matches its own `id` (C2, coordinator review
 * of PR #96).
 *
 * ============================================================================
 * THE DEFECT THIS PINS
 * ============================================================================
 * `AiKeyProvider.secret` used to be a bare `string`, and nothing checked that
 * a card's `secret` actually named the SAME provider as its `id`. Nothing in
 * the type system, and nothing at runtime, would have caught the Anthropic
 * card being built with `secret: OPENAI_SECRET_KEY` by mistake: it would
 * still satisfy `AiKeyProvider`, `offeredProviders.contract.test.ts`'s
 * `the key-card list is exactly the cards that actually exist` only checks
 * `id`, and `AiKeySetup.tsx` calls
 * `createTauriAiKeyPort(provider.secret, provider.id)` trusting both
 * arguments independently.
 *
 * The consequence is not a crash — it is silent data loss. Pressing "Test and
 * save this key" on the Anthropic card would test the pasted key against
 * `provider.id` ('anthropic', correct), and on success WRITE it into
 * `provider.secret` (`openai_api_key`, wrong) — overwriting the user's real,
 * working OpenAI key with an Anthropic one, with no error at any point.
 *
 * ============================================================================
 * WHY A TYPE (`AiKeySecret`) IS NOT ENOUGH ON ITS OWN
 * ============================================================================
 * `AiKeySecret` closes `secret` to the two real credential names, which stops
 * a MADE-UP string — but two real, valid `AiKeySecret` values can still be
 * swapped between two cards and the type checker cannot see it: both sides of
 * the mistake type-check. This test is the runtime half of the guarantee,
 * proved by mutation: swap the Anthropic card's `secret` to `OPENAI_SECRET_KEY`
 * and this fails by name, not just as a general "something is wrong".
 */
import { describe, expect, it } from 'vitest';

import { AI_KEY_PROVIDERS } from './aiKeyModel';
import { AI_KEY_PROVIDER_IDS } from './aiKeyProviders';

describe('every card’s secret matches its own id', () => {
  it.each(AI_KEY_PROVIDER_IDS.map((id) => [id] as const))(
    '%s: id and secret name the same provider',
    (id) => {
      const provider = AI_KEY_PROVIDERS[id];
      expect(provider.id).toBe(id);
      expect(provider.secret).toBe(`${id}_api_key`);
    },
  );

  it('anti-inert: the sweep covers more than one card', () => {
    // A sweep of one card could not distinguish "checks the pairing" from
    // "checks nothing" — a card wired to the wrong secret and a card wired to
    // the right one look identical if there is only ever one to compare.
    expect(AI_KEY_PROVIDER_IDS.length).toBeGreaterThan(1);
  });
});
