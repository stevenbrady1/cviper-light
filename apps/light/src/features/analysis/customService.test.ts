// @vitest-environment jsdom
/**
 * The AI service at a typed address (L-150), as the pickers see it: read from
 * Rust's status command, offered once it is saved AND a model is chosen, and
 * honest in its note about where the CV goes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { readAvailability } = await import('./availability');
const { providerOptions } = await import('./providers');
const { CUSTOM_MODEL_STORAGE_KEY } = await import('./customModel');
const { providerInSentence, providerLabel } = await import('./model');

import type { Availability } from './providers';

/**
 * Writes straight to browser storage, as an earlier session would have.
 * A helper rather than inline: a storage-key NAME beside a literal reads to
 * the secret scanner like a credential assignment, and these are model names.
 */
function storeModelRaw(value: string): void {
  localStorage.setItem(CUSTOM_MODEL_STORAGE_KEY, value);
}

const NOTHING: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: false,
};

function machineWith(status: unknown): void {
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    if (command === 'custom_provider_status') return status;
    throw new Error(`unexpected command: ${command}`);
  });
}

beforeEach(() => {
  tauri.invoke.mockReset();
  localStorage.clear();
});

describe('readAvailability — the typed-address service', () => {
  it('reads a saved service on the internet', async () => {
    machineWith({ address: 'https://api.example.com/v1', own_network: false, has_key: true });
    expect((await readAvailability()).customService).toEqual({ ownNetwork: false });
  });

  it('reads a saved service on the user’s own network', async () => {
    machineWith({ address: 'http://localhost:1234/v1', own_network: true, has_key: false });
    expect((await readAvailability()).customService).toEqual({ ownNetwork: true });
  });

  it('negative: nothing saved reads as no service', async () => {
    machineWith(null);
    expect((await readAvailability()).customService).toBeUndefined();
  });

  it('negative: a status command that fails reads as no service, and the rest still answers', async () => {
    tauri.invoke.mockImplementation(async (command) => {
      if (command === 'ollama_probe') return null;
      if (command === 'secret_status') return command === 'secret_status';
      throw new Error('the store is locked');
    });
    const availability = await readAvailability();
    expect(availability.customService).toBeUndefined();
    expect(availability.openaiKey).toBe(true);
  });

  it('negative: a reply of the wrong shape reads as no service', async () => {
    for (const odd of ['yes', 42, [], {}, { own_network: 'true' }, { address: 1 }]) {
      machineWith(odd);
      expect((await readAvailability()).customService).toBeUndefined();
    }
  });

  it('never asks for the key — there is no command that would answer', async () => {
    machineWith({ address: 'https://api.example.com/v1', own_network: false, has_key: true });
    await readAvailability();
    const commands = tauri.invoke.mock.calls.map((call) => call[0]);
    expect(commands).toContain('custom_provider_status');
    expect(commands.some((command) => command.includes('get'))).toBe(false);
    // And no request to the service itself: reading availability costs nothing.
    expect(commands).not.toContain('custom_provider_models');
    expect(commands).not.toContain('custom_provider_chat');
  });
});

describe('providerOptions — the typed-address service', () => {
  it('offers it once it is saved and a model is chosen', () => {
    storeModelRaw('qwen2.5-7b-instruct');
    const option = providerOptions({ ...NOTHING, customService: { ownNetwork: false } }).find(
      (candidate) => candidate.kind === 'custom',
    );
    expect(option).toEqual({
      key: 'custom',
      kind: 'custom',
      label: 'Your AI service · qwen2.5-7b-instruct',
      note: 'A full reading. Your CV and the advert are sent to the AI service you added in Settings.',
      model: 'qwen2.5-7b-instruct',
      local: false,
      needsKey: false,
    });
  });

  it('says where the CV goes when the service is on the user’s own network', () => {
    storeModelRaw('llama3.2');
    const option = providerOptions({ ...NOTHING, customService: { ownNetwork: true } }).find(
      (candidate) => candidate.kind === 'custom',
    );
    expect(option?.note).toBe(
      'A full reading. Your CV and the advert go to the AI service on your own computer or network.',
    );
    // Not "local": CViper cannot tell a box under the desk from this machine,
    // and "nothing is being sent anywhere" would not be a promise it can keep.
    expect(option?.local).toBe(false);
  });

  it('negative: not offered when no model is chosen — there is nothing to ask for', () => {
    const options = providerOptions({ ...NOTHING, customService: { ownNetwork: false } });
    expect(options.some((option) => option.kind === 'custom')).toBe(false);
  });

  it('negative: not offered when no service is saved, whatever model is remembered', () => {
    storeModelRaw('qwen2.5-7b-instruct');
    for (const availability of [NOTHING, { ...NOTHING, customService: null }]) {
      expect(providerOptions(availability).some((option) => option.kind === 'custom')).toBe(false);
    }
  });

  it('boundary: a remembered model that is not a usable id is no model', () => {
    storeModelRaw('not an id');
    const options = providerOptions({ ...NOTHING, customService: { ownNetwork: false } });
    expect(options.some((option) => option.kind === 'custom')).toBe(false);
  });

  it('comes after every named provider, so it never becomes the default by surprise', () => {
    storeModelRaw('qwen2.5');
    const options = providerOptions({
      ...NOTHING,
      openaiKey: true,
      customService: { ownNetwork: false },
    });
    expect(options.map((option) => option.kind)).toEqual(['keyword', 'openai', 'custom']);
  });
});

describe('its name', () => {
  it('starts a sentence as "Your AI service" and sits inside one as "your AI service"', () => {
    expect(providerLabel('custom')).toBe('Your AI service');
    expect(providerInSentence('custom')).toBe('your AI service');
  });

  it('negative: every named provider reads the same in both places', () => {
    for (const kind of ['openai', 'anthropic', 'ollama', 'openrouter', 'keyword']) {
      expect(providerInSentence(kind)).toBe(providerLabel(kind));
    }
  });
});
