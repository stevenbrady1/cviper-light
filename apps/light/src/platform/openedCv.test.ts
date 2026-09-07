/**
 * The opened-CV port (L-83): two Tauri events in, one `Result` out, and a
 * watcher that can always stop — even before the listeners have finished
 * registering.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Registered {
  readonly event: string;
  readonly handler: (event: { payload: unknown }) => void;
  readonly unlisten: ReturnType<typeof vi.fn>;
}

const tauriEvents = vi.hoisted(() => ({
  registered: [] as Registered[],
  /** Resolve every pending `listen` promise. */
  settle: [] as (() => void)[],
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: tauriEvents.listen }));

const { CV_OPENED_EVENT, CV_OPEN_FAILED_EVENT, createTauriOpenedCvPort } = await import('./files');

/** Base64 of the four bytes `%PDF`. */
const PDF_HEADER_BASE64 = 'JVBERg==';

beforeEach(() => {
  tauriEvents.registered.length = 0;
  tauriEvents.settle.length = 0;
  tauriEvents.listen.mockReset();
  tauriEvents.listen.mockImplementation(
    (event: string, handler: (event: { payload: unknown }) => void) => {
      const unlisten = vi.fn();
      tauriEvents.registered.push({ event, handler, unlisten });
      return new Promise<() => void>((resolve) => {
        tauriEvents.settle.push(() => resolve(unlisten));
      });
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function deliver(event: string, payload: unknown): void {
  for (const registration of tauriEvents.registered) {
    if (registration.event === event) registration.handler({ payload });
  }
}

async function settleAll(): Promise<void> {
  for (const settle of tauriEvents.settle.splice(0)) settle();
  // Let the `.then` inside the port run.
  await Promise.resolve();
  await Promise.resolve();
}

describe('createTauriOpenedCvPort', () => {
  it('listens for exactly the two events Rust emits', () => {
    createTauriOpenedCvPort().watch(() => undefined);

    expect(tauriEvents.registered.map((registration) => registration.event).sort()).toEqual(
      [CV_OPENED_EVENT, CV_OPEN_FAILED_EVENT].sort(),
    );
  });

  it('turns an opened file into the same shape the picker answers with', () => {
    const listener = vi.fn();
    createTauriOpenedCvPort().watch(listener);

    deliver(CV_OPENED_EVENT, {
      name: 'CV.pdf',
      path: '/var/mobile/Containers/Data/Application/X/Documents/Inbox/CV.pdf',
      bytes_base64: PDF_HEADER_BASE64,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const [opened] = listener.mock.calls[0] as [{ ok: boolean; value?: unknown }];
    expect(opened.ok).toBe(true);
    expect(opened.value).toEqual({
      name: 'CV.pdf',
      path: '/var/mobile/Containers/Data/Application/X/Documents/Inbox/CV.pdf',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    });
  });

  it('turns a refusal into an error carrying Rust’s own sentence', () => {
    const listener = vi.fn();
    createTauriOpenedCvPort().watch(listener);

    deliver(CV_OPEN_FAILED_EVENT, 'CViper cannot read that kind of file. Pick a PDF.');

    expect(listener).toHaveBeenCalledWith({
      ok: false,
      error: { message: 'CViper cannot read that kind of file. Pick a PDF.' },
    });
  });

  it('negative: a payload it cannot read is an error, never an empty CV', () => {
    const listener = vi.fn();
    createTauriOpenedCvPort().watch(listener);

    deliver(CV_OPENED_EVENT, { name: 'CV.pdf', path: '/x/CV.pdf', bytes_base64: '!!!' });
    deliver(CV_OPENED_EVENT, { name: 'CV.pdf' });
    deliver(CV_OPEN_FAILED_EVENT, { not: 'a string' });

    expect(listener).toHaveBeenCalledTimes(3);
    for (const [opened] of listener.mock.calls as [
      { ok: boolean; error?: { message: string } },
    ][]) {
      expect(opened.ok).toBe(false);
      expect(opened.error?.message.length).toBeGreaterThan(20);
    }
  });

  it('stops delivering the moment the watcher stops, and releases both listeners', async () => {
    const listener = vi.fn();
    const stop = createTauriOpenedCvPort().watch(listener);
    await settleAll();

    stop();
    deliver(CV_OPENED_EVENT, {
      name: 'CV.pdf',
      path: '/x/CV.pdf',
      bytes_base64: PDF_HEADER_BASE64,
    });

    expect(listener).not.toHaveBeenCalled();
    for (const registration of tauriEvents.registered) {
      expect(registration.unlisten).toHaveBeenCalledTimes(1);
    }
  });

  it('edge: stopping BEFORE the listeners have registered still releases them once they do', async () => {
    const stop = createTauriOpenedCvPort().watch(() => undefined);

    stop();
    for (const registration of tauriEvents.registered) {
      expect(registration.unlisten).not.toHaveBeenCalled();
    }

    await settleAll();
    for (const registration of tauriEvents.registered) {
      expect(registration.unlisten).toHaveBeenCalledTimes(1);
    }
  });

  it('edge: a runtime with no event system leaves the port silent rather than broken', async () => {
    tauriEvents.listen.mockImplementation(() => Promise.reject(new Error('no Tauri runtime')));
    const listener = vi.fn();

    const stop = createTauriOpenedCvPort().watch(listener);
    await Promise.resolve();
    await Promise.resolve();

    expect(() => stop()).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});
