/**
 * Which ways of running an analysis are offered, and in what order.
 *
 * ============================================================================
 * THE ONE INVARIANT: THE KEYWORD OPTION IS ALWAYS THERE.
 * ============================================================================
 * Every other option depends on something the user may never have done —
 * installed a 4 GB model, pasted a key. The basic match depends on nothing, and
 * a build where it can disappear is a build where a brand-new user opens the
 * analysis screen and finds a picker with nothing in it. `it.each` over every
 * combination of availability is deliberate: this is the property, not an
 * example of it.
 */
import { describe, expect, it } from 'vitest';

import {
  KEYWORD_KEY,
  defaultOptionKey,
  optionByKey,
  providerOptions,
  type Availability,
} from './providers';

const NOTHING: Availability = { ollamaModels: [], anthropicKey: false, openaiKey: false };

const LLAMA = { id: 'llama3.2:3b', label: 'llama3.2:3b (3.2B)' };
const QWEN = { id: 'qwen2.5:7b', label: 'qwen2.5:7b (7.6B)' };

/** Every combination of the three things that can be set up. */
const COMBINATIONS: Availability[] = [false, true].flatMap((anthropicKey) =>
  [false, true].flatMap((openaiKey) =>
    [[], [LLAMA]].map((ollamaModels) => ({ ollamaModels, anthropicKey, openaiKey })),
  ),
);

describe('providerOptions', () => {
  it('always offers the basic match, whatever else is or is not set up', () => {
    for (const availability of COMBINATIONS) {
      const options = providerOptions(availability);
      expect(
        options.filter((option) => option.kind === 'keyword'),
        JSON.stringify(availability),
      ).toHaveLength(1);
    }
  });

  it('offers only the basic match on a machine with nothing configured', () => {
    const options = providerOptions(NOTHING);

    expect(options).toHaveLength(1);
    expect(options[0]?.key).toBe(KEYWORD_KEY);
    expect(options[0]?.needsKey).toBe(false);
  });

  it('says out loud that the basic match needs no key', () => {
    const [basic] = providerOptions(NOTHING);
    expect(`${basic?.label} ${basic?.note}`.toLowerCase()).toContain('no key');
  });

  it('offers one entry per installed Ollama model, named', () => {
    const options = providerOptions({ ...NOTHING, ollamaModels: [LLAMA, QWEN] });

    const ollama = options.filter((option) => option.kind === 'ollama');
    expect(ollama.map((option) => option.model)).toEqual(['llama3.2:3b', 'qwen2.5:7b']);
    expect(ollama[0]?.label).toContain('llama3.2:3b');
    expect(ollama.every((option) => option.key !== ollama[1]?.key || option === ollama[1])).toBe(
      true,
    );
  });

  it('labels Ollama as private and weaker, in those words', () => {
    const [, ollama] = providerOptions({ ...NOTHING, ollamaModels: [LLAMA] });

    expect(ollama?.note).toContain('Private but weaker');
    expect(ollama?.note).toContain('nothing leaves your PC');
    expect(ollama?.local).toBe(true);
  });

  it('hides Ollama entirely when the probe found no models', () => {
    // Not greyed out, not "install Ollama" — absent. A disabled row for
    // software the user has never heard of is noise on every single launch.
    expect(providerOptions(NOTHING).some((option) => option.kind === 'ollama')).toBe(false);
  });

  it('offers a cloud provider only when its key is saved', () => {
    expect(
      providerOptions({ ...NOTHING, anthropicKey: true }).map((option) => option.kind),
    ).toEqual(['keyword', 'anthropic']);

    expect(providerOptions({ ...NOTHING, openaiKey: true }).map((option) => option.kind)).toEqual([
      'keyword',
      'openai',
    ]);
  });

  it('is ordered basic, then local, then cloud', () => {
    const options = providerOptions({
      ollamaModels: [LLAMA],
      anthropicKey: true,
      openaiKey: true,
    });

    expect(options.map((option) => option.kind)).toEqual([
      'keyword',
      'ollama',
      'anthropic',
      'openai',
    ]);
  });

  it('marks the cloud options as leaving the machine and the others as not', () => {
    const options = providerOptions({
      ollamaModels: [LLAMA],
      anthropicKey: true,
      openaiKey: true,
    });

    expect(options.map((option) => option.local)).toEqual([true, true, false, false]);
  });

  it('gives every option a distinct key', () => {
    const options = providerOptions({
      ollamaModels: [LLAMA, QWEN],
      anthropicKey: true,
      openaiKey: true,
    });

    expect(new Set(options.map((option) => option.key)).size).toBe(options.length);
  });

  it('names a concrete model for every option that needs one', () => {
    const options = providerOptions({
      ollamaModels: [LLAMA],
      anthropicKey: true,
      openaiKey: true,
    });

    for (const option of options) {
      if (option.kind === 'keyword') expect(option.model).toBeNull();
      else expect(option.model).not.toBe('');
    }
  });
});

describe('defaultOptionKey', () => {
  it('is the basic match when nothing else is configured', () => {
    expect(defaultOptionKey(providerOptions(NOTHING))).toBe(KEYWORD_KEY);
  });

  it('is the local model when one is installed, because it is better and free', () => {
    const options = providerOptions({ ...NOTHING, ollamaModels: [LLAMA] });
    expect(defaultOptionKey(options)).toBe('ollama:llama3.2:3b');
  });

  it('is the cloud provider when that is the only thing set up', () => {
    const options = providerOptions({ ...NOTHING, anthropicKey: true });
    expect(defaultOptionKey(options)).toBe('anthropic');
  });

  it('boundary: falls back to the basic match given an empty list', () => {
    // Unreachable through `providerOptions`, which always includes it — but a
    // default that could return `undefined` would put the run button in a state
    // no message explains.
    expect(defaultOptionKey([])).toBe(KEYWORD_KEY);
  });
});

describe('optionByKey', () => {
  it('finds the option the picker names', () => {
    const options = providerOptions({ ...NOTHING, ollamaModels: [LLAMA] });
    expect(optionByKey(options, 'ollama:llama3.2:3b')?.model).toBe('llama3.2:3b');
  });

  it('returns null for a key that is no longer offered', () => {
    // Real case: Ollama was running when the view loaded and has since been
    // stopped. The selection must not silently resolve to something else.
    expect(optionByKey(providerOptions(NOTHING), 'ollama:llama3.2:3b')).toBeNull();
  });
});
