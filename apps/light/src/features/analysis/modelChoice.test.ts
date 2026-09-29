// @vitest-environment jsdom
/**
 * Which model each cloud provider runs (L-183): a short curated list per
 * provider, chosen in Settings, remembered on this computer, and used by every
 * AI feature because it is read where the options are built.
 */
import {
  ANTHROPIC_DEFAULT_MODEL,
  GOOGLE_DEFAULT_MODEL,
  GROK_DEFAULT_MODEL,
  MISTRAL_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_MODEL,
} from '@cviper/ai-providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AI_KEY_PROVIDER_IDS } from '../settings/keys/aiKeyProviders';
import {
  AI_MODEL_CHOICES,
  MODEL_CHOICE_STORAGE_KEY,
  OPENAI_DEFAULT_MODEL,
  chooseModel,
  chosenModel,
  defaultModelFor,
  readModelChoices,
} from './modelChoice';
import { providerOptions, type Availability } from './providers';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const EVERY_KEY: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: true,
  openaiKey: true,
  googleKey: true,
  mistralKey: true,
  grokKey: true,
  openrouterKey: true,
};

describe('the curated lists', () => {
  it('has a list for every provider with a key card, and no other', () => {
    expect(Object.keys(AI_MODEL_CHOICES).sort()).toEqual([...AI_KEY_PROVIDER_IDS].sort());
  });

  it('boundary: each list is short — three to five models — with no repeats', () => {
    for (const id of AI_KEY_PROVIDER_IDS) {
      const ids = AI_MODEL_CHOICES[id].map((choice) => choice.id);
      expect(ids.length).toBeGreaterThanOrEqual(3);
      expect(ids.length).toBeLessThanOrEqual(5);
      expect(new Set(ids).size).toBe(ids.length);
      for (const model of ids) expect(model).toMatch(/^\S+$/);
    }
  });

  it('starts each list with the provider’s shipped default, so nothing changes until you choose', () => {
    expect(AI_MODEL_CHOICES.openai[0]?.id).toBe(OPENAI_DEFAULT_MODEL);
    expect(AI_MODEL_CHOICES.anthropic[0]?.id).toBe(ANTHROPIC_DEFAULT_MODEL);
    expect(AI_MODEL_CHOICES.google[0]?.id).toBe(GOOGLE_DEFAULT_MODEL);
    expect(AI_MODEL_CHOICES.mistral[0]?.id).toBe(MISTRAL_DEFAULT_MODEL);
    expect(AI_MODEL_CHOICES.grok[0]?.id).toBe(GROK_DEFAULT_MODEL);
    expect(AI_MODEL_CHOICES.openrouter[0]?.id).toBe(OPENROUTER_DEFAULT_MODEL);
    for (const id of AI_KEY_PROVIDER_IDS) {
      expect(defaultModelFor(id)).toBe(AI_MODEL_CHOICES[id][0]?.id);
    }
  });

  it('negative: offers no OpenAI reasoning model — they refuse the temperature 0 every job sends', () => {
    for (const choice of AI_MODEL_CHOICES.openai) {
      expect(choice.id).not.toMatch(/^(o\d|gpt-5)/);
    }
  });
});

describe('choosing and reading back', () => {
  it('reads the default when nothing has been chosen', () => {
    for (const id of AI_KEY_PROVIDER_IDS) expect(chosenModel(id)).toBe(defaultModelFor(id));
  });

  it('remembers a choice from the list, per provider', () => {
    const second = AI_MODEL_CHOICES.google[1]?.id ?? '';
    expect(chooseModel('google', second)).toBe(true);

    expect(chosenModel('google')).toBe(second);
    // Another provider is untouched by it.
    expect(chosenModel('mistral')).toBe(MISTRAL_DEFAULT_MODEL);
    expect(readModelChoices().google).toBe(second);
  });

  it('negative: refuses a model that is not on that provider’s list, and writes nothing', () => {
    expect(chooseModel('google', 'gpt-4o')).toBe(false);
    expect(chooseModel('google', '')).toBe(false);
    expect(localStorage.getItem(MODEL_CHOICE_STORAGE_KEY)).toBeNull();
    expect(chosenModel('google')).toBe(GOOGLE_DEFAULT_MODEL);
  });

  it('negative: a stored model that is no longer on the list falls back to the default', () => {
    localStorage.setItem(
      MODEL_CHOICE_STORAGE_KEY,
      JSON.stringify({ google: 'gemini-retired-model', grok: AI_MODEL_CHOICES.grok[1]?.id }),
    );
    expect(chosenModel('google')).toBe(GOOGLE_DEFAULT_MODEL);
    // The good entry beside it survives.
    expect(chosenModel('grok')).toBe(AI_MODEL_CHOICES.grok[1]?.id);
  });

  it('negative: garbage in storage, or storage that throws, reads as the defaults', () => {
    localStorage.setItem(MODEL_CHOICE_STORAGE_KEY, '{not json');
    expect(chosenModel('openai')).toBe(OPENAI_DEFAULT_MODEL);

    localStorage.setItem(MODEL_CHOICE_STORAGE_KEY, '["gpt-4o-mini"]');
    expect(chosenModel('openai')).toBe(OPENAI_DEFAULT_MODEL);

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(chosenModel('openai')).toBe(OPENAI_DEFAULT_MODEL);
  });

  it('is stored under the app prefix, so Delete everything removes it', () => {
    expect(MODEL_CHOICE_STORAGE_KEY.startsWith('cviper.light.')).toBe(true);
  });
});

describe('every AI feature runs the chosen model', () => {
  it('the options every feature is built from carry the chosen model, in the model and the label', () => {
    const picks = Object.fromEntries(
      AI_KEY_PROVIDER_IDS.map((id) => [id, AI_MODEL_CHOICES[id][1]?.id ?? '']),
    );
    for (const id of AI_KEY_PROVIDER_IDS) expect(chooseModel(id, picks[id] ?? '')).toBe(true);

    const options = providerOptions(EVERY_KEY);
    for (const id of AI_KEY_PROVIDER_IDS) {
      const option = options.find((candidate) => candidate.kind === id);
      expect(option?.model).toBe(picks[id]);
      expect(option?.label).toContain(picks[id]);
    }
  });

  it('with nothing chosen, the options carry the shipped defaults', () => {
    const options = providerOptions(EVERY_KEY);
    for (const id of AI_KEY_PROVIDER_IDS) {
      expect(options.find((candidate) => candidate.kind === id)?.model).toBe(defaultModelFor(id));
    }
  });
});
