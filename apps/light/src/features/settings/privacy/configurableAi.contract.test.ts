/**
 * The configurable-AI reader, and what it now proves.
 *
 * ============================================================================
 * SUPERSEDED BY L-148 — READ THIS BEFORE CHANGING THE ASSERTIONS BELOW
 * ============================================================================
 * Until L-148 this file's whole job was "if a user can configure an AI
 * provider, the privacy paragraph and the generated policy must name it" —
 * because Settings → Privacy said "today that's OpenAI" and a shipped
 * Anthropic card would have made that sentence quietly false. That guard did
 * its job: L-149 added the Anthropic card, this file went red on cue, and
 * PRIVACY_SUMMARY was corrected to name both providers.
 *
 * The owner then reversed the policy the guard was protecting. L-148 (13
 * September 2026): "the product must not read as tied to one AI provider…
 * provider names belong only in the 'how to get a key' guidance, never in the
 * product's description of itself." PRIVACY_SUMMARY and the policy's
 * "Services you may choose to use" paragraph now say "the provider you
 * choose" and never name one — by design, and permanently, regardless of how
 * many providers become configurable. A guard that failed the build the
 * moment a THIRD provider gained a card — asking the paragraph to name it —
 * would be asking for the defect L-148 exists to remove.
 *
 * So the "must be named" and "must not be named while unconfigurable" checks
 * that used to live here are gone. The generic wording is pinned exactly in
 * `privacyCopy.test.tsx`, and the absence of any brand name on this and every
 * other product-level surface is `lib/no-provider-brand-in-product-copy
 * .contract.test.ts`'s job — a forbid-list that fires on a name appearing,
 * never on one being missing, so it cannot repeat this file's old mistake in
 * the opposite direction.
 *
 * What is left is genuinely still true either way: the regex that reads
 * `AiKeyProviderId` out of `aiKeyModel.ts` is real, general infrastructure —
 * `offeredProviders.contract.test.ts` and others lean on the same union for
 * the same reason — and Anthropic's reach is still honestly disclosed by host
 * name even though the summary paragraph no longer narrows to it by name.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../../lib/repo-scan.ts';

import { currentPrivacyPolicy } from './policyDocument';

const AI_KEY_MODEL_PATH = join(REPO_ROOT, 'apps/light/src/features/settings/keys/aiKeyModel.ts');

/**
 * The AI providers the key-entry UI can create a credential for.
 *
 * Read off the `AiKeyProviderId` union, which `aiKeyModel.ts` describes as
 * being a union precisely "so adding a provider later is a compile error at
 * every site that has to change". This makes it a build error at one more
 * site, and is reused wherever something needs the real, current list without
 * importing a runtime value that would close the module cycle `aiKeyProviders
 * .ts`'s own docblock explains.
 */
export function configurableAiProviderIds(source: string): string[] {
  const union = /export type AiKeyProviderId\s*=([^;]+);/.exec(source);
  return [...(union?.[1] ?? '').matchAll(/'([a-z0-9.\-_]+)'/g)].map((match) => match[1] ?? '');
}

const SOURCE = readFileSync(AI_KEY_MODEL_PATH, 'utf8');
const CONFIGURABLE = configurableAiProviderIds(SOURCE);

describe('the reader of the key-card list', () => {
  it('found the real union, and it is not empty', () => {
    // Anti-inert: a regex that stopped matching would clear every assertion
    // that leans on this list, which is the failure mode this repo keeps
    // hitting.
    expect(CONFIGURABLE.length).toBeGreaterThan(0);
    expect(CONFIGURABLE).toContain('openai');
    // L-149: Anthropic joined OpenAI as a configurable provider.
    expect(CONFIGURABLE).toContain('anthropic');
  });

  it('would see a third provider the day one is added', () => {
    // Proof the extractor can return more than two, on a planted source — so
    // "openai and anthropic" is a fact about the app, not about a matcher that
    // stopped at the first pipe.
    expect(
      configurableAiProviderIds(
        "export type AiKeyProviderId = 'openai' | 'anthropic' | 'mistral';",
      ),
    ).toEqual(['openai', 'anthropic', 'mistral']);
    expect(configurableAiProviderIds('nothing here')).toEqual([]);
  });
});

describe('Anthropic is disclosed as somewhere the app CAN reach', () => {
  it('the generated policy still names the host, even though the summary no longer narrows to it', () => {
    // The paragraph used to narrow the CHOICE by name; the generated host list
    // states the REACH, and always has. L-148 stopped the paragraph naming any
    // provider, choosable or not — this is the half of the old disclosure that
    // survives unconditionally, because it was never about naming a provider,
    // only about naming an address the code can contact.
    expect(currentPrivacyPolicy()).toContain('api.anthropic.com');
    expect(currentPrivacyPolicy()).toContain('api.openai.com');
  });
});
