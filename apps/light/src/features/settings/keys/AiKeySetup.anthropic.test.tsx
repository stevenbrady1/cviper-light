// @vitest-environment jsdom
/**
 * The Anthropic key card (L-149).
 *
 * ============================================================================
 * WHY THIS IS A SEPARATE FILE FROM `AiKeySetup.test.tsx`
 * ============================================================================
 * That file is the exhaustive, pinned proof for the OpenAI card — every
 * failure sentence, every leak surface, the aria wiring. Re-running the same
 * sweep here would test the shared component twice for no new information.
 * What is actually new is that a SECOND provider exists at all: this file
 * proves the same test-before-save guarantee holds for it, and that saving
 * its key makes the analysis picker offer it — the whole point of the card.
 *
 * `AiKeySetup` now renders one card per id in `AI_KEY_PROVIDER_IDS`, so both
 * cards are on screen in every test here; only the Anthropic one is driven.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { err, type Result } from '@cviper/core-types';

import {
  createFakeBrowserPort,
  type FakeBrowserPort,
} from '../../../platform/test/fakeBrowserPort';
import { providerOptions, type ProviderOption } from '../../analysis/providers';

import { AiKeySetup } from './AiKeySetup';
import { ANTHROPIC_KEY_PROVIDER } from './aiKeyModel';
import { type AiKeyTestFailure } from './aiKeyPort';
import { createFakeAiKeyPort, type FakeAiKeyPort } from './test/fakeAiKeyPort';

const SENTINEL = 'sk-ant-SENTINELVALUE1234';

/**
 * Worded the way `key_test_message(ProviderId::Anthropic, Refused)` in
 * `providers.rs` would build it — `{name} did not accept that key…` — but not
 * pinned against it: only OpenAI's wording is pinned there (see
 * `the_card_repeats_these_sentences_word_for_word`), because the card is
 * generic and Rust already proves the SHAPE is the same for every provider.
 */
const ANTHROPIC_REFUSED =
  'Anthropic did not accept that key. Check it was pasted whole — a brand new key can take a ' +
  'few minutes to become active.';

interface Harness {
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly port: FakeAiKeyPort;
  readonly browser: FakeBrowserPort;
}

function renderCard(port = createFakeAiKeyPort()): Harness {
  const user = userEvent.setup();
  const browser = createFakeBrowserPort();
  render(<AiKeySetup ports={{ anthropic: port }} browser={browser} />);
  return { user, port, browser };
}

async function testKey(user: Harness['user'], key: string): Promise<void> {
  const input = screen.getByTestId('ai-key-input-anthropic');
  input.focus();
  await user.paste(key);
  await user.click(screen.getByTestId('ai-key-test-anthropic'));
}

afterEach(() => {
  cleanup();
});

describe('the second card behaves exactly like the first', () => {
  it('saves the key only once Anthropic has answered, and the analysis option then appears', async () => {
    const { user, port } = renderCard();
    await screen.findByTestId('ai-key-card-anthropic');

    expect(port.saved()).toBeNull();

    await testKey(user, SENTINEL);
    await screen.findByTestId('ai-key-result-anthropic');

    // The order is the feature: tested first, saved only after.
    expect(port.calls.test).toBe(1);
    expect(port.tested()).toEqual([SENTINEL]);
    expect(port.saved()).toBe(SENTINEL);

    // The whole point of the card (L-102): the picker only offers what
    // Settings can actually set up, and now it can set up Anthropic.
    const offered = providerOptions({
      ollamaRunning: false,
      ollamaModels: [],
      anthropicKey: true,
      openaiKey: false,
    });
    const anthropic = offered.find((option) => option.kind === 'anthropic') as
      ProviderOption | undefined;
    expect(anthropic).toBeDefined();
    expect(anthropic?.label).toContain('Anthropic');
  });
});

describe('a key Anthropic rejects is never saved', () => {
  it('negative: a refused key is reported and NOT written to the credential store', async () => {
    const port = createFakeAiKeyPort();
    const refusal: Result<void, AiKeyTestFailure> = err({ message: ANTHROPIC_REFUSED });
    port.nextTest(refusal);
    const { user } = renderCard(port);
    await screen.findByTestId('ai-key-card-anthropic');

    await testKey(user, SENTINEL);

    const problem = await screen.findByTestId('ai-key-problem-anthropic');
    expect(problem.textContent ?? '').toBe(ANTHROPIC_REFUSED);
    expect(port.saved()).toBeNull();
    expect(port.calls.save).toBe(0);
  });
});

describe('what was typed, before anything is sent', () => {
  it('boundary: an empty box is caught here, without a request, and names Anthropic', async () => {
    const { user, port } = renderCard();
    await screen.findByTestId('ai-key-card-anthropic');

    await user.click(screen.getByTestId('ai-key-test-anthropic'));

    expect((await screen.findByTestId('ai-key-error-anthropic')).textContent ?? '').toContain(
      'Paste your Anthropic API key',
    );
    expect(port.calls.test).toBe(0);
    expect(port.saved()).toBeNull();
  });
});

describe('where to get a key', () => {
  it('opens Anthropic’s key page in the real browser, on a registered host', async () => {
    const { user, browser } = renderCard();
    await screen.findByTestId('ai-key-card-anthropic');

    await user.click(screen.getByTestId('ai-key-signup-anthropic'));

    expect(browser.opened()).toEqual([ANTHROPIC_KEY_PROVIDER.signupUrl]);

    const { OUTBOUND_HOST_NAMES } = await import('../../../lib/outbound-hosts');
    const host = new URL(ANTHROPIC_KEY_PROVIDER.signupUrl).hostname;
    expect(host).toBe('console.anthropic.com');
    expect(OUTBOUND_HOST_NAMES.has(host)).toBe(true);
  });
});

describe('both cards are on screen together', () => {
  it('the Anthropic card sits alongside the OpenAI card, not in place of it', async () => {
    renderCard();

    expect(await screen.findByTestId('ai-key-card-anthropic')).toBeTruthy();
    expect(await screen.findByTestId('ai-key-card-openai')).toBeTruthy();
  });
});
