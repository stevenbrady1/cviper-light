/**
 * Where the user's board choices live.
 *
 * ============================================================================
 * `tauri-plugin-store`, NOT `localStorage`, AND NOT SQLITE.
 * ============================================================================
 * The other disposable preferences in this app (`search/memory.ts`,
 * `jobs/quotaStore.ts`, `onboarding/store.ts`) are `localStorage`, and the
 * reasoning there still holds for them: they are the state of a text box.
 *
 * This one is different in the way that matters. A board somebody ADDED is
 * something they made — a URL they worked out and typed in — and losing it
 * because the WebView cleared its origin data would be losing their work, not
 * their scroll position. `tauri-plugin-store` writes a real file in the app's
 * data directory, which survives that.
 *
 * It is still not SQLite: it is a preference, not a record. Putting it in the
 * database would mean a migration, a table, and a row in the export file that
 * means nothing on another machine.
 *
 * ============================================================================
 * A FAILED READ IS NOT THE SAME AS "NO PREFERENCES"
 * ============================================================================
 * Both are reported, because they are different facts. Falling back to the
 * shipped defaults is the right thing for the BUTTONS — a row of boards that
 * always works is the point of the feature — but it is the wrong thing to do
 * silently on the SETTINGS screen, where the user would see every board they
 * had switched off quietly switched back on and no explanation. So `read`
 * returns a `Result` and each caller answers for itself.
 */
import { err, ok, type Result } from '@cviper/core-types';

import { parseBoardPreferences, type BoardPreferences } from './model';

/** The file, in the app's own data directory. Exported so tests name the real one. */
export const BOARD_STORE_FILE = 'job-boards.json';

/** The single key inside it. */
export const BOARD_STORE_KEY = 'preferences';

export interface BoardPreferencesProblem {
  /** Legible enough to show a user without further translation. */
  readonly message: string;
}

export interface BoardPreferencesPort {
  read(): Promise<Result<BoardPreferences, BoardPreferencesProblem>>;
  write(next: BoardPreferences): Promise<Result<void, BoardPreferencesProblem>>;
}

/** The text of an unknown thrown value, without assuming it is an `Error`. */
function describeThrown(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string' && cause.trim() !== '') return cause;
  return 'The file could not be read or written.';
}

export function createTauriBoardPreferencesPort(): BoardPreferencesPort {
  /*
   * Imported inside the call, the same way `updates/port.ts` does it: merely
   * rendering a screen should not pull a Tauri plugin into the module graph,
   * and in a Vitest run there is no Tauri runtime to pull it into.
   */
  async function open() {
    const { load } = await import('@tauri-apps/plugin-store');
    // `autoSave: false`: this app saves when the user changes something and at
    // no other moment, so what is on disk is never a debounce behind what is
    // on screen.
    return load(BOARD_STORE_FILE, { autoSave: false });
  }

  return {
    async read() {
      try {
        const store = await open();
        return ok(parseBoardPreferences(await store.get(BOARD_STORE_KEY)));
      } catch (cause) {
        return err({
          message: `Your job-board choices could not be read, so the boards CViper ships with are shown instead. ${describeThrown(cause)}`,
        });
      }
    },

    async write(next) {
      try {
        const store = await open();
        await store.set(BOARD_STORE_KEY, next);
        // Explicit, because `autoSave` is off. Without this the change is in
        // memory only and is gone at the next launch.
        await store.save();
        return ok(undefined);
      } catch (cause) {
        return err({
          message: `That change could not be saved, so it will be gone when CViper restarts. ${describeThrown(cause)}`,
        });
      }
    },
  };
}
