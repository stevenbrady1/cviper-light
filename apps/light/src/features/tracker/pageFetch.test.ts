/**
 * The page-fetch transport: what comes back out of Rust, and what happens when
 * something other than a page does.
 *
 * The security work is in `src-tauri/src/fetch_page.rs` and is tested there,
 * without a socket. What is tested HERE is the boundary: an `invoke` that
 * resolves with something unexpected, or rejects with something that is not the
 * `{kind, message}` object Rust promises, must still produce a typed error
 * rather than a crash inside the error handler — because the thing on the other
 * side of that boundary is the one part of this feature nobody can unit-test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { createTauriPageTransport, PAGE_FETCH_COMMAND } = await import('./pageFetch');

beforeEach(() => {
  tauri.invoke.mockReset();
});

const PAGE = '<html><body><h1>Credit Risk Analyst</h1></body></html>';

describe('reading a page back out of Rust', () => {
  it('passes the address to the command Rust registered, under the name it expects', async () => {
    tauri.invoke.mockResolvedValue({ status: 200, body: PAGE });

    await createTauriPageTransport().fetchPage('https://jobs.example.com/advert/1');

    expect(tauri.invoke).toHaveBeenCalledWith(PAGE_FETCH_COMMAND, {
      url: 'https://jobs.example.com/advert/1',
    });
    expect(PAGE_FETCH_COMMAND).toBe('fetch_job_page');
  });

  it('hands back the status and the body', async () => {
    tauri.invoke.mockResolvedValue({ status: 200, body: PAGE });

    const result = await createTauriPageTransport().fetchPage('https://jobs.example.com/1');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a page');
    expect(result.value.status).toBe(200);
    expect(result.value.body).toBe(PAGE);
  });

  it('a 404 is a RESULT, not a transport error — the request completed', async () => {
    // Same rule as the provider transport: `Err` is reserved for "it never
    // completed". A 404 completed perfectly; the caller decides what it means.
    tauri.invoke.mockResolvedValue({ status: 404, body: '<html>not found</html>' });

    const result = await createTauriPageTransport().fetchPage('https://jobs.example.com/gone');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a result');
    expect(result.value.status).toBe(404);
  });
});

describe('when Rust refuses', () => {
  it('carries the kind through so the caller can classify it', async () => {
    tauri.invoke.mockRejectedValue(
      JSON.stringify({ kind: 'blocked', message: 'That address is not one this app will open.' }),
    );

    const result = await createTauriPageTransport().fetchPage('http://127.0.0.1:11434/api/tags');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.kind).toBe('blocked');
  });

  it('understands every kind fetch_page.rs can send', async () => {
    for (const kind of ['bad-url', 'blocked', 'network', 'too-large', 'unsupported'] as const) {
      tauri.invoke.mockRejectedValue(JSON.stringify({ kind, message: 'a message' }));

      const result = await createTauriPageTransport().fetchPage('https://jobs.example.com/1');

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected a refusal');
      expect(result.error.kind).toBe(kind);
    }
  });

  it('negative: a kind nobody recognises degrades rather than being trusted', async () => {
    // A future Rust change must not be able to put a `PageFetchErrorKind` into
    // the app that no switch statement handles.
    tauri.invoke.mockRejectedValue(JSON.stringify({ kind: 'teapot', message: 'brewing' }));

    const result = await createTauriPageTransport().fetchPage('https://jobs.example.com/1');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.kind).toBe('network');
    expect(result.error.message).not.toContain('brewing');
  });

  it('negative: a rejection that is not JSON at all still becomes a typed error', async () => {
    // A Tauri-level failure — the command not registered, a broken IPC —
    // rejects with something else entirely.
    tauri.invoke.mockRejectedValue(new Error('command fetch_job_page not found'));

    const result = await createTauriPageTransport().fetchPage('https://jobs.example.com/1');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.kind).toBe('network');
    // The raw thrown value never reaches a string the app can show.
    expect(result.error.message).not.toContain('fetch_job_page');
  });

  it('negative: a reply that is not the {status, body} envelope is refused', async () => {
    for (const reply of [
      null,
      'a string',
      42,
      {},
      { status: 200 },
      { body: PAGE },
      { status: '200', body: PAGE },
    ]) {
      tauri.invoke.mockResolvedValue(reply);

      const result = await createTauriPageTransport().fetchPage('https://jobs.example.com/1');

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error(`expected a refusal for ${JSON.stringify(reply)}`);
      expect(result.error.kind).toBe('bad-response');
    }
  });

  it('boundary: an empty body is a legitimate page, not a broken reply', async () => {
    // A page that really is empty is the "too short to be an advert" case, and
    // that judgement belongs to `runFetch`, not to the transport.
    tauri.invoke.mockResolvedValue({ status: 200, body: '' });

    const result = await createTauriPageTransport().fetchPage('https://jobs.example.com/1');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a page');
    expect(result.value.body).toBe('');
  });
});
