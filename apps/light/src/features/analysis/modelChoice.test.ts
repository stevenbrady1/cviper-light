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
  createAnthropicProvider,
  createOpenAiProvider,
  type ChatTransport,
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

  // L-248: OpenAI deprecated these on 2026-10-14 and shuts them down on
  // 2027-01-14, naming gpt-6-luna as the replacement for all four
  // (developers.openai.com/api/docs/deprecations).
  const OPENAI_SHUTDOWN_2027_01_14 = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'];

  it('defaults OpenAI to gpt-6-luna, the replacement OpenAI names for all four retiring models', () => {
    expect(OPENAI_DEFAULT_MODEL).toBe('gpt-6-luna');
    expect(OPENROUTER_DEFAULT_MODEL).toBe('openai/gpt-6-luna');
  });

  it('negative: offers no OpenAI model that shuts down on 2027-01-14, directly or through OpenRouter', () => {
    const openai = AI_MODEL_CHOICES.openai.map((choice) => choice.id);
    const openrouter = AI_MODEL_CHOICES.openrouter.map((choice) => choice.id);
    for (const retiring of OPENAI_SHUTDOWN_2027_01_14) {
      expect(openai).not.toContain(retiring);
      expect(openrouter).not.toContain(`openai/${retiring}`);
    }
    // Boundary: nothing from the GPT-4 family at all, not just these four ids.
    for (const id of openai) expect(id).not.toMatch(/^gpt-4/);
    for (const id of openrouter) expect(id).not.toMatch(/^openai\/gpt-4/);
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

  it('negative: models the providers retired fall back to the default, not to a silent redirect', () => {
    // OpenRouter lists google/gemini-2.5-flash with expiration_date 2026-10-20;
    // xAI retired grok-4-fast-non-reasoning and grok-4 (grok-4-0709) on
    // 2026-05-15 and serves them as grok-4.3 at grok-4.3's price. Anybody who
    // chose one keeps a stored id that must read as the default.
    localStorage.setItem(
      MODEL_CHOICE_STORAGE_KEY,
      JSON.stringify({ openrouter: 'google/gemini-2.5-flash', grok: 'grok-4-fast-non-reasoning' }),
    );
    expect(chosenModel('openrouter')).toBe(OPENROUTER_DEFAULT_MODEL);
    expect(chosenModel('grok')).toBe(GROK_DEFAULT_MODEL);

    for (const retired of ['grok-4', 'anthropic/claude-sonnet-4.5']) {
      const provider = retired.includes('/') ? 'openrouter' : 'grok';
      localStorage.setItem(MODEL_CHOICE_STORAGE_KEY, JSON.stringify({ [provider]: retired }));
      expect(chosenModel(provider)).toBe(
        provider === 'grok' ? GROK_DEFAULT_MODEL : OPENROUTER_DEFAULT_MODEL,
      );
    }
  });

  it('negative: a stored OpenAI model that shuts down on 2027-01-14 falls back to gpt-6-luna', () => {
    for (const retiring of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini']) {
      localStorage.setItem(MODEL_CHOICE_STORAGE_KEY, JSON.stringify({ openai: retiring }));
      expect(chosenModel('openai')).toBe('gpt-6-luna');
      expect(readModelChoices().openai).toBe('gpt-6-luna');
      // And the Settings select can no longer put one back.
      expect(chooseModel('openai', retiring)).toBe(false);
    }
    localStorage.setItem(
      MODEL_CHOICE_STORAGE_KEY,
      JSON.stringify({ openrouter: 'openai/gpt-4o-mini' }),
    );
    expect(chosenModel('openrouter')).toBe('openai/gpt-6-luna');
    localStorage.setItem(MODEL_CHOICE_STORAGE_KEY, JSON.stringify({ openrouter: 'openai/gpt-4o' }));
    expect(chosenModel('openrouter')).toBe('openai/gpt-6-luna');
  });

  it('negative: none of the retired or retiring ids is offered', () => {
    const offered = Object.values(AI_MODEL_CHOICES).flatMap((list) => list.map((c) => c.id));
    for (const retired of [
      'google/gemini-2.5-flash',
      'anthropic/claude-sonnet-4.5',
      'grok-4-fast-non-reasoning',
      'grok-4',
    ]) {
      expect(offered).not.toContain(retired);
    }
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

describe('every OpenAI model on the Settings card is sent a request it accepts (L-248)', () => {
  // OpenAI's GPT-6 guide: "When reasoning effort is not `none`, remove
  // `temperature`, `top_p`, and `top_logprobs`", and GPT-6 defaults to medium.
  // Like the Anthropic case below, the key test (a GET of /models) cannot see a
  // 400 that only a real question would get.
  it.each(AI_MODEL_CHOICES.openai.map((choice) => choice.id))(
    '%s: no temperature, and max_completion_tokens with strict json_schema',
    async (model) => {
      const bodies: string[] = [];
      const transport: ChatTransport = {
        chat: async (_provider, body) => {
          bodies.push(body);
          return {
            ok: true,
            value: {
              status: 200,
              body: '{"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}]}',
            },
          };
        },
        listModels: async () => ({ ok: true, value: { status: 200, body: '{"data":[]}' } }),
      };

      await createOpenAiProvider(transport).chatJson({
        model,
        system: 's',
        user: 'u',
        schema: { type: 'object' },
        temperature: 0,
        maxOutputTokens: 1024,
      });

      const sent = JSON.parse(bodies[0] ?? '{}') as Record<string, unknown>;
      expect(sent['model']).toBe(model);
      expect(sent).not.toHaveProperty('temperature');
      expect(sent).not.toHaveProperty('max_tokens');
      expect(typeof sent['max_completion_tokens']).toBe('number');
      expect(sent['response_format']).toMatchObject({
        type: 'json_schema',
        json_schema: { strict: true },
      });
    },
  );
});

describe('every Anthropic model on the Settings card is sent a request it accepts', () => {
  // Opus 5 (the default) and Opus 5.5 removed temperature; Sonnet 5.5 refuses
  // any value but its own. Sending `temperature: 0` was a 400 on every call,
  // and the key test (a GET of /v1/models) could not see it.
  it.each(AI_MODEL_CHOICES.anthropic.map((choice) => choice.id))(
    '%s: no temperature in the body',
    async (model) => {
      const bodies: string[] = [];
      const transport: ChatTransport = {
        chat: async (_provider, body) => {
          bodies.push(body);
          return {
            ok: true,
            value: { status: 200, body: '{"content":[{"type":"text","text":"{}"}]}' },
          };
        },
        listModels: async () => ({ ok: true, value: { status: 200, body: '{"data":[]}' } }),
      };

      await createAnthropicProvider(transport).chatJson({
        model,
        system: 's',
        user: 'u',
        schema: { type: 'object' },
        temperature: 0,
        maxOutputTokens: 1024,
      });

      const sent = JSON.parse(bodies[0] ?? '{}') as Record<string, unknown>;
      expect(sent['model']).toBe(model);
      expect(sent).not.toHaveProperty('temperature');
    },
  );
});
