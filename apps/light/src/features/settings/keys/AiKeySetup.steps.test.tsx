// @vitest-environment jsdom
/**
 * L-293 — the AI key screen says what to do, in three plain steps.
 *
 * The audit's walk-through lost a non-technical user here: "API key", six
 * company names and "model", with nothing saying what a key is or which
 * button to press. The steps quote the cards' REAL button labels, so a
 * renamed button fails this test rather than leaving the steps pointing at
 * something that is not there.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeBrowserPort } from '../../../platform/test/fakeBrowserPort';

import { AiKeySetup } from './AiKeySetup';
import { type AiKeyProviderId } from './aiKeyModel';
import { AI_KEY_PROVIDER_IDS } from './aiKeyProviders';
import { createFakeAiKeyPort, type FakeAiKeyPort } from './test/fakeAiKeyPort';

function renderSetup(): void {
  const ports: Partial<Record<AiKeyProviderId, FakeAiKeyPort>> = {};
  for (const id of AI_KEY_PROVIDER_IDS) ports[id] = createFakeAiKeyPort();
  render(<AiKeySetup ports={ports} browser={createFakeBrowserPort()} />);
}

afterEach(() => {
  cleanup();
});

describe('three plain steps above the AI cards (L-293)', () => {
  it('is three numbered steps, before the first card', () => {
    renderSetup();
    const steps = screen.getByTestId('ai-keys-steps');
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
    const firstCard = screen.getByTestId(`ai-key-signup-${AI_KEY_PROVIDER_IDS[0]}`);
    // DOCUMENT_POSITION_FOLLOWING: the card comes after the steps.
    expect(
      steps.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('names the buttons the cards really have', () => {
    renderSetup();
    const text = screen.getByTestId('ai-keys-steps').textContent ?? '';
    const signup = screen.getByTestId(`ai-key-signup-${AI_KEY_PROVIDER_IDS[0]}`).textContent ?? '';
    expect(signup).toMatch(/^Where do I get /);
    expect(text).toContain('Where do I get');
    expect(
      screen.getAllByRole('button', { name: 'Test and save this key' }).length,
    ).toBeGreaterThan(0);
    expect(text).toContain('Test and save this key');
  });

  it('says you only need one, and where the key is kept', () => {
    renderSetup();
    const text = screen.getByTestId('ai-keys-steps').textContent ?? '';
    expect(text).toMatch(/only need one/i);
    expect(text).toMatch(/password store/i);
  });

  // NEGATIVE — the steps are for someone who does not know the jargon.
  it('uses no jargon and recommends no company', () => {
    renderSetup();
    const text = screen.getByTestId('ai-keys-steps').textContent ?? '';
    expect(text).not.toMatch(/\bAPI\b|\bmodel\b|Ollama|token|endpoint/i);
    for (const brand of ['OpenAI', 'Anthropic', 'Google', 'Gemini', 'Mistral', 'xAI', 'Grok']) {
      expect(text, brand).not.toContain(brand);
    }
  });
});
