/**
 * The contract with Rust for L-150's typed-address service: exact command
 * names, exact argument keys, and what comes back — never the key.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ok } from '@cviper/core-types';
import { type ProviderError, type ProviderHttpResponse } from '@cviper/ai-providers';
import { type Result } from '@cviper/core-types';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { createTauriCustomServicePort, describeFailure, readStatus } =
  await import('./customServicePort');

beforeEach(() => {
  tauri.invoke.mockReset();
});

const NO_LIST = (): Promise<Result<ProviderHttpResponse, ProviderError>> =>
  Promise.reject(new Error('not used'));

describe('save', () => {
  it('sends the address, the tick and the key to custom_provider_save, in Tauri’s spelling', async () => {
    tauri.invoke.mockResolvedValue(null);
    const port = createTauriCustomServicePort(NO_LIST);

    const saved = await port.save({
      address: 'http://localhost:1234/v1',
      ownNetwork: true,
      key: '',
    });

    expect(saved.ok).toBe(true);
    expect(tauri.invoke).toHaveBeenCalledWith('custom_provider_save', {
      address: 'http://localhost:1234/v1',
      ownNetwork: true,
      key: '',
    });
  });

  it('negative: never writes through secret_set — Rust refuses that entry there', async () => {
    tauri.invoke.mockResolvedValue(null);
    await createTauriCustomServicePort(NO_LIST).save({
      address: 'https://api.example.com/v1',
      ownNetwork: false,
      key: 'sk-test',
    });
    expect(tauri.invoke.mock.calls.map((call) => call[0])).toEqual(['custom_provider_save']);
  });

  it('negative: a refusal comes back as the sentence Rust chose', async () => {
    tauri.invoke.mockRejectedValue(
      JSON.stringify({ kind: 'bad-request', message: 'CViper will not connect to that address.' }),
    );
    const saved = await createTauriCustomServicePort(NO_LIST).save({
      address: 'http://169.254.169.254',
      ownNetwork: true,
      key: '',
    });
    expect(saved).toEqual({
      ok: false,
      error: { message: 'CViper will not connect to that address.' },
    });
  });
});

describe('status', () => {
  it('reads the address, the tick and whether a key is saved', async () => {
    tauri.invoke.mockResolvedValue({
      address: 'https://api.example.com/v1',
      own_network: false,
      has_key: true,
    });
    expect(await createTauriCustomServicePort(NO_LIST).status()).toEqual(
      ok({ address: 'https://api.example.com/v1', ownNetwork: false, hasKey: true }),
    );
    expect(tauri.invoke).toHaveBeenCalledWith('custom_provider_status');
  });

  it('reads nothing saved as null', async () => {
    tauri.invoke.mockResolvedValue(null);
    expect(await createTauriCustomServicePort(NO_LIST).status()).toEqual(ok(null));
  });

  it('negative: a store that will not answer is a problem, not "nothing saved"', async () => {
    tauri.invoke.mockRejectedValue(
      JSON.stringify({ kind: 'no-key', message: 'The store is locked.' }),
    );
    const status = await createTauriCustomServicePort(NO_LIST).status();
    expect(status).toEqual({ ok: false, error: { message: 'The store is locked.' } });
  });

  it('negative: a reply of the wrong shape is nothing saved, and a stray key field is dropped', () => {
    for (const odd of [null, 'x', [], {}, { address: '', own_network: true, has_key: false }]) {
      expect(readStatus(odd)).toBeNull();
    }
    expect(
      readStatus({ address: 'https://a.example/v1', own_network: true, has_key: true, key: 'sk' }),
    ).toEqual({ address: 'https://a.example/v1', ownNetwork: true, hasKey: true });
  });
});

describe('remove and list', () => {
  it('removes with secret_delete on the custom_provider entry', async () => {
    tauri.invoke.mockResolvedValue(null);
    expect((await createTauriCustomServicePort(NO_LIST).remove()).ok).toBe(true);
    expect(tauri.invoke).toHaveBeenCalledWith('secret_delete', { key: 'custom_provider' });
  });

  it('lists the service’s models through the shared adapter', async () => {
    let asked = 0;
    const list = () => {
      asked += 1;
      return Promise.resolve(
        ok({ status: 200, body: JSON.stringify({ data: [{ id: 'qwen2.5' }, { id: 'phi-4' }] }) }),
      );
    };
    const listed = await createTauriCustomServicePort(list).listModels();
    expect(asked).toBe(1);
    expect(listed.ok && listed.value.map((model) => model.id)).toEqual(['qwen2.5', 'phi-4']);
  });

  it('negative: a 401 from the service is a problem, without quoting what it said', async () => {
    const list = () =>
      Promise.resolve(ok({ status: 401, body: '{"error":{"message":"bad key sk-abc"}}' }));
    const listed = await createTauriCustomServicePort(list).listModels();
    expect(listed.ok).toBe(false);
    if (!listed.ok) expect(listed.error.message).not.toContain('sk-abc');
  });
});

describe('describeFailure', () => {
  it('negative: never shows raw JSON, and falls back to a fixed sentence', () => {
    expect(describeFailure('{"kind":"network"}')).not.toContain('{');
    expect(describeFailure(42)).toContain('Try again');
    expect(describeFailure('')).toContain('Try again');
    expect(describeFailure('The store is locked.')).toBe('The store is locked.');
  });
});
