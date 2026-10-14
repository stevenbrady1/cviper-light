// @vitest-environment jsdom
/**
 * What a typical CV check costs — stated where the key is added.
 *
 * This sentence used to live on the welcome screen's analysis card (L-90,
 * re-pinned for L-148 and W5). The refreshed welcome keeps only a short "Add a
 * key →" link, and that link routes HERE, so the cost now sits on the screen
 * where somebody actually decides to paste a key — before they do it, which is
 * the whole point of it. These assertions are the ones that used to live in
 * `welcome.keyLink.test.tsx`, moved with the sentence and not weakened.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeBrowserPort } from '../../../platform/test/fakeBrowserPort';
import { AI_COST_LINE } from '../../onboarding/cards';

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

describe('what a typical CV check costs, on the screen where keys are added', () => {
  it('is shown, in full, at the top of the AI keys section', () => {
    renderSetup();

    const line = screen.getByTestId('ai-keys-cost');
    expect(line.textContent).toBe(AI_COST_LINE);
    expect(screen.getByTestId('ai-key-setup').contains(line)).toBe(true);
  });

  it('says who is paid, with no figure — generically, never one provider (L-249)', () => {
    renderSetup();

    const line = screen.getByTestId('ai-keys-cost').textContent ?? '';
    // No estimate: CViper cannot know what a provider charges.
    expect(line).not.toMatch(/pence|penny|[£$€]\s?\d|\d+p\b|typical/i);
    expect(line).toContain('bills your own account at its published rates');
    expect(line).toContain('the AI provider you choose');
    for (const brand of ['OpenAI', 'Anthropic']) expect(line, brand).not.toContain(brand);
  });

  it('says a model on your own PC is free', () => {
    renderSetup();
    expect((screen.getByTestId('ai-keys-cost').textContent ?? '').toLowerCase()).toContain('free');
  });

  it('still says CViper takes no cut, and that prices can change (W5)', () => {
    renderSetup();

    const line = screen.getByTestId('ai-keys-cost').textContent ?? '';
    expect(line).toContain('CViper takes no cut');
    expect(line.toLowerCase()).toContain('prices can change');
  });

  it('negative: says it before the first key box, not after the cards', () => {
    renderSetup();

    const cost = screen.getByTestId('ai-keys-cost');
    const firstInput = screen.getByTestId(`ai-key-input-${AI_KEY_PROVIDER_IDS[0]}`);
    // DOCUMENT_POSITION_FOLLOWING: the input comes after the cost line.
    expect(
      cost.compareDocumentPosition(firstInput) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
