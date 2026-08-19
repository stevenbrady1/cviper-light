/**
 * `@tauri-apps/api/core` is mocked: there is no Tauri runtime in a Vitest
 * process, and `invoke()` would have nothing to talk to. What is asserted here
 * is the CONTRACT with Rust — the exact command names, the argument shape, the
 * envelope, and what happens when Rust says no.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const requestLog = vi.hoisted(() => ({ recordRequest: vi.fn() }));

vi.mock('../status/requestLog', () => ({ recordRequest: requestLog.recordRequest }));

const { createTauriTransport, probeOllama } = await import('./transport');

beforeEach(() => {
  tauri.invoke.mockReset();
  requestLog.recordRequest.mockReset();
});

function envelope(status: number, body: string): string {
  return JSON.stringify({ status, body });
}

describe('createTauriTransport — the contract with Rust', () => {
  it('calls provider_chat with the provider and the body', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, '{"ok":true}'));

    await createTauriTransport().chat('ollama', '{"model":"llama3.2:latest"}');

    expect(tauri.invoke).toHaveBeenCalledWith('provider_chat', {
      provider: 'ollama',
      body: '{"model":"llama3.2:latest"}',
    });
  });

  it('calls provider_list_models with just the provider', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, '{"models":[]}'));

    await createTauriTransport().listModels('anthropic');

    expect(tauri.invoke).toHaveBeenCalledWith('provider_list_models', { provider: 'anthropic' });
  });

  it('never passes a URL — Rust owns every destination', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, '{}'));

    await createTauriTransport().chat('openai', '{}');

    const args = JSON.stringify(tauri.invoke.mock.calls[0]?.[1] ?? {});
    expect(args).not.toMatch(/https?:/);
    expect(args).not.toContain('url');
  });

  it('unwraps the {status, body} envelope', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, '{"message":{"content":"hi"}}'));

    const result = await createTauriTransport().chat('ollama', '{}');

    expect(result).toEqual({
      ok: true,
      value: { status: 200, body: '{"message":{"content":"hi"}}' },
    });
  });

  it('treats a non-2xx as a SUCCESSFUL transport — the adapter classifies it', async () => {
    // A 401 arrived. The request worked; the provider refused it, and its body
    // explains why. Collapsing that into a transport error would throw the
    // explanation away.
    tauri.invoke.mockResolvedValue(envelope(401, '{"error":{"message":"bad key"}}'));

    const result = await createTauriTransport().chat('openai', '{}');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe(401);
  });

  it('boundary: an empty body string is still a valid envelope', async () => {
    tauri.invoke.mockResolvedValue(envelope(204, ''));

    const result = await createTauriTransport().chat('ollama', '{}');

    expect(result).toEqual({ ok: true, value: { status: 204, body: '' } });
  });
});

describe('createTauriTransport — failures from Rust', () => {
  it('reads the structured kind rather than sniffing English', async () => {
    tauri.invoke.mockRejectedValue(
      JSON.stringify({ kind: 'no-key', message: 'No OpenAI API key is saved.' }),
    );

    const result = await createTauriTransport().chat('openai', '{}');

    expect(result).toEqual({
      ok: false,
      error: { provider: 'openai', kind: 'no-key', message: 'No OpenAI API key is saved.' },
    });
  });

  it('maps a stopped daemon to not-running', async () => {
    tauri.invoke.mockRejectedValue(
      JSON.stringify({ kind: 'not-running', message: 'Ollama is not running.' }),
    );

    const result = await createTauriTransport().chat('ollama', '{}');

    expect(result).toMatchObject({ ok: false, error: { kind: 'not-running' } });
  });

  it('negative: refuses an error kind the union does not contain', async () => {
    // A future Rust change inventing a kind must degrade to something the UI
    // can render, not smuggle an unhandled value through the type system.
    tauri.invoke.mockRejectedValue(
      JSON.stringify({ kind: 'quantum-flux', message: 'Something odd.' }),
    );

    const result = await createTauriTransport().chat('ollama', '{}');

    expect(result).toMatchObject({ ok: false, error: { kind: 'network' } });
    if (!result.ok) expect(result.error.message).not.toContain('quantum-flux');
  });

  it('negative: never shows the user raw JSON when the payload is not ours', async () => {
    tauri.invoke.mockRejectedValue('command provider_chat not found');

    const result = await createTauriTransport().chat('ollama', '{}');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('network');
      expect(result.error.message).not.toContain('{');
    }
  });

  it('negative: survives a rejection that is not a string at all', async () => {
    for (const thrown of [new Error('boom'), null, undefined, 42, { a: 1 }]) {
      tauri.invoke.mockRejectedValue(thrown);
      const result = await createTauriTransport().chat('ollama', '{}');
      expect(result).toMatchObject({ ok: false, error: { kind: 'network' } });
    }
  });

  it('negative: a reply that is not an envelope is a bad response', async () => {
    for (const bad of ['not json', '[1,2,3]', '{"status":"200"}', '{"body":"x"}', 42, null]) {
      tauri.invoke.mockResolvedValue(bad);
      const result = await createTauriTransport().chat('ollama', '{}');
      expect(result).toMatchObject({ ok: false, error: { kind: 'bad-response' } });
    }
  });

  it('never lets an exception escape to the caller', async () => {
    tauri.invoke.mockImplementation(() => {
      throw new Error('synchronous explosion');
    });

    await expect(createTauriTransport().chat('ollama', '{}')).resolves.toMatchObject({ ok: false });
  });
});

describe('createTauriTransport — the request counter', () => {
  // The status strip's third row is "requests today". This is the only place
  // in the app that knows a request has left the process, so it is the only
  // place that can honestly count one.
  it('counts a chat request', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, '{}'));

    await createTauriTransport().chat('ollama', '{}');

    expect(requestLog.recordRequest).toHaveBeenCalledTimes(1);
  });

  it('counts a model listing — it costs the user the same call', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, '{}'));

    await createTauriTransport().listModels('openai');

    expect(requestLog.recordRequest).toHaveBeenCalledTimes(1);
  });

  it('counts a request that FAILED — the provider was still called', async () => {
    // Counting only successes would under-report exactly when the user most
    // needs the number: a run of 401s still burns rate limit.
    tauri.invoke.mockRejectedValue(JSON.stringify({ kind: 'no-key', message: 'No key.' }));

    await createTauriTransport().chat('anthropic', '{}');

    expect(requestLog.recordRequest).toHaveBeenCalledTimes(1);
  });

  it('does NOT count the Ollama probe', async () => {
    // The probe is the app asking a local daemon whether it is there. It costs
    // nothing, it is not something the user asked for, and counting it would
    // make the number tick up on its own while the app sat idle.
    tauri.invoke.mockResolvedValue('{"models":[]}');

    await probeOllama();

    expect(requestLog.recordRequest).not.toHaveBeenCalled();
  });

  it('never lets a broken counter break a request', async () => {
    requestLog.recordRequest.mockImplementation(() => {
      throw new Error('storage is full');
    });
    tauri.invoke.mockResolvedValue(envelope(200, '{"ok":true}'));

    const result = await createTauriTransport().chat('ollama', '{}');

    expect(result).toMatchObject({ ok: true, value: { status: 200 } });
  });
});

describe('probeOllama', () => {
  it('returns the raw tags body when the daemon answers', async () => {
    tauri.invoke.mockResolvedValue('{"models":[]}');

    await expect(probeOllama()).resolves.toBe('{"models":[]}');
    expect(tauri.invoke).toHaveBeenCalledWith('ollama_probe');
  });

  it('returns null when the daemon is absent — that is not an error', async () => {
    tauri.invoke.mockResolvedValue(null);
    await expect(probeOllama()).resolves.toBeNull();
  });

  it('returns null when the command itself fails', async () => {
    // A failed probe and an absent daemon lead to the same UI, so they lead to
    // the same value. Nothing here should ever put a red message on screen.
    tauri.invoke.mockRejectedValue('anything at all');
    await expect(probeOllama()).resolves.toBeNull();
  });
});
