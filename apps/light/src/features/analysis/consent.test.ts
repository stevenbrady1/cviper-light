/**
 * Per-provider AI consent, through the REAL port and a mocked plugin, plus the
 * defensive parsing that keeps a hand-edited file from ever reading as
 * "granted".
 *
 * A fake port would prove that a fake port works. What has to be proved here is
 * that the code which will run on a user's machine writes something a later
 * launch reads back — so `@tauri-apps/plugin-store` is mocked with a store
 * that keeps its contents between `load` calls, and a "restart" is a second
 * `load`. Same shape as `boards/port.test.ts`, which this consent store
 * deliberately matches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => {
  /** What is "on disk", keyed by store file. Survives a `load`, like a file. */
  const disk = new Map<string, Map<string, unknown>>();
  /** Every explicit `save()`, so a missing one is visible rather than assumed. */
  const saves: string[] = [];
  let loadThrows: string | null = null;
  let setThrows: string | null = null;

  function load(path: string) {
    if (loadThrows !== null) return Promise.reject(new Error(loadThrows));

    const contents = disk.get(path) ?? new Map<string, unknown>();
    disk.set(path, contents);

    return Promise.resolve({
      get: (key: string) => Promise.resolve(contents.get(key)),
      set: (key: string, value: unknown) => {
        if (setThrows !== null) return Promise.reject(new Error(setThrows));
        // Round-tripped through JSON, exactly as the real plugin does when it
        // writes the file. Catches anything that only survives in memory.
        contents.set(key, JSON.parse(JSON.stringify(value)));
        return Promise.resolve();
      },
      save: () => {
        saves.push(path);
        return Promise.resolve();
      },
    });
  }

  return {
    disk,
    saves,
    load: vi.fn(load),
    failLoad: (message: string | null) => {
      loadThrows = message;
    },
    failSet: (message: string | null) => {
      setThrows = message;
    },
  };
});

vi.mock('@tauri-apps/plugin-store', () => ({ load: plugin.load }));

const {
  CONSENT_STORE_FILE,
  CONSENT_STORE_KEY,
  NO_CONSENT,
  createTauriConsentPort,
  parseConsentState,
} = await import('./consent');

beforeEach(() => {
  plugin.disk.clear();
  plugin.saves.length = 0;
  plugin.load.mockClear();
  plugin.failLoad(null);
  plugin.failSet(null);
});

describe('parseConsentState', () => {
  it('reads a fully granted state', () => {
    expect(parseConsentState({ anthropic: true, openai: true })).toEqual({
      anthropic: true,
      openai: true,
    });
  });

  it('negative: garbage becomes NO_CONSENT rather than throwing or granting anything', () => {
    for (const garbage of [
      null,
      undefined,
      'yes',
      42,
      [],
      { anthropic: 'true' },
      { anthropic: 1 },
    ]) {
      expect(parseConsentState(garbage)).toEqual(NO_CONSENT);
    }
  });

  it('boundary: a half-written file keeps only what is actually the literal true', () => {
    // A hand-edited file with a string "yes" or a number 1 is not a granted
    // consent — only the boolean `true` counts. See the fail-closed header.
    expect(parseConsentState({ anthropic: true, openai: 'yes' })).toEqual({
      anthropic: true,
      openai: false,
    });
  });
});

describe('consent survives a restart', () => {
  it('reads NO_CONSENT on a machine that has never been asked', () => {
    return expect(createTauriConsentPort().read()).resolves.toEqual({
      ok: true,
      value: NO_CONSENT,
    });
  });

  it('round-trips a grant through a simulated restart', async () => {
    const before = createTauriConsentPort();
    const granted = await before.grant('openai');
    expect(granted.ok).toBe(true);

    // The app closes. Everything in memory goes. A new port, a new `load`.
    const after = createTauriConsentPort();
    const read = await after.read();

    expect(read.ok && read.value).toEqual({ anthropic: false, openai: true });
  });

  it('boundary: granting one provider does not grant the other', async () => {
    await createTauriConsentPort().grant('anthropic');

    const read = await createTauriConsentPort().read();

    expect(read.ok && read.value.anthropic).toBe(true);
    expect(read.ok && read.value.openai).toBe(false);
  });

  it('revokes what was granted, leaving the other provider untouched', async () => {
    const port = createTauriConsentPort();
    await port.grant('anthropic');
    await port.grant('openai');

    await port.revoke('anthropic');

    const read = await createTauriConsentPort().read();
    expect(read.ok && read.value).toEqual({ anthropic: false, openai: true });
  });

  it('saves explicitly, because autoSave is off', async () => {
    // Without the `save()` a revocation lives in memory only and is gone at
    // the next launch — which would mean the app quietly resuming something
    // the user had just switched off.
    await createTauriConsentPort().grant('openai');
    expect(plugin.saves).toEqual([CONSENT_STORE_FILE]);
  });

  it('writes one key in one file, both named where a test can see them', async () => {
    await createTauriConsentPort().grant('openai');

    expect([...(plugin.disk.get(CONSENT_STORE_FILE)?.keys() ?? [])]).toEqual([CONSENT_STORE_KEY]);
    expect(plugin.load).toHaveBeenCalledWith(CONSENT_STORE_FILE, { autoSave: false });
  });

  it('negative: a store that will not open fails CLOSED, not as granted', async () => {
    plugin.failLoad('the app data directory is read-only');

    const read = await createTauriConsentPort().read();

    expect(read.ok).toBe(false);
    expect(!read.ok && read.error.message).toContain('read-only');
    expect(!read.ok && read.error.message).toContain('nothing will be sent');
  });

  it('negative: a grant that fails to save says so rather than pretending it worked', async () => {
    plugin.failSet('the disk is full');

    const granted = await createTauriConsentPort().grant('openai');

    expect(granted.ok).toBe(false);
    expect(!granted.ok && granted.error.message).toContain('disk is full');
    expect(plugin.saves).toEqual([]);
  });

  it('negative: a hand-edited file loses only what it broke', async () => {
    plugin.disk.set(
      CONSENT_STORE_FILE,
      new Map<string, unknown>([[CONSENT_STORE_KEY, { anthropic: 'yes', openai: true }]]),
    );

    const read = await createTauriConsentPort().read();

    expect(read.ok && read.value).toEqual({ anthropic: false, openai: true });
  });
});
