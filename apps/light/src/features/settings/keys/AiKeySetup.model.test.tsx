// @vitest-environment jsdom
/**
 * The model picker on every AI key card (L-183).
 *
 * Each card has a Model select listing that provider's curated models. What is
 * chosen there is what every AI feature runs — proved here end to end, from a
 * change on the select to the option the analysis screen builds.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakeBrowserPort } from '../../../platform/test/fakeBrowserPort';
import {
  AI_MODEL_CHOICES,
  MODEL_CHOICE_STORAGE_KEY,
  chosenModel,
  defaultModelFor,
} from '../../analysis/modelChoice';
import { providerOptions } from '../../analysis/providers';

import { AiKeySetup } from './AiKeySetup';
import type { AiKeyProviderId } from './aiKeyModel';
import { AI_KEY_PROVIDER_IDS } from './aiKeyProviders';
import { createFakeAiKeyPort, type FakeAiKeyPort } from './test/fakeAiKeyPort';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

function renderCards() {
  const ports = Object.fromEntries(
    AI_KEY_PROVIDER_IDS.map((id) => [id, createFakeAiKeyPort()]),
  ) as Record<AiKeyProviderId, FakeAiKeyPort>;
  render(<AiKeySetup ports={ports} browser={createFakeBrowserPort()} />);
  return userEvent.setup();
}

function select(id: AiKeyProviderId): HTMLSelectElement {
  return screen.getByTestId(`ai-model-${id}`) as HTMLSelectElement;
}

describe('the Model select on each AI key card', () => {
  it('lists exactly that provider’s curated models, starting on the default', () => {
    renderCards();
    for (const id of AI_KEY_PROVIDER_IDS) {
      const values = [...select(id).options].map((option) => option.value);
      expect(values).toEqual(AI_MODEL_CHOICES[id].map((choice) => choice.id));
      expect(select(id).value).toBe(defaultModelFor(id));
    }
  });

  it('marks the default in its own words, and labels the select for a screen reader', () => {
    renderCards();
    const first = select('google').options[0];
    expect(first?.textContent).toMatch(/default/i);
    expect(screen.getByLabelText('Model', { selector: '#ai-model-google' })).toBe(select('google'));
  });

  it('choosing a model saves it, and the analysis options run it from then on', async () => {
    const user = renderCards();
    const pick = AI_MODEL_CHOICES.google[2]?.id ?? '';

    await user.selectOptions(select('google'), pick);

    expect(select('google').value).toBe(pick);
    expect(chosenModel('google')).toBe(pick);
    const option = providerOptions({
      ollamaRunning: false,
      ollamaModels: [],
      anthropicKey: false,
      openaiKey: false,
      googleKey: true,
    }).find((candidate) => candidate.kind === 'google');
    expect(option?.model).toBe(pick);
  });

  it('negative: choosing for one provider leaves every other provider on its own model', async () => {
    const user = renderCards();
    await user.selectOptions(select('mistral'), AI_MODEL_CHOICES.mistral[1]?.id ?? '');

    for (const id of AI_KEY_PROVIDER_IDS.filter((other) => other !== 'mistral')) {
      expect(select(id).value).toBe(defaultModelFor(id));
      expect(chosenModel(id)).toBe(defaultModelFor(id));
    }
  });

  it('boundary: a choice made earlier is what the card shows when Settings opens again', () => {
    const last = AI_MODEL_CHOICES.openrouter.at(-1)?.id ?? '';
    localStorage.setItem(MODEL_CHOICE_STORAGE_KEY, JSON.stringify({ openrouter: last }));

    renderCards();
    expect(select('openrouter').value).toBe(last);
  });

  it('negative: a stored model no longer on the list shows, and runs, the default', () => {
    localStorage.setItem(MODEL_CHOICE_STORAGE_KEY, JSON.stringify({ anthropic: 'claude-2' }));

    renderCards();
    expect(select('anthropic').value).toBe(defaultModelFor('anthropic'));
  });
});
