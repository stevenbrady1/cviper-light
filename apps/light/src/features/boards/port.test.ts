/**
 * The board preferences, through the REAL port and a mocked plugin.
 *
 * A fake port would prove that a fake port works. What has to be proved here is
 * that the code which will run on a user's machine writes something a later
 * launch reads back — so `@tauri-apps/plugin-store` is mocked with a store that
 * keeps its contents between `load` calls, and a "restart" is a second `load`.
 */
import { type BoardTemplate } from '@cviper/core-types';
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

const { BOARD_STORE_FILE, BOARD_STORE_KEY, createTauriBoardPreferencesPort } =
  await import('./port');
const { NO_PREFERENCES } = await import('./model');

const A_CUSTOM: BoardTemplate = {
  id: 'custom-efinancialcareers',
  label: 'eFinancialCareers',
  urlTemplate: 'https://www.efinancialcareers.co.uk/jobs?q={keyword}',
  encoding: 'plus',
};

beforeEach(() => {
  plugin.disk.clear();
  plugin.saves.length = 0;
  plugin.load.mockClear();
  plugin.failLoad(null);
  plugin.failSet(null);
});

describe('board preferences survive a restart', () => {
  it('reads nothing at all on a machine that has never had this app', () => {
    // Not an error, and not a reason to say anything to anybody.
    return expect(createTauriBoardPreferencesPort().read()).resolves.toEqual({
      ok: true,
      value: NO_PREFERENCES,
    });
  });

  it('round-trips a custom board through a simulated restart', async () => {
    const before = createTauriBoardPreferencesPort();
    const written = await before.write({ ...NO_PREFERENCES, custom: [A_CUSTOM] });
    expect(written.ok).toBe(true);

    // The app closes. Everything in memory goes. A new port, a new `load`.
    const after = createTauriBoardPreferencesPort();
    const read = await after.read();

    expect(read.ok && read.value.custom).toEqual([A_CUSTOM]);
  });

  it('round-trips a disabled board and a reorder through a simulated restart', async () => {
    await createTauriBoardPreferencesPort().write({
      disabled: ['indeed'],
      order: ['reed', 'linkedin', 'indeed'],
      custom: [],
    });

    const read = await createTauriBoardPreferencesPort().read();

    expect(read.ok && read.value).toEqual({
      disabled: ['indeed'],
      order: ['reed', 'linkedin', 'indeed'],
      custom: [],
    });
  });

  it('saves explicitly, because autoSave is off', () => {
    // Without the `save()` the change lives in memory and is gone at the next
    // launch — a bug that every test in this file would otherwise still pass.
    return createTauriBoardPreferencesPort()
      .write({ ...NO_PREFERENCES, disabled: ['reed'] })
      .then(() => {
        expect(plugin.saves).toEqual([BOARD_STORE_FILE]);
      });
  });

  it('writes one key in one file, both named where a test can see them', async () => {
    await createTauriBoardPreferencesPort().write({ ...NO_PREFERENCES, disabled: ['reed'] });

    expect([...(plugin.disk.get(BOARD_STORE_FILE)?.keys() ?? [])]).toEqual([BOARD_STORE_KEY]);
    expect(plugin.load).toHaveBeenCalledWith(BOARD_STORE_FILE, { autoSave: false });
  });

  it('negative: a store that will not open reports it and does not throw', async () => {
    plugin.failLoad('the app data directory is read-only');

    const read = await createTauriBoardPreferencesPort().read();

    expect(read.ok).toBe(false);
    expect(!read.ok && read.error.message).toContain('read-only');
    expect(!read.ok && read.error.message).toContain('boards CViper ships with');
  });

  it('negative: a write that fails says the change will not survive a restart', async () => {
    plugin.failSet('the disk is full');

    const written = await createTauriBoardPreferencesPort().write(NO_PREFERENCES);

    expect(written.ok).toBe(false);
    expect(!written.ok && written.error.message).toContain('disk is full');
    expect(plugin.saves).toEqual([]);
  });

  it('negative: a hand-edited file loses only what it broke', async () => {
    plugin.disk.set(
      BOARD_STORE_FILE,
      new Map<string, unknown>([
        [BOARD_STORE_KEY, { disabled: ['reed'], order: 'sideways', custom: [A_CUSTOM, 42] }],
      ]),
    );

    const read = await createTauriBoardPreferencesPort().read();

    expect(read.ok && read.value).toEqual({ disabled: ['reed'], order: [], custom: [A_CUSTOM] });
  });

  it('boundary: writing nothing back clears what was there', async () => {
    await createTauriBoardPreferencesPort().write({ ...NO_PREFERENCES, disabled: ['reed'] });
    await createTauriBoardPreferencesPort().write(NO_PREFERENCES);

    const read = await createTauriBoardPreferencesPort().read();

    expect(read.ok && read.value).toEqual(NO_PREFERENCES);
  });
});
