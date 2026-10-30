/**
 * L-333: which local model the picker offers first.
 *
 * Ollama lists models in its own order, and the first local option is the one
 * `defaultOptionKey` starts on. So a machine with a coding model and a chat
 * model could open a CV check on the coding model. General chat models go
 * first; models whose id says "coder", "code", "embed" or "vision" go last,
 * each keeping Ollama's order within its group.
 *
 * The match is LITERAL and on the model id, as specified: "contains", ignoring
 * case. So an id with "decoder" in it counts as a code model too — the last
 * test below pins that, so the choice is visible rather than accidental.
 */
import { describe, expect, it } from 'vitest';

import { KEYWORD_KEY, defaultOptionKey, providerOptions, type Availability } from './providers';

const MODELS = {
  anthropic: 'claude-test',
  openai: 'gpt-test',
  google: 'gemini-test',
  mistral: 'mistral-test',
  grok: 'grok-test',
  openrouter: 'router-test',
} as const;

const NOTHING: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: false,
};

const CODER = { id: 'qwen2.5-coder:7b', label: 'qwen2.5-coder:7b (7.6B)' };
const LLAMA = { id: 'llama3.2', label: 'llama3.2 (3.2B)' };
const MISTRAL = { id: 'mistral:7b', label: 'mistral:7b (7.2B)' };

const CODE_NOTE = 'Built for code — may read CVs less well';

function ollamaIds(availability: Availability): (string | null)[] {
  return providerOptions(availability, MODELS, null)
    .filter((option) => option.kind === 'ollama')
    .map((option) => option.model);
}

describe('providerOptions — local model order (L-333)', () => {
  it('puts a general chat model before a coding model Ollama listed first', () => {
    const availability = { ...NOTHING, ollamaRunning: true, ollamaModels: [CODER, LLAMA] };

    expect(ollamaIds(availability)).toEqual(['llama3.2', 'qwen2.5-coder:7b']);
    expect(defaultOptionKey(providerOptions(availability, MODELS, null))).toBe('ollama:llama3.2');
  });

  it('keeps the basic match first', () => {
    const options = providerOptions(
      { ...NOTHING, ollamaRunning: true, ollamaModels: [CODER, LLAMA] },
      MODELS,
      null,
    );
    expect(options[0]?.key).toBe(KEYWORD_KEY);
  });

  it('notes that a coding model may read CVs less well, and keeps the local promise', () => {
    const options = providerOptions(
      { ...NOTHING, ollamaRunning: true, ollamaModels: [CODER, LLAMA] },
      MODELS,
      null,
    );
    const coder = options.find((option) => option.model === CODER.id);
    const llama = options.find((option) => option.model === LLAMA.id);

    expect(coder?.note).toContain(CODE_NOTE);
    expect(coder?.note).toContain('Your CV stays on your PC');
    expect(llama?.note).not.toContain(CODE_NOTE);
  });

  it('boundary: a coding model on its own is still offered, with the note', () => {
    const options = providerOptions(
      { ...NOTHING, ollamaRunning: true, ollamaModels: [CODER] },
      MODELS,
      null,
    );

    expect(options.map((option) => option.key)).toEqual([KEYWORD_KEY, 'ollama:qwen2.5-coder:7b']);
    expect(options[1]?.note).toContain(CODE_NOTE);
    expect(defaultOptionKey(options)).toBe('ollama:qwen2.5-coder:7b');
  });

  it('negative: with no local models the options are exactly what they were', () => {
    const options = providerOptions(
      {
        ollamaRunning: false,
        ollamaModels: [],
        anthropicKey: true,
        openaiKey: true,
        googleKey: true,
        mistralKey: true,
        grokKey: true,
        openrouterKey: true,
        customService: { ownNetwork: false },
      },
      MODELS,
      'custom-test',
    );

    expect(options).toEqual([
      {
        key: 'keyword',
        kind: 'keyword',
        label: 'Basic match — no key needed',
        note:
          'Compares the words on your CV with the words in the advert. Instant, free, ' +
          'and works with nothing set up.',
        model: null,
        local: true,
        needsKey: false,
      },
      {
        key: 'anthropic',
        kind: 'anthropic',
        label: 'Anthropic · claude-test',
        note: 'A full reading. Your CV and the advert are sent to Anthropic.',
        model: 'claude-test',
        local: false,
        needsKey: true,
      },
      {
        key: 'openai',
        kind: 'openai',
        label: 'OpenAI · gpt-test',
        note: 'A full reading. Your CV and the advert are sent to OpenAI.',
        model: 'gpt-test',
        local: false,
        needsKey: true,
      },
      {
        key: 'google',
        kind: 'google',
        label: 'Google Gemini · gemini-test',
        note: 'A full reading. Your CV and the advert are sent to Google.',
        model: 'gemini-test',
        local: false,
        needsKey: true,
      },
      {
        key: 'mistral',
        kind: 'mistral',
        label: 'Mistral · mistral-test',
        note: 'A full reading. Your CV and the advert are sent to Mistral.',
        model: 'mistral-test',
        local: false,
        needsKey: true,
      },
      {
        key: 'grok',
        kind: 'grok',
        label: 'xAI Grok · grok-test',
        note: 'A full reading. Your CV and the advert are sent to xAI.',
        model: 'grok-test',
        local: false,
        needsKey: true,
      },
      {
        key: 'openrouter',
        kind: 'openrouter',
        label: 'OpenRouter · router-test',
        note:
          'A full reading. Your CV and the advert are sent to OpenRouter, which passes them to ' +
          'the company that runs the model.',
        model: 'router-test',
        local: false,
        needsKey: true,
      },
      {
        key: 'custom',
        kind: 'custom',
        label: 'Your AI service · custom-test',
        note: 'A full reading. Your CV and the advert are sent to the AI service you added in Settings.',
        model: 'custom-test',
        local: false,
        needsKey: false,
      },
    ]);
  });

  it('matches the words in any case', () => {
    const shouting = { id: 'StarCODER2:3b', label: 'StarCODER2:3b' };
    const vision = { id: 'llama3.2-Vision:11b', label: 'llama3.2-Vision:11b' };
    const embed = { id: 'Nomic-EMBED-text', label: 'Nomic-EMBED-text' };
    const code = { id: 'CodeGemma:7b', label: 'CodeGemma:7b' };

    expect(
      ollamaIds({
        ...NOTHING,
        ollamaRunning: true,
        ollamaModels: [shouting, vision, LLAMA, embed, code],
      }),
    ).toEqual([
      'llama3.2',
      'StarCODER2:3b',
      'llama3.2-Vision:11b',
      'Nomic-EMBED-text',
      'CodeGemma:7b',
    ]);
  });

  it('keeps Ollama’s own order inside each group', () => {
    const deepseek = { id: 'deepseek-coder:6.7b', label: 'deepseek-coder:6.7b' };
    const codellama = { id: 'codellama:7b', label: 'codellama:7b' };

    expect(
      ollamaIds({
        ...NOTHING,
        ollamaRunning: true,
        ollamaModels: [deepseek, MISTRAL, codellama, LLAMA],
      }),
    ).toEqual(['mistral:7b', 'llama3.2', 'deepseek-coder:6.7b', 'codellama:7b']);
  });

  it('leaves cloud options after every local one, in their own order', () => {
    const keys = providerOptions(
      {
        ...NOTHING,
        ollamaRunning: true,
        ollamaModels: [CODER, LLAMA],
        anthropicKey: true,
        openaiKey: true,
      },
      MODELS,
      null,
    ).map((option) => option.key);

    expect(keys).toEqual([
      KEYWORD_KEY,
      'ollama:llama3.2',
      'ollama:qwen2.5-coder:7b',
      'anthropic',
      'openai',
    ]);
  });

  it('is literal: "decoder" contains "code", so it goes last; a name without the words does not', () => {
    const decoder = { id: 'tinydecoder:1b', label: 'tinydecoder:1b' };
    const plain = { id: 'phi3:mini', label: 'phi3:mini' };

    const options = providerOptions(
      { ...NOTHING, ollamaRunning: true, ollamaModels: [decoder, plain] },
      MODELS,
      null,
    );

    expect(ollamaIds({ ...NOTHING, ollamaRunning: true, ollamaModels: [decoder, plain] })).toEqual([
      'phi3:mini',
      'tinydecoder:1b',
    ]);
    expect(options.find((option) => option.model === 'phi3:mini')?.note).not.toContain(CODE_NOTE);
  });
});

/**
 * Vision models are built for pictures, not code, so they get their own note.
 * An id that names both "vision" and a code word gets the IMAGES note: "vision"
 * says what kind of model it is, and the code words can turn up as a variant
 * tag on it. Ordering is untouched — all four words still sort last.
 */
describe('providerOptions — the note for a vision model (L-333)', () => {
  const IMAGES_NOTE = 'Built for images — may read CVs less well. Your CV stays on your PC.';
  const FULL_CODE_NOTE = 'Built for code — may read CVs less well. Your CV stays on your PC.';

  function noteFor(id: string): string | undefined {
    return providerOptions(
      { ...NOTHING, ollamaRunning: true, ollamaModels: [{ id, label: id }] },
      MODELS,
      null,
    ).find((option) => option.model === id)?.note;
  }

  it('a vision model says it is built for images', () => {
    expect(noteFor('llama3.2-vision:11b')).toBe(IMAGES_NOTE);
    expect(noteFor('Qwen2.5-VISION:7b')).toBe(IMAGES_NOTE);
  });

  it('a code, coder or embed model keeps the code note', () => {
    expect(noteFor('qwen2.5-coder:7b')).toBe(FULL_CODE_NOTE);
    expect(noteFor('codellama:7b')).toBe(FULL_CODE_NOTE);
    expect(noteFor('some-embed-chat:1b')).toBe(FULL_CODE_NOTE);
  });

  it('an id naming both vision and code gets the images note', () => {
    expect(noteFor('llava-code-vision:7b')).toBe(IMAGES_NOTE);
  });

  it('a vision model still sorts after a general one', () => {
    expect(
      ollamaIds({
        ...NOTHING,
        ollamaRunning: true,
        ollamaModels: [{ id: 'llama3.2-vision:11b', label: 'v' }, CODER, LLAMA],
      }),
    ).toEqual(['llama3.2', 'llama3.2-vision:11b', 'qwen2.5-coder:7b']);
  });
});
