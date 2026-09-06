/**
 * The three things "delete everything" does to the outside world.
 *
 * ============================================================================
 * THREE STEPS, BECAUSE THERE ARE THREE PLACES
 * ============================================================================
 * `dataLocations.ts` lists where every byte lives: the SQLite database, the
 * OS credential store, and the preferences (a Tauri store file plus this
 * app's browser storage). Each has its own failure mode — a locked database,
 * a credential store that wants the user's password, a file that will not
 * write — and a user who is told "delete everything failed" learns nothing.
 * So each place is its own step with its own result, and `runErase` in
 * `model.ts` runs ALL of them whatever happens to the others: a keychain that
 * refuses must not leave the database full because the code gave up early.
 *
 * ============================================================================
 * NOTHING HERE CAN READ ANYTHING BACK
 * ============================================================================
 * Deleting a key uses `secret_delete`, which is idempotent on the Rust side
 * and, like every secret command, has no way to return a value. Wiping the
 * database issues `DELETE`s and a `VACUUM`; nothing is selected first. The
 * erase path never holds the user's data in memory on its way out.
 */
import { invoke } from '@tauri-apps/api/core';

import { err, ok, type Result } from '@cviper/core-types';

import { wipeAll } from '../../../db';
import { SECRET_KEYS } from '../../../status/environment';
import { BOARD_STORE_FILE } from '../../boards/port';

/** A step that would not do what was asked, in words a user can read. */
export interface EraseProblem {
  readonly message: string;
}

export interface ErasePort {
  /** Every row in every table, then compact the file. */
  wipeDatabase(): Promise<Result<void, EraseProblem>>;
  /** Every credential this app knows the name of, from the OS credential store. */
  forgetKeys(): Promise<Result<void, EraseProblem>>;
  /** The job-board choices file and every entry in this app's browser storage. */
  forgetPreferences(): Promise<Result<void, EraseProblem>>;
}

/**
 * Every `localStorage` key this app writes starts with this. Pinned by
 * `localStorageKeys.contract.test.ts`: a store added under a different prefix
 * would survive "delete everything", and the guard fails the build instead.
 */
export const LOCAL_STORAGE_PREFIX = 'cviper.light.';

/** The text of an unknown thrown value, without assuming it is an `Error`. */
function describeThrown(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string' && cause.trim() !== '') return cause;
  return 'No reason was given.';
}

/**
 * Remove every key under the prefix. Returns how many went, for the tests.
 *
 * Collected first, then removed: deleting while iterating `localStorage` by
 * index skips every other key, which is exactly the silent half-erase this
 * feature exists to rule out.
 */
export function forgetLocalStorage(store: Storage | null): number {
  if (store === null) return 0;
  const doomed: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key !== null && key.startsWith(LOCAL_STORAGE_PREFIX)) doomed.push(key);
  }
  for (const key of doomed) store.removeItem(key);
  return doomed.length;
}

export function createTauriErasePort(): ErasePort {
  return {
    async wipeDatabase() {
      const wiped = await wipeAll();
      return wiped.ok ? ok(undefined) : err({ message: wiped.error.message });
    },

    async forgetKeys() {
      // Every one is attempted, and the message names the FIRST that refused.
      // Stopping at the first failure would leave later keys in place with
      // nothing said about them.
      let first: EraseProblem | null = null;
      for (const key of SECRET_KEYS) {
        try {
          await invoke('secret_delete', { key });
        } catch (cause) {
          first ??= { message: `${key}: ${describeThrown(cause)}` };
        }
      }
      return first === null ? ok(undefined) : err(first);
    },

    async forgetPreferences() {
      // Browser storage first: it cannot fail, and doing it before the file
      // means a store error never leaves it behind.
      forgetLocalStorage(typeof localStorage === 'undefined' ? null : localStorage);

      try {
        // Imported inside the call, as `boards/port.ts` does: rendering a
        // screen should not pull a Tauri plugin into the module graph.
        const { load } = await import('@tauri-apps/plugin-store');
        const store = await load(BOARD_STORE_FILE, { autoSave: false });
        await store.clear();
        await store.save();
        return ok(undefined);
      } catch (cause) {
        return err({
          message: `Your job-board choices file could not be cleared. ${describeThrown(cause)}`,
        });
      }
    },
  };
}
