/**
 * `@tauri-apps/api/core` is mocked: there is no Tauri runtime in a Vitest
 * process, and `invoke()` would have nothing to talk to. What is asserted here
 * is the CONTRACT with Rust — the command name, the argument shape, the
 * envelope, and what happens when Rust says no.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type JobSearchParams } from '@cviper/job-apis';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const requestLog = vi.hoisted(() => ({ recordRequest: vi.fn() }));

vi.mock('../status/requestLog', () => ({ recordRequest: requestLog.recordRequest }));

const { createTauriJobTransport } = await import('./transport');

beforeEach(() => {
  tauri.invoke.mockReset();
  requestLog.recordRequest.mockReset();
});

const PARAMS: JobSearchParams = {
  keywords: 'credit risk analyst',
  location: 'London',
  limit: 20,
  distanceMiles: null,
  salaryMin: null,
  employmentType: null,
};

function envelope(status: number, body: string): string {
  return JSON.stringify({ status, body });
}

describe('createTauriJobTransport — the contract with Rust', () => {
  it('calls job_search with the provider and the params', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, '{"results":[]}'));

    await createTauriJobTransport().search('reed', PARAMS);

    expect(tauri.invoke).toHaveBeenCalledWith('job_search', {
      provider: 'reed',
      params: PARAMS,
    });
  });

  it('never passes a URL — Rust owns every destination', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, '{"results":[]}'));

    await createTauriJobTransport().search('adzuna', PARAMS);

    const args = JSON.stringify(tauri.invoke.mock.calls[0]?.[1] ?? {});
    expect(args).not.toMatch(/https?:/);
    expect(args).not.toContain('url');
    expect(args).not.toContain('app_key');
  });

  it('unwraps the {status, body} envelope', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, '{"results":[{"jobId":1}]}'));

    const result = await createTauriJobTransport().search('reed', PARAMS);

    expect(result).toEqual({
      ok: true,
      value: { status: 200, body: '{"results":[{"jobId":1}]}' },
    });
  });

  it('treats a non-2xx as a SUCCESSFUL transport — the caller classifies it', async () => {
    // A 401 arrived. The request worked; the board refused it, and which status
    // it was decides whether the UI opens Settings or offers a retry.
    tauri.invoke.mockResolvedValue(envelope(401, ''));

    const result = await createTauriJobTransport().search('reed', PARAMS);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe(401);
  });

  it('boundary: an empty body string is still a valid envelope', async () => {
    tauri.invoke.mockResolvedValue(envelope(204, ''));

    const result = await createTauriJobTransport().search('adzuna', PARAMS);

    expect(result).toEqual({ ok: true, value: { status: 204, body: '' } });
  });
});

describe('createTauriJobTransport — failures from Rust', () => {
  it('reads the structured kind rather than sniffing English', async () => {
    tauri.invoke.mockRejectedValue(
      JSON.stringify({ kind: 'no-key', message: 'No Reed API key is saved.' }),
    );

    const result = await createTauriJobTransport().search('reed', PARAMS);

    expect(result).toEqual({
      ok: false,
      error: { provider: 'reed', kind: 'no-key', message: 'No Reed API key is saved.' },
    });
  });

  it('carries the throttle refusal through as its own kind', async () => {
    // "You searched a moment ago" is a different screen from "the network is
    // down", and only Rust knows which one happened.
    tauri.invoke.mockRejectedValue(
      JSON.stringify({ kind: 'throttled', message: 'That was very quick.' }),
    );

    const result = await createTauriJobTransport().search('adzuna', PARAMS);

    expect(result).toMatchObject({ ok: false, error: { kind: 'throttled' } });
  });

  it('negative: refuses an error kind the union does not contain', async () => {
    tauri.invoke.mockRejectedValue(
      JSON.stringify({ kind: 'quantum-flux', message: 'Something odd.' }),
    );

    const result = await createTauriJobTransport().search('reed', PARAMS);

    expect(result).toMatchObject({ ok: false, error: { kind: 'network' } });
    if (!result.ok) expect(result.error.message).not.toContain('quantum-flux');
  });

  it('negative: never shows the user raw JSON when the payload is not ours', async () => {
    tauri.invoke.mockRejectedValue('command job_search not found');

    const result = await createTauriJobTransport().search('reed', PARAMS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('network');
      expect(result.error.message).not.toContain('{');
    }
  });

  it('negative: survives a rejection that is not a string at all', async () => {
    for (const thrown of [new Error('boom'), null, undefined, 42, { a: 1 }]) {
      tauri.invoke.mockRejectedValue(thrown);
      const result = await createTauriJobTransport().search('reed', PARAMS);
      expect(result).toMatchObject({ ok: false, error: { kind: 'network' } });
    }
  });

  it('negative: a reply that is not an envelope is a bad response', async () => {
    for (const bad of ['not json', '[1,2,3]', '{"status":"200"}', '{"body":"x"}', 42, null]) {
      tauri.invoke.mockResolvedValue(bad);
      const result = await createTauriJobTransport().search('adzuna', PARAMS);
      expect(result).toMatchObject({ ok: false, error: { kind: 'bad-response' } });
    }
  });

  it('never lets an exception escape to the caller', async () => {
    tauri.invoke.mockImplementation(() => {
      throw new Error('synchronous explosion');
    });

    await expect(createTauriJobTransport().search('reed', PARAMS)).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe('createTauriJobTransport — the request counter', () => {
  it('counts a search', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, '{"results":[]}'));

    await createTauriJobTransport().search('reed', PARAMS);

    expect(requestLog.recordRequest).toHaveBeenCalledTimes(1);
  });

  it('counts a search that FAILED — the board was still called', async () => {
    tauri.invoke.mockRejectedValue(JSON.stringify({ kind: 'network', message: 'Down.' }));

    await createTauriJobTransport().search('adzuna', PARAMS);

    expect(requestLog.recordRequest).toHaveBeenCalledTimes(1);
  });

  it('never lets a broken counter break a search', async () => {
    requestLog.recordRequest.mockImplementation(() => {
      throw new Error('storage is full');
    });
    tauri.invoke.mockResolvedValue(envelope(200, '{"results":[]}'));

    const result = await createTauriJobTransport().search('reed', PARAMS);

    expect(result).toMatchObject({ ok: true, value: { status: 200 } });
  });
});
