/**
 * The configurable-AI contract: if a user can set up an AI provider, the
 * privacy paragraph and the generated policy must name it.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Settings → Privacy says "today that's OpenAI, or a model running on your own
 * PC". That is a claim with a shelf life: the moment somebody ships an
 * Anthropic key card, the sentence is false and nothing else in the build would
 * notice. Copy that is true when written and false three commits later is
 * exactly the failure the reviewer caught twice on this paragraph already.
 *
 * ============================================================================
 * IT WATCHES THE KEY-CARD LIST, NOT THE RUST ENUM. THIS IS THE WHOLE POINT.
 * ============================================================================
 * The obvious implementation — compare the paragraph against the providers the
 * code KNOWS about — is wrong, and wrong in the way that gets a guard deleted.
 * `src-tauri/src/providers.rs` is a closed three-variant enum (Anthropic,
 * OpenAI, Ollama) and `anthropic_api_key` is already one of the five entries in
 * the `SecretKey` enum. A guard keyed on existence would therefore see
 * Anthropic on day one, compare it with a paragraph that does not name it, and
 * fail before anybody had changed anything. The likely response to a guard that
 * fails on arrival is to loosen it until it stops asking the question — which
 * is how this repository has lost guards before.
 *
 * So the key is CONFIGURABILITY: the providers the key-entry UI can actually
 * create a credential for. That is `keys/aiKeyModel.ts`'s `AiKeyProviderId`
 * union (one member, `openai`, plus `OPENAI_KEY_PROVIDER`, the card added in
 * #26) alongside the job boards in `keys/model.ts`. Anthropic is reachable in
 * Rust and has no card, so no user can choose it — which is precisely what
 * makes "what you can configure today" a true statement rather than a dodge.
 *
 * Keyed that way the guard is green now and fires on exactly one event: an
 * Anthropic (or any other) key card appearing in the card list.
 *
 * ============================================================================
 * WHAT AN AUTHOR OWES WHEN IT FIRES — AND WHAT THEY DO NOT
 * ============================================================================
 * Two files: the paragraph in `PrivacyNotice.tsx`, and the generated policy
 * (which follows automatically once `policyDocument.ts` reads the same truth).
 *
 * They do NOT owe a change to the per-provider consent gate in `runAnalysis.ts`
 * (L-97, PR #35). Its `ConsentProviderKind` is `Exclude<ProviderId, 'ollama'>`,
 * so Anthropic is already covered and is named at the moment of the call. This
 * note is here so nobody reads a red build as "the consent work must change
 * too" and goes looking for work that does not exist.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * The rule is "a configurable provider must not be ABSENT from the copy". It
 * never asserts the paragraph contains a particular sentence, so rewording it
 * is free and only a change in what is CONFIGURABLE can turn it red.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../../lib/repo-scan.ts';

import { currentPrivacyPolicy } from './policyDocument';
import { PRIVACY_SUMMARY } from './PrivacyNotice';

const AI_KEY_MODEL_PATH = join(REPO_ROOT, 'apps/light/src/features/settings/keys/aiKeyModel.ts');

/** How each provider id is spelled where a user can read it. */
const DISPLAY_NAME: Readonly<Record<string, string>> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

/**
 * The AI providers the key-entry UI can create a credential for.
 *
 * Read off the `AiKeyProviderId` union, which `aiKeyModel.ts` describes as
 * being a union precisely "so adding Anthropic later is a compile error at
 * every site that has to change". This makes it a build error at one more site.
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
    // below for ever, which is the failure mode this repo keeps hitting.
    expect(CONFIGURABLE.length).toBeGreaterThan(0);
    expect(CONFIGURABLE).toContain('openai');
  });

  it('would see a second provider the day one is added', () => {
    // Proof the extractor can return more than one, on a planted source — so
    // "only openai" is a fact about the app, not about a broken matcher.
    expect(
      configurableAiProviderIds("export type AiKeyProviderId = 'openai' | 'anthropic';"),
    ).toEqual(['openai', 'anthropic']);
    expect(configurableAiProviderIds('nothing here')).toEqual([]);
  });
});

describe('every configurable AI provider is named in the privacy copy', () => {
  it.each(CONFIGURABLE.map((id) => [id] as const))('%s is in the paragraph', (id) => {
    const name = DISPLAY_NAME[id] ?? id;
    expect(
      PRIVACY_SUMMARY,
      `A user can configure ${name}, so Settings → Privacy must say so. Update PRIVACY_SUMMARY ` +
        'in PrivacyNotice.tsx and regenerate docs/app-store/privacy-policy.md in the same ' +
        'change. The consent gate in runAnalysis.ts (L-97) needs nothing.',
    ).toContain(name);
  });

  /**
   * The policy sentence that lists which keys a user can PASTE.
   *
   * Targeted deliberately rather than searching the whole document. The
   * generated host list already contains the word "Anthropic" — `api.anthropic.com`
   * is a registered host and rightly disclosed — so a document-wide `toContain`
   * is satisfied by the statement of REACH and never notices that the statement
   * of CHOICE has gone stale.
   *
   * That is not a hypothetical: the first version of this leg was keyed on the
   * whole document, and under the Anthropic mutation it stayed GREEN while the
   * paragraph leg went red. An assertion that cannot fail is worse than none,
   * because everybody believes it.
   */
  function pasteableKeysSentence(): string {
    const line = currentPrivacyPolicy()
      .split('\n')
      .find((candidate) => candidate.startsWith('If you paste an API key'));
    expect(line, 'the policy has no sentence listing which keys can be pasted').toBeDefined();
    return line ?? '';
  }

  it('the policy still has a sentence listing which keys can be pasted', () => {
    // Anti-inert: a reworded policy would otherwise make every assertion below
    // vacuous by matching an empty string.
    expect(pasteableKeysSentence()).toContain('API key');
  });

  it.each(CONFIGURABLE.map((id) => [id] as const))('%s is named as a key you can paste', (id) => {
    const name = DISPLAY_NAME[id] ?? id;
    expect(
      pasteableKeysSentence(),
      `${name} is configurable but the policy's "keys you can paste" sentence does not list it.`,
    ).toContain(name);
  });
});

describe('a provider that is NOT configurable is not claimed to be', () => {
  it('the paragraph does not offer Anthropic while no card can create its key', () => {
    // The other direction, and the reason this is not an allow-list. While
    // Anthropic has no key card the paragraph must not imply it is choosable;
    // the day a card lands, this assertion stops applying on its own rather
    // than becoming a second thing to remember to delete.
    if (CONFIGURABLE.includes('anthropic')) return;
    expect(PRIVACY_SUMMARY).not.toContain('Anthropic');
  });

  it('Anthropic is still disclosed as somewhere the app CAN reach', () => {
    // The paragraph narrows the CHOICE; the generated host list states the
    // REACH. If this ever stopped being true, the paragraph would be the only
    // thing a user saw and Anthropic would have gone silent — which is the
    // opposite of what the scoping is for.
    expect(currentPrivacyPolicy()).toContain('api.anthropic.com');
  });
});
