// @vitest-environment jsdom
/**
 * The four AI key cards L-177 added: Google Gemini, Mistral, xAI Grok and
 * OpenRouter.
 *
 * Every card is built by the same `buildAiKeyProvider` and rendered by the same
 * `AiKeyCard`, so the OpenAI and Anthropic suites already cover the machinery.
 * This file proves the four are wired to their OWN credential slot and host,
 * that each obeys test-before-save, and that the copy each one carries is the
 * copy that is true of that provider.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { err, type Result } from '@cviper/core-types';

import {
  createFakeBrowserPort,
  type FakeBrowserPort,
} from '../../../platform/test/fakeBrowserPort';
import { providerOptions } from '../../analysis/providers';
import { OUTBOUND_HOST_NAMES } from '../../../lib/outbound-hosts';

import { AiKeySetup } from './AiKeySetup';
import {
  AI_KEY_PROVIDERS,
  GOOGLE_KEY_PROVIDER,
  GROK_KEY_PROVIDER,
  MISTRAL_KEY_PROVIDER,
  OPENROUTER_KEY_PROVIDER,
  type AiKeyProviderId,
} from './aiKeyModel';
import { AI_KEY_PROVIDER_IDS } from './aiKeyProviders';
import { type AiKeyTestFailure } from './aiKeyPort';
import { createFakeAiKeyPort, type FakeAiKeyPort } from './test/fakeAiKeyPort';

const NEW_IDS = [
  'google',
  'mistral',
  'grok',
  'openrouter',
] as const satisfies readonly AiKeyProviderId[];

const SENTINEL = 'NEWPROVIDER-SENTINELVALUE1234';

interface Harness {
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly browser: FakeBrowserPort;
}

function renderWith(ports: Partial<Record<AiKeyProviderId, FakeAiKeyPort>>): Harness {
  const user = userEvent.setup();
  const browser = createFakeBrowserPort();
  render(<AiKeySetup ports={ports} browser={browser} />);
  return { user, browser };
}

async function testKey(user: Harness['user'], id: AiKeyProviderId, key: string): Promise<void> {
  const input = screen.getByTestId(`ai-key-input-${id}`);
  input.focus();
  await user.paste(key);
  await user.click(screen.getByTestId(`ai-key-test-${id}`));
}

afterEach(() => {
  cleanup();
});

describe('all six cards, in registry order', () => {
  it('renders one card per provider, OpenAI and Anthropic first', async () => {
    renderWith({});
    await screen.findByTestId('ai-key-card-openrouter');

    const cards = [...document.querySelectorAll('[data-testid^="ai-key-card-"]')].map((card) =>
      card.getAttribute('data-testid')?.replace('ai-key-card-', ''),
    );
    expect(cards).toEqual([...AI_KEY_PROVIDER_IDS]);
    expect(cards).toEqual(['openai', 'anthropic', 'google', 'mistral', 'grok', 'openrouter']);
  });
});

describe.each(NEW_IDS.map((id) => [id] as const))('the %s card', (id) => {
  it('saves the key only after the provider has accepted it, and the picker then offers it', async () => {
    const port = createFakeAiKeyPort();
    const { user } = renderWith({ [id]: port });
    await screen.findByTestId(`ai-key-card-${id}`);
    expect(port.saved()).toBeNull();

    await testKey(user, id, SENTINEL);
    await screen.findByTestId(`ai-key-result-${id}`);

    expect(port.tested()).toEqual([SENTINEL]);
    expect(port.saved()).toBe(SENTINEL);

    const flag = `${id}Key` as const;
    const offered = providerOptions({
      ollamaRunning: false,
      ollamaModels: [],
      anthropicKey: false,
      openaiKey: false,
      [flag]: true,
    });
    const option = offered.find((candidate) => candidate.kind === id);
    expect(option, `${id} is offered once its key is saved`).toBeDefined();
    expect(option?.needsKey).toBe(true);
    expect(option?.local).toBe(false);
    expect(option?.label).toContain(AI_KEY_PROVIDERS[id].label);
  });

  it('negative: a refused key is reported and never saved', async () => {
    const port = createFakeAiKeyPort();
    const refusal: Result<void, AiKeyTestFailure> = err({
      message: `${AI_KEY_PROVIDERS[id].label} did not accept that key.`,
    });
    port.nextTest(refusal);
    const { user } = renderWith({ [id]: port });
    await screen.findByTestId(`ai-key-card-${id}`);

    await testKey(user, id, SENTINEL);

    const problem = await screen.findByTestId(`ai-key-problem-${id}`);
    expect(problem.textContent).toContain(AI_KEY_PROVIDERS[id].label);
    expect(port.saved()).toBeNull();
    expect(port.calls.save).toBe(0);
  });

  it('boundary: an empty box is caught before any request, and names this provider', async () => {
    const port = createFakeAiKeyPort();
    const { user } = renderWith({ [id]: port });
    await screen.findByTestId(`ai-key-card-${id}`);

    await user.click(screen.getByTestId(`ai-key-test-${id}`));

    const error = await screen.findByTestId(`ai-key-error-${id}`);
    expect(error.textContent).toContain(`Paste your ${AI_KEY_PROVIDERS[id].label} API key`);
    expect(port.calls.test).toBe(0);
  });

  it('opens its own key page in the browser, on a host the registry discloses', async () => {
    const { user, browser } = renderWith({});
    await screen.findByTestId(`ai-key-card-${id}`);

    await user.click(screen.getByTestId(`ai-key-signup-${id}`));

    const url = AI_KEY_PROVIDERS[id].signupUrl;
    expect(browser.opened()).toEqual([url]);
    expect(url.startsWith('https://')).toBe(true);
    expect(OUTBOUND_HOST_NAMES.has(new URL(url).hostname)).toBe(true);
  });

  it('never shows any part of the key once it is saved', async () => {
    const port = createFakeAiKeyPort(SENTINEL);
    renderWith({ [id]: port });
    const card = await screen.findByTestId(`ai-key-card-${id}`);

    await within(card).findByText('••••');
    expect(document.body.innerHTML).not.toContain('1234');
    expect(document.body.innerHTML).not.toContain('SENTINEL');
  });
});

describe('the copy each card carries is true of that provider', () => {
  it('uses the article the name is spoken with', () => {
    expect(GOOGLE_KEY_PROVIDER.signupLabel).toBe('Where do I get a Google Gemini key?');
    expect(MISTRAL_KEY_PROVIDER.signupLabel).toBe('Where do I get a Mistral key?');
    // "ex-A-I": a consonant letter, a vowel sound.
    expect(GROK_KEY_PROVIDER.signupLabel).toBe('Where do I get an xAI Grok key?');
    expect(OPENROUTER_KEY_PROVIDER.signupLabel).toBe('Where do I get an OpenRouter key?');
  });

  it('Google says what its free tier does with what is sent', () => {
    expect(GOOGLE_KEY_PROVIDER.billing).toContain('free tier');
    expect(GOOGLE_KEY_PROVIDER.billing).toContain('improve its products');
  });

  it('OpenRouter says it passes the request on, and to whom for the default model', () => {
    expect(OPENROUTER_KEY_PROVIDER.billing).toContain('passes each request on');
    expect(OPENROUTER_KEY_PROVIDER.billing).toContain('OpenAI');
  });

  it('negative: no card claims a key has a prefix that some keys do not have', () => {
    for (const id of AI_KEY_PROVIDER_IDS) {
      expect(AI_KEY_PROVIDERS[id].fieldHint).not.toContain('prefix');
    }
  });

  it('negative: no billing sentence quotes a price nobody measured', () => {
    for (const id of NEW_IDS) {
      expect(AI_KEY_PROVIDERS[id].billing).not.toMatch(/[£$€]\s?\d|\d+\s?p\b|pence/);
    }
  });
});
