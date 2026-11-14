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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stripComments } from '../../lib/repo-scan';

import { type ProviderKind } from './providers';

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
  CONSENT_KINDS,
  CONSENT_STORE_FILE,
  CONSENT_STORE_KEY,
  NO_CONSENT,
  createTauriConsentPort,
  isCloudKind,
  parseConsentState,
  readStoredConsent,
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
      ...NO_CONSENT,
      anthropic: true,
      openai: true,
    });
  });

  it('reads all six providers, each on its own (L-177)', () => {
    const everyone = {
      anthropic: true,
      openai: true,
      google: true,
      mistral: true,
      grok: true,
      openrouter: true,
    };
    // L-150 added a seventh flag; a file naming only the six reads it as no.
    expect(parseConsentState(everyone)).toEqual({ ...everyone, custom: false });
    expect(parseConsentState({ mistral: true })).toEqual({ ...NO_CONSENT, mistral: true });
  });

  it('L-150: the typed-address service has its own flag, and a yes to every company is not a yes to it', () => {
    const everyNamedCompany = {
      anthropic: true,
      openai: true,
      google: true,
      mistral: true,
      grok: true,
      openrouter: true,
    };
    expect(parseConsentState(everyNamedCompany).custom).toBe(false);
    expect(parseConsentState({ custom: true })).toEqual({ ...NO_CONSENT, custom: true });
  });

  it('negative: L-150 — anything but the literal true for the typed-address service is no', () => {
    for (const value of ['true', 1, 'yes', null, {}, []]) {
      expect(parseConsentState({ custom: value }).custom).toBe(false);
    }
  });

  it('boundary: a file written before L-177 grants none of the four providers it never named', () => {
    // An older build wrote only two keys. Absent is "not granted", so a user
    // who said yes to OpenAI is still asked before anything goes to Google.
    expect(parseConsentState({ anthropic: false, openai: true })).toEqual({
      ...NO_CONSENT,
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
      ...NO_CONSENT,
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

    expect(read.ok && read.value).toEqual({ ...NO_CONSENT, openai: true });
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
    expect(read.ok && read.value).toEqual({ ...NO_CONSENT, openai: true });
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

    expect(read.ok && read.value).toEqual({ ...NO_CONSENT, openai: true });
  });
});

/**
 * `isCloudKind` decides, at BOTH call sites, whether anything is asked at all —
 * so the question it must answer correctly is not "are these two cloud?" but
 * "what happens to a kind nobody here has heard of?".
 */
describe('isCloudKind — an exclusion, so an unknown provider is gated by default', () => {
  it('says yes to the two cloud providers that exist today', () => {
    expect(isCloudKind('anthropic')).toBe(true);
    expect(isCloudKind('openai')).toBe(true);
  });

  it("L-150: the typed-address service is asked about, even on the user's own network", () => {
    // CViper cannot see what is at an address the user typed — a box under
    // the desk, or a company's gateway. Asking costs one click; not asking
    // could send a CV somewhere the user never agreed to.
    expect(isCloudKind('custom')).toBe(true);
  });

  it('negative: the two local kinds are never asked about', () => {
    // 127.0.0.1 and a pure function on this machine. Neither is a third party,
    // and prompting for either would be asking permission to use the user's own
    // computer.
    expect(isCloudKind('ollama')).toBe(false);
    expect(isCloudKind('keyword')).toBe(false);
  });

  it('boundary: a provider added tomorrow is treated as cloud, not skipped', () => {
    // Cast through `unknown` because the union does not have this member YET —
    // which is the whole point. An allow-list (`=== 'anthropic' || ===
    // 'openai'`) would answer `false` here, and a new provider would slip past
    // the gate at both call sites with every guard in the repo still green.
    const future = 'mistral' as unknown as ProviderKind;

    expect(isCloudKind(future)).toBe(true);
  });
});

/**
 * The default `hasConsent` both call sites use when nothing is injected.
 *
 * Tested directly, against the real store, because it is the ONLY version of
 * the check a user's machine ever runs: everywhere else it is replaced by a
 * fake, so a body that returned a constant would leave every other test green.
 */
describe('readStoredConsent — the check the app actually runs', () => {
  /** Put a consent record on the simulated disk, as a previous grant would. */
  function onDisk(state: Record<string, unknown>): void {
    plugin.disk.set(CONSENT_STORE_FILE, new Map<string, unknown>([[CONSENT_STORE_KEY, state]]));
  }

  it('reads a granted provider back as true', async () => {
    onDisk({ openai: true });

    await expect(readStoredConsent('openai')).resolves.toBe(true);
  });

  it('negative: a recorded false is false, not "something was written, so yes"', async () => {
    onDisk({ openai: false });

    await expect(readStoredConsent('openai')).resolves.toBe(false);
  });

  it('boundary: consent for one provider is not consent for the other', async () => {
    onDisk({ openai: true });

    await expect(readStoredConsent('anthropic')).resolves.toBe(false);
  });

  it('negative: an unreadable store fails CLOSED', async () => {
    plugin.failLoad('the app data directory is read-only');

    await expect(readStoredConsent('openai')).resolves.toBe(false);
  });

  it('reads fresh on every call, so a withdrawal takes effect immediately', async () => {
    const port = createTauriConsentPort();
    await port.grant('openai');
    await expect(readStoredConsent('openai')).resolves.toBe(true);

    await port.revoke('openai');

    // No snapshot anywhere: the second call opens the store again.
    await expect(readStoredConsent('openai')).resolves.toBe(false);
  });
});

/**
 * L-399. Analysis and Tailor each kept a hand-typed `['anthropic', 'openai']`
 * list of the consents that can be withdrawn. Five providers were added after
 * it was written and never joined it, so a consent given to Google could not
 * be taken back anywhere in the app — with `revoke` working for all seven the
 * whole time.
 */
describe('CONSENT_KINDS — the one list of consents that can be withdrawn', () => {
  it('is exactly the flags of NO_CONSENT, so a new flag cannot be left off a screen', () => {
    expect([...CONSENT_KINDS]).toEqual(Object.keys(NO_CONSENT));
  });

  it('every kind on it is granted and revoked through the real store', async () => {
    const port = createTauriConsentPort();

    for (const kind of CONSENT_KINDS) {
      await port.grant(kind);
      await expect(readStoredConsent(kind)).resolves.toBe(true);

      await port.revoke(kind);
      await expect(readStoredConsent(kind)).resolves.toBe(false);
    }
  });

  /** Two provider names side by side in an array: a second copy of the list. */
  const NAME = `['"\`](?:${Object.keys(NO_CONSENT).join('|')})['"\`]`;
  const HAND_TYPED_KINDS = new RegExp(`\\[\\s*${NAME}\\s*,\\s*${NAME}`);

  function shipped(file: string): string {
    return stripComments(readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8'));
  }

  // Settings' "What I have agreed to" draws the same rows (L-410).
  it.each(['./Analysis.tsx', '../tailor/Tailor.tsx', '../settings/AgreedList.tsx'])(
    'guard: %s draws its rows from CONSENT_KINDS, not from a list typed by hand',
    (file) => {
      const source = shipped(file);

      expect(HAND_TYPED_KINDS.test(source)).toBe(false);
      expect(source).toContain('CONSENT_KINDS.filter(');
    },
  );

  it('the guard sees the list this replaced, and is not fooled by a comment', () => {
    const before = "const granted = (['anthropic', 'openai'] as const).filter((k) => consent[k]);";

    expect(HAND_TYPED_KINDS.test(stripComments(before))).toBe(true);
    expect(HAND_TYPED_KINDS.test(stripComments('["google",\n  "mistral"]'))).toBe(true);
    expect(HAND_TYPED_KINDS.test(stripComments("// was ['anthropic', 'openai']"))).toBe(false);
    expect(HAND_TYPED_KINDS.test(stripComments("/* ['anthropic', 'openai'] */"))).toBe(false);
  });
});
