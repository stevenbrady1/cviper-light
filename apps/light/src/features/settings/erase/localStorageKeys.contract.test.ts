/**
 * The persistence contract: every place this app writes something is a place
 * "delete everything" reaches.
 *
 * TWO POPULATIONS, BECAUSE THERE ARE TWO MECHANISMS. `localStorage` keys are
 * swept by PREFIX, so the contract on them is that they all carry it. Tauri
 * store FILES are erased by NAME, so the contract on them is that each name is
 * both listed for the user and reachable from an erase step.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Four small stores live in `localStorage` — the welcome flag, the request
 * quota, the last search, the request log — and each names its own key. The
 * erase step removes everything under one prefix. The day somebody adds a
 * fifth store under `lightApp.` instead of `cviper.light.`, it survives
 * "delete everything" and the screen that just said "everything has been
 * deleted" was wrong. This makes that a build failure instead.
 *
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033): the guard does not know the
 * stores by name. It finds every `*_STORAGE_KEY = '…'` declaration in the app
 * and forbids one that does not start with the prefix, so the fifth store is
 * caught without anyone editing this file.
 *
 * ============================================================================
 * WHY IT ALSO COUNTS STORE FILES: L-106
 * ============================================================================
 * It did not, and that is exactly how `ai-provider-consent.json` survived a
 * full erase for as long as it did. The guard matched `*_STORAGE_KEY` only, and
 * `CONSENT_STORE_FILE` does not end in `_STORAGE_KEY`. The companion "every
 * location has an erase step" assertion passed because `DATA_LOCATIONS` did
 * not list the file either — an omission cannot be caught by a check that
 * reads the same omission as its input. And the anti-inert assertion here
 * (`DECLARED.length >= 4`) went on passing throughout, because it counts
 * storage keys, which were fine.
 *
 * That last point is why the store-file half below has its OWN anti-inert
 * assertion. A single count over one population is the shape that let a guard
 * report health for a thing it had never looked at.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, shippedText, walk } from '../../../lib/repo-scan';
import { CONSENT_STORE_FILE } from '../../analysis/consent';
import { BOARD_STORE_FILE } from '../../boards/port';
import { DATA_LOCATIONS } from '../privacy/dataLocations';

import { ERASED_STORE_FILES, LOCAL_STORAGE_PREFIX, forgetLocalStorage } from './port';

const APP_SRC = join(REPO_ROOT, 'apps/light/src');
const FILES = walk(APP_SRC, { extensions: ['.ts', '.tsx'] });

/** `export const WELCOME_STORAGE_KEY = 'cviper.light.welcomeSeen';` → the literal. */
export function storageKeyLiteralsIn(source: string): string[] {
  return [...source.matchAll(/\b[A-Z_]+_STORAGE_KEY\s*=\s*['"`]([^'"`]+)['"`]/g)].map(
    (match) => match[1] ?? '',
  );
}

/** `export const CONSENT_STORE_FILE = 'ai-provider-consent.json';` → the literal. */
export function storeFileLiteralsIn(source: string): string[] {
  return [...source.matchAll(/\b[A-Z_]+_STORE_FILE\s*=\s*['"`]([^'"`]+)['"`]/g)].map(
    (match) => match[1] ?? '',
  );
}

const DECLARED = FILES.flatMap((file) =>
  storageKeyLiteralsIn(shippedText(file)).map((key) => ({ file: displayPath(file), key })),
);

const DECLARED_STORE_FILES = FILES.flatMap((file) =>
  storeFileLiteralsIn(shippedText(file)).map((store) => ({ file: displayPath(file), store })),
);

describe('every localStorage key is under the erase prefix', () => {
  it('finds the stores that exist', () => {
    // Anti-inert: the four known stores must be seen, or the walk is broken.
    // This counts STORAGE KEYS ONLY — the store files have their own count.
    expect(DECLARED.length).toBeGreaterThanOrEqual(4);
    expect(DECLARED.map((entry) => entry.key)).toContain('cviper.light.welcomeSeen');
  });

  it('would catch a key under a different prefix', () => {
    expect(storageKeyLiteralsIn("export const X_STORAGE_KEY = 'lightApp.thing';")).toEqual([
      'lightApp.thing',
    ]);
  });

  it('finds none outside the prefix', () => {
    const outside = DECLARED.filter((entry) => !entry.key.startsWith(LOCAL_STORAGE_PREFIX));
    expect(
      outside,
      `Every localStorage key must start with "${LOCAL_STORAGE_PREFIX}" so "delete everything" removes it.`,
    ).toEqual([]);
  });
});

describe('every store file is listed for the user and erased', () => {
  it('finds the store files that exist', () => {
    // Anti-inert, and SEPARATE from the storage-key count above on purpose:
    // one number covering both populations is how the consent file went
    // unnoticed while the guard reported itself healthy.
    expect(DECLARED_STORE_FILES.length).toBeGreaterThanOrEqual(2);
    const found = DECLARED_STORE_FILES.map((entry) => entry.store);
    expect(found).toContain(BOARD_STORE_FILE);
    expect(found).toContain(CONSENT_STORE_FILE);
  });

  it('would catch a store file declared anywhere in the app', () => {
    expect(storeFileLiteralsIn("export const NOTES_STORE_FILE = 'notes.json';")).toEqual([
      'notes.json',
    ]);
    // An import of the constant is not a declaration of one.
    expect(storeFileLiteralsIn("import { NOTES_STORE_FILE } from './notes';")).toEqual([]);
  });

  it('names every one of them in the privacy notice', () => {
    const unlisted = DECLARED_STORE_FILES.filter(
      (entry) => !DATA_LOCATIONS.some((location) => location.where.includes(entry.store)),
    );
    expect(
      unlisted,
      'Every store file must appear in DATA_LOCATIONS, or the privacy notice and the "this will remove" list are both short of a file that exists.',
    ).toEqual([]);
  });

  it('erases every one of them', () => {
    const survivors = DECLARED_STORE_FILES.filter(
      (entry) => !ERASED_STORE_FILES.includes(entry.store),
    );
    expect(
      survivors,
      'Every store file must be in ERASED_STORE_FILES, or it survives "delete everything" while the screen says nothing did.',
    ).toEqual([]);
  });

  it('erases nothing it has not found on disk — the list is not a wish', () => {
    // The other direction: a filename left in the erase list after the store
    // it belonged to was deleted is dead code that reads as coverage.
    const declared = DECLARED_STORE_FILES.map((entry) => entry.store);
    expect(ERASED_STORE_FILES.filter((file) => !declared.includes(file))).toEqual([]);
  });
});

describe('forgetLocalStorage', () => {
  function fakeStorage(entries: Record<string, string>): Storage {
    const map = new Map(Object.entries(entries));
    return {
      get length() {
        return map.size;
      },
      key: (index) => [...map.keys()][index] ?? null,
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
      clear: () => map.clear(),
    };
  }

  it('removes every key under the prefix and nothing else', () => {
    const store = fakeStorage({
      'cviper.light.welcomeSeen': '1',
      'cviper.light.search': '{}',
      'someone-elses-key': 'kept',
    });

    expect(forgetLocalStorage(store)).toBe(2);
    expect(store.getItem('someone-elses-key')).toBe('kept');
    expect(store.length).toBe(1);
  });

  it('removes ALL prefixed keys, not every other one', () => {
    // Deleting while iterating by index is the classic every-other-key bug.
    const entries: Record<string, string> = {};
    for (let index = 0; index < 7; index += 1) entries[`cviper.light.k${index}`] = 'x';
    const store = fakeStorage(entries);

    expect(forgetLocalStorage(store)).toBe(7);
    expect(store.length).toBe(0);
  });

  it('is a no-op with no storage at all', () => {
    expect(forgetLocalStorage(null)).toBe(0);
  });
});
