/**
 * What this machine can actually offer, read once when the view opens.
 *
 * The probe and the two key checks are the only IPC the analysis view does
 * before the user presses anything, and NONE of it is a provider call — see the
 * assertion at the bottom, which is the same promise `tracker.zeroKeys` makes
 * for the board.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { readAvailability } = await import('./availability');

/** A realistic `/api/tags` body. */
const TAGS = JSON.stringify({
  models: [
    {
      model: 'llama3.2:3b',
      name: 'llama3.2:3b',
      capabilities: ['completion'],
      details: { parameter_size: '3.2B' },
    },
    {
      model: 'nomic-embed-text:latest',
      name: 'nomic-embed-text:latest',
      capabilities: ['embedding'],
    },
  ],
});

beforeEach(() => {
  tauri.invoke.mockReset();
});

/** Nothing is set up. The state every user starts in. */
function nothingConfigured(): void {
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
}

describe('readAvailability', () => {
  it('reports an unconfigured machine as having nothing, without erroring', async () => {
    nothingConfigured();

    await expect(readAvailability()).resolves.toEqual({
      ollamaModels: [],
      anthropicKey: false,
      openaiKey: false,
    });
  });

  it('lists the chat-capable models Ollama reported, and skips the rest', async () => {
    tauri.invoke.mockImplementation(async (command) => {
      if (command === 'ollama_probe') return TAGS;
      if (command === 'secret_status') return false;
      throw new Error(`unexpected command: ${command}`);
    });

    const availability = await readAvailability();

    // An embedding model in a chat picker produces a 400 the user cannot
    // interpret, so it is filtered out — by the same adapter the chat path uses.
    expect(availability.ollamaModels.map((model) => model.id)).toEqual(['llama3.2:3b']);
    expect(availability.ollamaModels[0]?.label).toContain('3.2B');
  });

  it('reads each cloud key separately', async () => {
    tauri.invoke.mockImplementation(async (command, args) => {
      if (command === 'ollama_probe') return null;
      if (command === 'secret_status') return args?.['key'] === 'anthropic_api_key';
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(readAvailability()).resolves.toEqual({
      ollamaModels: [],
      anthropicKey: true,
      openaiKey: false,
    });
  });

  it('negative: a credential store that will not answer offers nothing', async () => {
    // "Unreadable" must not become "available". Offering a provider whose key
    // cannot be read means the user picks it and waits for a failure.
    tauri.invoke.mockImplementation(async (command) => {
      if (command === 'ollama_probe') return null;
      throw new Error('the keychain is locked');
    });

    await expect(readAvailability()).resolves.toEqual({
      ollamaModels: [],
      anthropicKey: false,
      openaiKey: false,
    });
  });

  it('negative: a probe body that is not the expected shape yields no models', async () => {
    tauri.invoke.mockImplementation(async (command) => {
      if (command === 'ollama_probe') return '<html>proxy login</html>';
      if (command === 'secret_status') return false;
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(readAvailability()).resolves.toEqual({
      ollamaModels: [],
      anthropicKey: false,
      openaiKey: false,
    });
  });

  it('boundary: a daemon running with no models pulled offers no models', async () => {
    tauri.invoke.mockImplementation(async (command) => {
      if (command === 'ollama_probe') return '{"models":[]}';
      if (command === 'secret_status') return false;
      throw new Error(`unexpected command: ${command}`);
    });

    expect((await readAvailability()).ollamaModels).toEqual([]);
  });

  it('never calls a provider command — the probe is not a request', async () => {
    tauri.invoke.mockImplementation(async (command) => {
      if (command === 'ollama_probe') return TAGS;
      if (command === 'secret_status') return true;
      throw new Error(`unexpected command: ${command}`);
    });

    await readAvailability();

    const commands = tauri.invoke.mock.calls.map(([command]) => command);
    expect(commands).not.toContain('provider_list_models');
    expect(commands).not.toContain('provider_chat');
  });
});
