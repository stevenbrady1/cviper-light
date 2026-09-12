/**
 * The app must not OFFER an AI provider it cannot SET UP (L-102).
 *
 * ============================================================================
 * THE DEFECT THIS PINS
 * ============================================================================
 * `features/settings/keys/model.ts` carries key cards for Adzuna and Reed, and
 * `features/settings/keys/aiKeyModel.ts` carries exactly one AI card: OpenAI.
 * There has never been an Anthropic card. Every other link in the Anthropic
 * chain, however, is live:
 *
 *   * `SecretKey::AnthropicApiKey` is a real variant, and `secret_set` is an
 *     exposed IPC command that accepts it;
 *   * a credential store SURVIVES AN UNINSTALL, so a key written by an older
 *     build — or by any other means — is still there on a fresh install;
 *   * `readAvailability` reads it and reports `anthropicKey: true`;
 *   * `providerOptions` turned that into an "Anthropic · <model>" row in the
 *     analysis picker, and `extractionOptions` inherited the same row;
 *   * `runAnalysis` would then send the user's CV to `api.anthropic.com`;
 *   * and `providers.rs` told that user to "Add one in Settings", where no such
 *     card exists.
 *
 * So the app offered a provider whose setup screen does not exist, and whose
 * only route to a working key was one the user was never given.
 *
 * ============================================================================
 * WHERE THE RULE IS ENFORCED, AND WHY THERE RATHER THAN IN `readAvailability`
 * ============================================================================
 * In `providerOptions`. The first assertion below is the whole argument: the
 * credential store still reports the key HONESTLY — `anthropicKey` is `true`,
 * because a key really is saved — and the picker still does not offer it.
 *
 * `Availability` is documented as "What this machine actually has", and gating
 * inside `readAvailability` would have made it say `false` about a key that is
 * genuinely present. That is a different sentence: "we cannot see it" rather
 * than "we do not offer it". Only one of those is true, and only one of them
 * leaves the status surfaces able to tell a missing key from a hidden one.
 *
 * ============================================================================
 * WHY THE GUARD IS A DERIVATION AND NOT A LIST OF NAMES
 * ============================================================================
 * A guard that said "Anthropic must not be offered" would fix one provider and
 * nothing else: the next cloud provider added without a card repeats the bug,
 * and the guard stays green while it does. So the rule is stated as a
 * relationship — EVERY cloud option the picker can produce must have a key card
 * behind it — and `providerOptions` reads the very same list, so an Anthropic
 * card arriving switches the option back on without anybody editing this file.
 *
 * Two legs, because one is not enough:
 *
 *   1. offered ⊆ `AI_KEY_PROVIDER_IDS` — nothing is offered that cannot be set
 *      up. Swept over every combination of availability, so it is the property
 *      rather than an example of it.
 *   2. `AI_KEY_PROVIDER_IDS` = the `AiKeyProvider` cards that actually exist.
 *      Without this, leg 1 is only as good as a hand-maintained list, and a
 *      card added to `aiKeyModel.ts` without a matching id would be a card the
 *      user can fill in for a provider the picker still refuses to show.
 *
 * ============================================================================
 * THE SIBLING GUARD, AND THE ASSUMPTION IT WAS RESTING ON
 * ============================================================================
 * `settings/privacy/configurableAi.contract.test.ts` (L-91) already watches the
 * same key-card list from the other end: every provider a user CAN configure
 * must be named in the privacy paragraph and in the generated policy. Its
 * docblock explains that it is keyed on configurability rather than on the Rust
 * enum because "Anthropic is reachable in Rust and has no card, SO NO USER CAN
 * CHOOSE IT".
 *
 * That last clause was the bit that was not true, and this file is what makes
 * it true. Anthropic had no card and was offered in the picker anyway, on the
 * strength of a key sitting in the credential store — so a user could choose
 * it, and the privacy paragraph scoped to "today that's OpenAI" was narrower
 * than what the app would actually do. The two guards now meet: one keeps the
 * copy honest about what can be configured, this one keeps the PICKER honest
 * about the same list.
 */
import { describe, expect, it, vi } from 'vitest';

import * as aiKeyModel from '../settings/keys/aiKeyModel';
import { AI_KEY_PROVIDER_IDS } from '../settings/keys/aiKeyProviders';

import { providerOptions, type Availability } from './providers';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { readAvailability } = await import('./availability');

const LLAMA = { id: 'llama3.2:3b', label: 'llama3.2:3b (3.2B)' };

/** Every combination of the things that can be set up on a machine. */
const EVERY_AVAILABILITY: Availability[] = [false, true].flatMap((anthropicKey) =>
  [false, true].flatMap((openaiKey) =>
    [[], [LLAMA]].map((ollamaModels) => ({
      ollamaRunning: ollamaModels.length > 0,
      ollamaModels,
      anthropicKey,
      openaiKey,
    })),
  ),
);

describe('a saved key with no key card is not offered', () => {
  it('does not offer Anthropic even when its key is in the credential store', async () => {
    tauri.invoke.mockReset();
    tauri.invoke.mockImplementation(async (command, args) => {
      if (command === 'ollama_probe') return null;
      if (command === 'secret_status') return args?.['key'] === 'anthropic_api_key';
      throw new Error(`unexpected command: ${command}`);
    });

    const availability = await readAvailability();

    // The report is UNCHANGED and still true: the key really is there. This is
    // the half that proves the rule lives in the picker rather than in the
    // probe — a gate inside `readAvailability` would fail this line.
    expect(availability.anthropicKey).toBe(true);

    const offered = providerOptions(availability).map((option) => option.kind);

    expect(offered).not.toContain('anthropic');
    expect(offered).toEqual(['keyword']);
  });
});

describe('guard: the app offers only what it can set up', () => {
  it('every cloud provider it can offer has a key card in Settings', () => {
    const offeredCloudKinds = new Set(
      EVERY_AVAILABILITY.flatMap((availability) =>
        providerOptions(availability)
          .filter((option) => option.needsKey)
          .map((option) => option.kind),
      ),
    );

    // Anti-inert. A `providerOptions` that returned nothing, or a sweep that
    // produced no cloud options at all, would satisfy the loop below without
    // asking a single question — which is exactly how a guard in this repo goes
    // quietly green. The set must be non-empty for the check to mean anything.
    expect(offeredCloudKinds.size, 'the sweep produced no cloud options to check').toBeGreaterThan(
      0,
    );

    for (const kind of offeredCloudKinds) {
      expect(
        AI_KEY_PROVIDER_IDS as readonly string[],
        `"${kind}" is offered in the picker, but Settings has no key card for it. Either add ` +
          'the card (and its id to AI_KEY_PROVIDER_IDS), or stop offering it.',
      ).toContain(kind);
    }
  });

  it('the key-card list is exactly the cards that actually exist', () => {
    const cards = Object.values(aiKeyModel).filter(isAiKeyProvider);

    // Anti-inert: the module really was read and really does export cards. A
    // renamed export would otherwise empty both sides and pass.
    expect(cards.length, 'no AiKeyProvider cards were found in aiKeyModel.ts').toBeGreaterThan(0);

    expect(cards.map((card) => card.id).sort()).toEqual([...AI_KEY_PROVIDER_IDS].sort());
  });
});

/** Is this export one of the key cards? Shape-checked, so a rename cannot hide one. */
function isAiKeyProvider(value: unknown): value is aiKeyModel.AiKeyProvider {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<aiKeyModel.AiKeyProvider>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.secret === 'string' &&
    typeof candidate.signupUrl === 'string' &&
    typeof candidate.privacyNote === 'string'
  );
}
