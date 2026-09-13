/**
 * The contract with `keyless_fetch`: the command name, the argument shape, the
 * envelope, and what happens when Rust says no.
 *
 * `@tauri-apps/api/core` is mocked because there is no Tauri runtime in a
 * Vitest process. What cannot be asserted from here is that the REAL command
 * behaves this way — that half lives in `keyless.rs`, whose own tests read this
 * file and fail if the command name or the argument keys stop matching.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const requestLog = vi.hoisted(() => ({ recordRequest: vi.fn() }));

vi.mock('../status/requestLog', () => ({ recordRequest: requestLog.recordRequest }));

const { createTauriKeylessTransport } = await import('./keylessTransport');

beforeEach(() => {
  tauri.invoke.mockReset();
  requestLog.recordRequest.mockReset();
});

function envelope(status: number, body: string): string {
  return JSON.stringify({ status, body });
}

describe('createTauriKeylessTransport — the contract with Rust', () => {
  it('calls keyless_fetch with the feed and the page', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, '{"data":[]}'));

    await createTauriKeylessTransport().fetch('arbeitnow', 2);

    expect(tauri.invoke).toHaveBeenCalledWith('keyless_fetch', {
      source: 'arbeitnow',
      page: 2,
    });
  });

  it('never passes a URL — Rust owns both destinations', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, '{"data":[]}'));

    await createTauriKeylessTransport().fetch('guardian', 1);

    const args = JSON.stringify(tauri.invoke.mock.calls[0]?.[1] ?? {});
    expect(args).not.toMatch(/https?:/);
    expect(args).not.toContain('url');
  });

  it('sends nothing the user typed', async () => {
    // These feeds cannot filter, so there is nothing to send — and a keyword
    // travelling to a feed that ignores it would tell the next reader the
    // opposite.
    tauri.invoke.mockResolvedValue(envelope(200, '{"data":[]}'));

    await createTauriKeylessTransport().fetch('arbeitnow', 1);

    expect(Object.keys(tauri.invoke.mock.calls[0]?.[1] ?? {})).toEqual(['source', 'page']);
  });

  it('hands back the status and body Rust reported', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, '{"data":[{"title":"Analyst"}]}'));

    const reply = await createTauriKeylessTransport().fetch('arbeitnow', 1);

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.value.status).toBe(200);
    expect(reply.value.body).toBe('{"data":[{"title":"Analyst"}]}');
  });

  it('a 404 is an Ok, not an Err — the request completed', async () => {
    // The page decides what a 404 MEANS (a feed that has moved), because the
    // status line is the only part of the failure worth reading. A transport
    // that turned it into an Err would throw the status away.
    tauri.invoke.mockResolvedValue(envelope(404, 'Not Found'));

    const reply = await createTauriKeylessTransport().fetch('guardian', 1);

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.value.status).toBe(404);
  });

  it('counts the request whatever the outcome', async () => {
    tauri.invoke.mockRejectedValue('{"kind":"network","message":"Could not reach Arbeitnow."}');

    await createTauriKeylessTransport().fetch('arbeitnow', 1);

    // A request that failed still left the machine, and the status strip's
    // promise is "here is how much went out".
    expect(requestLog.recordRequest).toHaveBeenCalledTimes(1);
  });

  it('a broken counter cannot fail a real request', async () => {
    requestLog.recordRequest.mockImplementation(() => {
      throw new Error('localStorage is unavailable');
    });
    tauri.invoke.mockResolvedValue(envelope(200, '{"data":[]}'));

    const reply = await createTauriKeylessTransport().fetch('arbeitnow', 1);

    expect(reply.ok).toBe(true);
  });
});

describe('createTauriKeylessTransport — when Rust says no', () => {
  it('reads the kind and message out of Rust’s error object', async () => {
    tauri.invoke.mockRejectedValue(
      JSON.stringify({ kind: 'throttled', message: 'Wait about 2 second(s).' }),
    );

    const reply = await createTauriKeylessTransport().fetch('arbeitnow', 1);

    expect(reply.ok).toBe(false);
    if (reply.ok) return;
    expect(reply.error.source).toBe('arbeitnow');
    expect(reply.error.kind).toBe('throttled');
    expect(reply.error.message).toBe('Wait about 2 second(s).');
  });

  it('negative: a kind this build does not know becomes something renderable', async () => {
    // A future Rust change must not produce a kind no branch handles. It
    // degrades to `network` with a sentence, rather than reaching the UI as an
    // unhandled value.
    tauri.invoke.mockRejectedValue(JSON.stringify({ kind: 'quantum', message: 'Odd.' }));

    const reply = await createTauriKeylessTransport().fetch('guardian', 1);

    expect(reply.ok).toBe(false);
    if (reply.ok) return;
    expect(reply.error.kind).toBe('network');
    expect(reply.error.message).not.toContain('quantum');
  });

  it('negative: a rejection that is not JSON never reaches the user as JSON', async () => {
    for (const thrown of ['command not found', new Error('ipc gone'), undefined, 42]) {
      tauri.invoke.mockRejectedValue(thrown);

      const reply = await createTauriKeylessTransport().fetch('guardian', 1);

      expect(reply.ok, String(thrown)).toBe(false);
      if (reply.ok) return;
      expect(reply.error.kind).toBe('network');
      expect(reply.error.message).not.toContain('{');
    }
  });

  it('negative: an envelope that is not the agreed shape is a bad response', async () => {
    for (const raw of ['not json', '{}', '{"status":"200","body":"x"}', '[]', 42, null]) {
      tauri.invoke.mockResolvedValue(raw);

      const reply = await createTauriKeylessTransport().fetch('arbeitnow', 1);

      expect(reply.ok, String(raw)).toBe(false);
      if (reply.ok) return;
      expect(reply.error.kind).toBe('bad-response');
    }
  });

  it('boundary: an empty message from Rust does not become an empty error', async () => {
    // An error with nothing in it renders as a blank red line, which is worse
    // than a generic sentence.
    tauri.invoke.mockRejectedValue(JSON.stringify({ kind: 'network', message: '' }));

    const reply = await createTauriKeylessTransport().fetch('arbeitnow', 1);

    expect(reply.ok).toBe(false);
    if (reply.ok) return;
    expect(reply.error.message.length).toBeGreaterThan(0);
  });
});
