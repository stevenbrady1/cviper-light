// @vitest-environment jsdom
/**
 * The billing sentence is said once on Settings (L-321).
 *
 * Every provider card used to end with "CViper adds nothing to that, takes no
 * cut, and never sees your bill", under a line at the top that already says
 * CViper takes no cut. Six repeats of one sentence read as small print, and the
 * thing that really differs between the cards got lost in it.
 *
 * What must NOT go with it: each card still says who sends the user a bill. A
 * person who reads only one card must not come away thinking the key is free.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeFilePort } from '../../../platform/test/fakeFilePort';
import { Settings } from '../Settings';
import { createFakeBackupPort } from '../test/fakePort';
import { AI_KEY_PROVIDERS, type AiKeyProviderId } from './aiKeyModel';
import { AI_KEY_PROVIDER_IDS } from './aiKeyProviders';

const NOW = new Date(2026, 10, 3, 9, 0, 0);

/** Who bills, and what, on each card. The difference a card exists to say. */
const WHO_BILLS: Readonly<Record<AiKeyProviderId, string>> = {
  openai: 'OpenAI bills your own account for what you use',
  anthropic: 'Anthropic bills your own account for what you use',
  google: 'bills your own account beyond it',
  mistral: 'Mistral bills your own account for what you use',
  grok: 'xAI bills your own account for what you use',
  openrouter: 'OpenRouter bills your own prepaid credit',
};

function renderedSettings(): string {
  render(<Settings port={createFakeBackupPort()} filePort={createFakeFilePort()} now={NOW} />);
  return screen.getByTestId('view-settings').textContent ?? '';
}

function timesSaid(text: string, phrase: string): number {
  return text.split(phrase).length - 1;
}

function cardText(id: AiKeyProviderId): string {
  return screen.getByTestId(`ai-key-card-${id}`).textContent ?? '';
}

afterEach(() => {
  cleanup();
});

describe('Settings says the billing sentence once (L-321)', () => {
  it('"takes no cut" appears exactly once on the whole screen, in the line at the top', () => {
    const screenText = renderedSettings();

    expect(timesSaid(screenText, 'takes no cut')).toBe(1);
    expect(screen.getByTestId('ai-keys-cost').textContent).toContain('takes no cut');
  });

  it('"published rates" appears exactly once on the whole screen', () => {
    expect(timesSaid(renderedSettings(), 'published rates')).toBe(1);
  });

  it('boundary: the count covers every provider card, so it cannot pass by reading fewer', () => {
    renderedSettings();

    expect(AI_KEY_PROVIDER_IDS).toHaveLength(6);
    for (const id of AI_KEY_PROVIDER_IDS) {
      const card = screen.getByTestId(`ai-key-card-${id}`);
      expect(within(card).getByText(AI_KEY_PROVIDERS[id].billing)).toBeTruthy();
    }
  });

  it.each(AI_KEY_PROVIDER_IDS)('the %s card drops the shared sentence', (id) => {
    renderedSettings();

    for (const phrase of ['takes no cut', 'adds nothing', 'never sees your bill']) {
      expect(cardText(id), phrase).not.toContain(phrase);
    }
  });
});

describe('each card still says the key costs money (L-321)', () => {
  it.each(AI_KEY_PROVIDER_IDS)('negative: the %s card says who bills', (id) => {
    renderedSettings();

    expect(cardText(id)).toContain(WHO_BILLS[id]);
  });

  it('negative: OpenAI still says outright that the key is not free', () => {
    renderedSettings();

    expect(cardText('openai')).toContain('An OpenAI key is not free.');
  });

  it('negative: Google is the only card that mentions anything free, and it says the limit', () => {
    renderedSettings();

    expect(cardText('google')).toContain('a free tier with daily limits');
    for (const id of AI_KEY_PROVIDER_IDS.filter((other) => other !== 'google')) {
      const billing = AI_KEY_PROVIDERS[id].billing.replace('is not free', '');
      expect(billing, id).not.toMatch(/free/i);
    }
  });

  it('keeps what is different about each provider', () => {
    renderedSettings();

    expect(cardText('google')).toContain('improve its products');
    expect(cardText('openrouter')).toContain('passes each request on');
  });
});
