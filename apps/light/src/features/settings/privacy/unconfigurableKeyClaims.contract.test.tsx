// @vitest-environment jsdom
/**
 * A provider the app cannot SET UP is never described as one you have a key for
 * (L-105).
 *
 * ============================================================================
 * THE DEFECT THIS PINS
 * ============================================================================
 * `lib/outbound-hosts.ts` described `api.anthropic.com` as
 *
 *     "A CV analysis you start, sent with your own Anthropic key under your
 *      own Anthropic account."
 *
 * and that registry is the single source for two user-facing surfaces: the
 * live Settings → Privacy screen, and the generated, committed
 * `docs/app-store/privacy-policy.md`. So both of them told the reader they had
 * — or could have — an Anthropic key.
 *
 * Since L-102 no screen in this app can save one. `AI_KEY_PROVIDER_IDS` is
 * `['openai']`, the analysis picker offers only providers that have a key card
 * behind it, and `providers.rs` already says so in as many words: "No Anthropic
 * API key is saved, and this version of CViper has no screen for adding one."
 * The privacy copy was the last surface still claiming otherwise.
 *
 * The host itself is NOT the defect and stays in the registry. The Rust side
 * can genuinely reach `api.anthropic.com`, and that list states REACH — what
 * the code is allowed to name — not CHOICE. Deleting the entry would make the
 * screen that says "this is not a summary" into one. What had to change is the
 * sentence next to it.
 *
 * ============================================================================
 * KEYED ON THE KEY-CARD LIST, SO IT CHANGES VERDICT INSTEAD OF GOING STALE
 * ============================================================================
 * The cheap version of this guard is `expect(why).not.toContain('your own
 * Anthropic key')` — a string match on today's wording. It would pass the day
 * somebody reworded the claim without fixing it, and it would have to be
 * deleted by hand the day an Anthropic key card arrives and the claim becomes
 * TRUE.
 *
 * So the rule is a relationship, in the shape `offeredProviders.contract.test.ts`
 * (L-102) established: a possession claim is a DEFECT exactly while the
 * provider is absent from `AI_KEY_PROVIDER_IDS`, and acceptable as soon as it
 * is present. `the verdict follows the key-card list` below proves both halves
 * on the same sentence, so the flip is a property of the guard rather than
 * something a future reader has to take on trust.
 *
 * `AI_KEY_PROVIDER_IDS` rather than the `AiKeyProviderId` union that
 * `configurableAi.contract.test.ts` parses out of `aiKeyModel.ts`: it is a
 * runtime VALUE, so this needs no regular expression that could stop matching
 * and empty the guard, and L-102's second leg already pins it to the
 * `AiKeyProvider` cards that really exist, so it cannot drift from them.
 *
 * ============================================================================
 * WHY THERE IS NO "THE SWEEP FOUND SOMETHING TO CHECK" ASSERTION
 * ============================================================================
 * The obvious anti-inert leg — assert at least one provider is unconfigurable —
 * is the one thing this file must not do. It would turn the day an Anthropic
 * card lands into a RED build for a guard that had nothing to complain about,
 * and `configurableAi.contract.test.ts` records what happens next: "the likely
 * response to a guard that fails on arrival is to loosen it until it stops
 * asking the question".
 *
 * The inertness is answered where it can be answered without that cost: the
 * host→provider map is checked against the real registry, the detector is fed
 * claims it must catch AND honest copy it must let through, and the pure rule
 * is run over a planted registry so it is known to be able to produce a
 * finding at all.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * Nothing here asserts the copy CONTAINS a blessed sentence. Rewording the
 * entry is free; only a possession claim, or a change in what can be
 * configured, moves the verdict. This is the same division of labour as
 * `configurableAi.contract.test.ts`, which watches the other direction — that
 * a provider a user CAN configure is named. Together: configurable must be
 * named, unconfigurable must not be offered.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OUTBOUND_HOSTS, type OutboundHost } from '../../../lib/outbound-hosts';
import { AI_KEY_PROVIDER_IDS } from '../keys/aiKeyProviders';

import { currentPrivacyPolicy } from './policyDocument';
import { PrivacyNotice } from './PrivacyNotice';

afterEach(cleanup);

/**
 * Which registered host is a cloud AI provider, and how it is spelled where a
 * user can read it.
 *
 * A small table rather than a derivation, for the same reason
 * `configurableAi.contract.test.ts` keeps `DISPLAY_NAME` by hand: the mapping
 * from an address to a product name exists nowhere in one machine-readable
 * place, and inventing a source for it would be more to go wrong than the two
 * lines it replaces. `the map from host to AI provider` holds it against the
 * real registry so an entry that is renamed or removed fails instead of
 * silently dropping out of the sweep.
 *
 * Ollama is deliberately absent: `127.0.0.1` takes no key and never leaves the
 * machine, so there is no possession claim it could make.
 */
const AI_PROVIDER_HOSTS: Readonly<Record<string, { readonly id: string; readonly name: string }>> =
  {
    'api.openai.com': { id: 'openai', name: 'OpenAI' },
    'api.anthropic.com': { id: 'anthropic', name: 'Anthropic' },
  };

/**
 * Does this copy tell the reader the key is THEIRS — something they hold or
 * supply?
 *
 * That is the claim with the shelf life, and it is narrower than merely
 * mentioning the provider or even the words "<name> key". Saying the app can
 * reach a host IF a key is already in the credential store is a statement about
 * the machine; saying it carries "your own Anthropic key" is a statement about
 * the reader, and only the second one goes false when the key card does not
 * exist.
 */
export function claimsTheReaderHasAKey(text: string, name: string): boolean {
  const provider = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    // "your own OpenAI key", "your Anthropic key"
    new RegExp(`your (?:own )?${provider} key`, 'i'),
    // "the Anthropic key you registered yourself", "an Anthropic key you pasted"
    new RegExp(`${provider} key (?:that )?you \\w+`, 'i'),
    // "paste your Anthropic key", "add an Anthropic key in Settings"
    new RegExp(`(?:paste|add|enter|register)[a-z]* (?:your |an |a )?(?:own )?${provider}\\b`, 'i'),
  ].some((pattern) => pattern.test(text));
}

interface FalseKeyClaim {
  readonly host: string;
  readonly provider: string;
  readonly why: string;
}

/**
 * Every host whose copy offers a key for a provider that cannot be set up.
 *
 * Pure, and takes the configurable list as an argument, so the verdict can be
 * asked on a planted registry and on a planted key-card list — which is what
 * makes the flip below testable rather than hypothetical.
 */
export function falseKeyClaims(
  hosts: readonly OutboundHost[],
  configurable: readonly string[],
): FalseKeyClaim[] {
  return hosts.flatMap((entry) => {
    const provider = AI_PROVIDER_HOSTS[entry.host];
    if (provider === undefined) return [];
    if (configurable.includes(provider.id)) return [];
    if (!claimsTheReaderHasAKey(entry.why, provider.name)) return [];
    return [{ host: entry.host, provider: provider.name, why: entry.why }];
  });
}

/** The honest replacement, as shipped. Used only as a planted input. */
const HONEST_COPY =
  'A CV analysis you start, but only if an Anthropic key is already in this computer’s ' +
  'credential store. This version has no screen for adding one, so for most people it is ' +
  'never contacted.';

/** The claim this work item removed. Used only as a planted input. */
const CLAIMING_COPY =
  'A CV analysis you start, sent with your own Anthropic key under your own Anthropic account.';

describe('the map from host to AI provider', () => {
  it('names hosts that are really in the registry', () => {
    // Anti-inert: a host renamed or removed in `outbound-hosts.ts` would drop
    // out of every sweep below and take its claim with it, silently.
    const registered = new Set(OUTBOUND_HOSTS.map((entry) => entry.host));

    expect(Object.keys(AI_PROVIDER_HOSTS).length).toBeGreaterThan(0);
    for (const host of Object.keys(AI_PROVIDER_HOSTS)) {
      expect(registered.has(host), `${host} is not in outbound-hosts.ts`).toBe(true);
    }
  });
});

describe('the detector', () => {
  it('catches a possession claim however it is worded', () => {
    // Fed the real regression verbatim, plus the rewordings a fix might reach
    // for. A detector that only knew the one sentence would be a string match
    // wearing a function's clothes.
    expect(claimsTheReaderHasAKey(CLAIMING_COPY, 'Anthropic')).toBe(true);
    expect(claimsTheReaderHasAKey('sent with your Anthropic key.', 'Anthropic')).toBe(true);
    expect(claimsTheReaderHasAKey('the Anthropic key you registered yourself.', 'Anthropic')).toBe(
      true,
    );
    expect(claimsTheReaderHasAKey('Paste your Anthropic key in Settings.', 'Anthropic')).toBe(true);
    expect(claimsTheReaderHasAKey('Add an Anthropic key to use this.', 'Anthropic')).toBe(true);
  });

  it('lets an honest statement of REACH through', () => {
    // The distinction the whole guard rests on. If this went red, the only way
    // to satisfy the guard would be to stop disclosing Anthropic at all — which
    // is the opposite of what the privacy screen is for.
    expect(claimsTheReaderHasAKey(HONEST_COPY, 'Anthropic')).toBe(false);
    expect(
      claimsTheReaderHasAKey('Named only so the fetch-from-link guard can refuse it.', 'Anthropic'),
    ).toBe(false);
  });

  it('does not fire on a provider that is merely named', () => {
    expect(claimsTheReaderHasAKey('The request goes to Anthropic.', 'Anthropic')).toBe(false);
  });
});

describe('no user-facing surface offers a key for a provider that cannot be set up', () => {
  it('the registry makes no such claim', () => {
    expect(
      falseKeyClaims(OUTBOUND_HOSTS, AI_KEY_PROVIDER_IDS),
      'The "why" for each host above tells the reader they have a key for a provider that ' +
        'Settings has no card for, so no screen in this build can create one. Either describe ' +
        'the host as somewhere a key ALREADY on the machine could be used, or add the key card ' +
        '(and its id to AI_KEY_PROVIDER_IDS) and make the claim true.',
    ).toEqual([]);
  });

  it('the generated policy makes no such claim, and still discloses the host', () => {
    const policy = currentPrivacyPolicy();

    for (const [host, provider] of Object.entries(AI_PROVIDER_HOSTS)) {
      if ((AI_KEY_PROVIDER_IDS as readonly string[]).includes(provider.id)) continue;

      // Scanned whole rather than line by line: this asserts the ABSENCE of a
      // claim, so widening the haystack can only make it stricter.
      expect(policy, `${host} has stopped being disclosed in the policy`).toContain(host);
      expect(
        claimsTheReaderHasAKey(policy, provider.name),
        `docs/app-store/privacy-policy.md offers the reader a key for ${provider.name}. Regenerate ` +
          'it after fixing the registry: pnpm exec vitest run ' +
          'apps/light/src/features/settings/privacy/policyDocument.test.ts -u',
      ).toBe(false);
    }
  });

  it('the Settings → Privacy screen makes no such claim, and still discloses the host', () => {
    render(<PrivacyNotice />);
    const notice = screen.getByTestId('privacy-notice').textContent ?? '';

    for (const [host, provider] of Object.entries(AI_PROVIDER_HOSTS)) {
      if ((AI_KEY_PROVIDER_IDS as readonly string[]).includes(provider.id)) continue;

      // The RENDERED screen, not the module it is built from. A unit test on
      // the registry cannot see a surface that stopped rendering the entry.
      expect(notice, `${host} has stopped being shown on the Privacy screen`).toContain(host);
      expect(
        claimsTheReaderHasAKey(notice, provider.name),
        `Settings → Privacy offers the reader a key for ${provider.name}.`,
      ).toBe(false);
    }
  });
});

describe('the verdict follows the key-card list, not the wording', () => {
  const PLANTED: readonly OutboundHost[] = [
    { host: 'api.anthropic.com', purpose: 'fetched-with-your-key', why: CLAIMING_COPY },
  ];

  it('a possession claim is a defect while the provider has no key card', () => {
    expect(falseKeyClaims(PLANTED, ['openai'])).toEqual([
      { host: 'api.anthropic.com', provider: 'Anthropic', why: CLAIMING_COPY },
    ]);
  });

  it('the SAME sentence stops being a defect once a key card exists', () => {
    // The half that keeps this guard from being deleted later. Nothing about
    // the copy changed between these two assertions — only what the app can be
    // set up to do — and that is the only thing that should move the verdict.
    expect(falseKeyClaims(PLANTED, ['openai', 'anthropic'])).toEqual([]);
  });

  it('honest copy is never a defect, either way', () => {
    const honest: readonly OutboundHost[] = [
      { host: 'api.anthropic.com', purpose: 'fetched-with-your-key', why: HONEST_COPY },
    ];
    expect(falseKeyClaims(honest, ['openai'])).toEqual([]);
    expect(falseKeyClaims(honest, ['openai', 'anthropic'])).toEqual([]);
  });
});
