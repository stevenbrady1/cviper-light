/**
 * The local-storage contract: every `localStorage` key this app writes starts
 * with `LOCAL_STORAGE_PREFIX`, so "delete everything" can find it.
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
 * four stores by name. It finds every `*_STORAGE_KEY = '…'` declaration in
 * the app and forbids one that does not start with the prefix, so the fifth
 * store is caught without anyone editing this file.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, shippedText, walk } from '../../../lib/repo-scan';

import { LOCAL_STORAGE_PREFIX, forgetLocalStorage } from './port';

const APP_SRC = join(REPO_ROOT, 'apps/light/src');
const FILES = walk(APP_SRC, { extensions: ['.ts', '.tsx'] });

/** `export const WELCOME_STORAGE_KEY = 'cviper.light.welcomeSeen';` → the literal. */
export function storageKeyLiteralsIn(source: string): string[] {
  return [...source.matchAll(/\b[A-Z_]+_STORAGE_KEY\s*=\s*['"`]([^'"`]+)['"`]/g)].map(
    (match) => match[1] ?? '',
  );
}

const DECLARED = FILES.flatMap((file) =>
  storageKeyLiteralsIn(shippedText(file)).map((key) => ({ file: displayPath(file), key })),
);

describe('every localStorage key is under the erase prefix', () => {
  it('finds the stores that exist', () => {
    // Anti-inert: the four known stores must be seen, or the walk is broken.
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
