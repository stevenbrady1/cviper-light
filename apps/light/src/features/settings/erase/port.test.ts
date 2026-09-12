/**
 * "Delete everything", through the REAL port and a mocked plugin.
 *
 * A fake port would prove that a fake port works. What has to be proved here
 * is that the code which runs on a user's machine actually empties every file
 * it claims to — so `@tauri-apps/plugin-store` is mocked with a disk that
 * survives a `load`, the same shape `boards/port.test.ts` and
 * `analysis/consent.test.ts` use, and "was it really erased?" is answered by
 * reading that disk back afterwards.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS: L-106
 * ============================================================================
 * `forgetPreferences` cleared `job-boards.json` and nothing else, while the
 * screen said "CViper Light is back to the way it was when you first installed
 * it". `ai-provider-consent.json` survived, so the next person to use the
 * machine — with their own key — was never shown the Apple 5.1.2(i) consent
 * prompt, because a decision they never made was already on disk saying yes.
 * Nothing tested the real port at all; the only erase tests drove a fake one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => {
  /** What is "on disk", keyed by store file. Survives a `load`, like a file. */
  const disk = new Map<string, Map<string, unknown>>();
  /** Every explicit `save()`, so a clear that never reached disk is visible. */
  const saves: string[] = [];
  /** Files whose `load` or `clear` refuses, and what they throw when they do. */
  const loadThrows = new Map<string, unknown>();
  const clearThrows = new Map<string, unknown>();

  function load(path: string) {
    if (loadThrows.has(path)) return Promise.reject(loadThrows.get(path));

    const contents = disk.get(path) ?? new Map<string, unknown>();
    disk.set(path, contents);

    return Promise.resolve({
      get: (key: string) => Promise.resolve(contents.get(key)),
      set: (key: string, value: unknown) => {
        contents.set(key, JSON.parse(JSON.stringify(value)));
        return Promise.resolve();
      },
      clear: () => {
        if (clearThrows.has(path)) return Promise.reject(clearThrows.get(path));
        contents.clear();
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
    loadThrows,
    clearThrows,
    load: vi.fn(load),
  };
});

vi.mock('@tauri-apps/plugin-store', () => ({ load: plugin.load }));

const { BOARD_STORE_FILE, BOARD_STORE_KEY } = await import('../../boards/port');
const { CONSENT_STORE_FILE, CONSENT_STORE_KEY } = await import('../../analysis/consent');
const { createTauriErasePort } = await import('./port');

/** Both files, with something in them, exactly as a used machine would have. */
function seedUsedMachine(): void {
  plugin.disk.set(
    BOARD_STORE_FILE,
    new Map<string, unknown>([[BOARD_STORE_KEY, { hidden: ['reed'], custom: [] }]]),
  );
  plugin.disk.set(
    CONSENT_STORE_FILE,
    new Map<string, unknown>([[CONSENT_STORE_KEY, { anthropic: false, openai: true }]]),
  );
}

/** What is left in a file after the erase. Empty is the only right answer. */
function leftOnDisk(file: string): string[] {
  return [...(plugin.disk.get(file)?.keys() ?? [])];
}

beforeEach(() => {
  plugin.disk.clear();
  plugin.saves.length = 0;
  plugin.loadThrows.clear();
  plugin.clearThrows.clear();
  plugin.load.mockClear();
});

describe('forgetPreferences empties every preferences file', () => {
  it('clears the job-board choices', async () => {
    seedUsedMachine();

    const result = await createTauriErasePort().forgetPreferences();

    expect(result.ok).toBe(true);
    expect(leftOnDisk(BOARD_STORE_FILE)).toEqual([]);
  });

  it('clears the AI consent record, so the next user is asked again (L-106)', async () => {
    seedUsedMachine();

    const result = await createTauriErasePort().forgetPreferences();

    expect(result.ok).toBe(true);
    expect(
      leftOnDisk(CONSENT_STORE_FILE),
      'A consent decision that survives "delete everything" means the next person to paste a key is never shown the disclosure.',
    ).toEqual([]);
  });

  it('writes both files out, rather than clearing them only in memory', async () => {
    seedUsedMachine();

    await createTauriErasePort().forgetPreferences();

    expect([...plugin.saves].sort()).toEqual([BOARD_STORE_FILE, CONSENT_STORE_FILE].sort());
    for (const file of [BOARD_STORE_FILE, CONSENT_STORE_FILE]) {
      expect(plugin.load, file).toHaveBeenCalledWith(file, { autoSave: false });
    }
  });

  it('is content on a machine that has never written either file', async () => {
    const result = await createTauriErasePort().forgetPreferences();

    expect(result.ok).toBe(true);
    expect(leftOnDisk(BOARD_STORE_FILE)).toEqual([]);
    expect(leftOnDisk(CONSENT_STORE_FILE)).toEqual([]);
  });
});

describe('one file refusing does not cancel the others', () => {
  it('negative: the boards file refuses, and the consent record still goes', async () => {
    seedUsedMachine();
    plugin.clearThrows.set(BOARD_STORE_FILE, new Error('The file is read-only.'));

    const result = await createTauriErasePort().forgetPreferences();

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain('The file is read-only.');
    // The point of the whole shape: the later file is still attempted.
    expect(leftOnDisk(CONSENT_STORE_FILE)).toEqual([]);
  });

  it('negative: the consent file refuses, and it is named rather than swallowed', async () => {
    seedUsedMachine();
    plugin.loadThrows.set(CONSENT_STORE_FILE, new Error('The consent file is locked.'));

    const result = await createTauriErasePort().forgetPreferences();

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain('The consent file is locked.');
    expect(leftOnDisk(BOARD_STORE_FILE)).toEqual([]);
  });

  it('boundary: both refuse, and the message names the FIRST', async () => {
    seedUsedMachine();
    plugin.clearThrows.set(BOARD_STORE_FILE, new Error('Boards refused.'));
    plugin.clearThrows.set(CONSENT_STORE_FILE, new Error('Consent refused.'));

    const result = await createTauriErasePort().forgetPreferences();

    expect(result.ok).toBe(false);
    const message = result.ok ? '' : result.error.message;
    expect(message).toContain('Boards refused.');
    expect(message).not.toContain('Consent refused.');
    // Both were still tried: two loads, not one.
    expect(plugin.load).toHaveBeenCalledTimes(2);
  });

  it('boundary: a refusal that is not an Error still produces a readable sentence', async () => {
    seedUsedMachine();
    plugin.clearThrows.set(CONSENT_STORE_FILE, { nothing: 'useful' });

    const result = await createTauriErasePort().forgetPreferences();

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain('No reason was given.');
  });
});
