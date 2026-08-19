/**
 * One boolean: has this person seen the welcome?
 *
 * ============================================================================
 * `localStorage`, LIKE EVERY OTHER DISPOSABLE PREFERENCE HERE.
 * ============================================================================
 * The same decision as `search/memory.ts`, `jobs/quotaStore.ts` and
 * `status/requestLog.ts`. Putting it in SQLite would mean a migration, a table
 * and a row in the user's export file for a fact that means nothing on another
 * machine and nothing next year.
 *
 * ============================================================================
 * UNREADABLE STORAGE COUNTS AS SEEN. THAT ASYMMETRY IS THE POINT.
 * ============================================================================
 * Every other store in this app treats an unavailable `localStorage` as "no
 * data" and carries on. Here that would produce a welcome overlay on EVERY
 * launch with a dismiss button that silently never works — a trap, and one the
 * user cannot escape without uninstalling.
 *
 * So a storage failure resolves the other way: the welcome does not appear. The
 * cost is one first-time user missing one screen, and that screen is reachable
 * from Settings for as long as the app exists.
 */

/** Exported so tests assert against the real key rather than a copy of it. */
export const WELCOME_STORAGE_KEY = 'cviper.light.welcomeSeen';

/** The only value that counts as yes. */
const SEEN = 'seen';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Some embedders throw on the mere property access when storage is
    // disabled.
    return null;
  }
}

/**
 * Has the welcome been dismissed?
 *
 * `true` when the flag says so, and `true` again when storage cannot be read at
 * all — see the header. Anything else, including a value written by a future
 * version, is `false`: the welcome is cheap to show and impossible to
 * misinterpret.
 */
export function hasSeenWelcome(): boolean {
  const store = storage();
  if (store === null) return true;

  try {
    return store.getItem(WELCOME_STORAGE_KEY) === SEEN;
  } catch {
    return true;
  }
}

export function markWelcomeSeen(): void {
  try {
    storage()?.setItem(WELCOME_STORAGE_KEY, SEEN);
  } catch {
    // Nothing to do and nothing to tell the user. The overlay still closes —
    // the dismiss is state in the component, not a read of this flag.
  }
}

/** Show it again. The Settings button that reopens the welcome calls this. */
export function forgetWelcome(): void {
  try {
    storage()?.removeItem(WELCOME_STORAGE_KEY);
  } catch {
    // Same reasoning as above.
  }
}
