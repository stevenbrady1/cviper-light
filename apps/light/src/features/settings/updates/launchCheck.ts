/**
 * One preference: may this app look for a new version when it starts?
 *
 * ============================================================================
 * THE DEFAULT IS ON, AND THAT IS A DELIBERATE CHANGE (L-92)
 * ============================================================================
 * This app used to check only when a button was pressed, and said so proudly.
 * The reason that changed is not convenience: a direct-download build has NO
 * store behind it. Nothing else can tell somebody that a version with a
 * security fix exists. An app that can only be updated by a user who thinks to
 * go looking is an app most people never update.
 *
 * What makes default-on defensible is that the request is small, explained on
 * the same screen, and genuinely switchable — and that switching it off means
 * ZERO requests rather than a quieter one. `launch.test.tsx` pins both halves.
 *
 * ============================================================================
 * UNREADABLE STORAGE RESOLVES TO THE DEFAULT, NOT TO "OFF"
 * ============================================================================
 * A private window, cleared site data or an embedder that throws on the mere
 * property access all produce "no answer". Resolving that to OFF would mean a
 * user who chose the default silently stopped receiving updates, which is the
 * failure this feature exists to prevent, and they would never find out.
 *
 * So no-answer means the default, and the default is on. The user's explicit
 * OFF is the only thing that switches it off, and that is a value that was
 * written down — see `setUpdateCheckOnLaunch`.
 *
 * ============================================================================
 * WHY `localStorage`
 * ============================================================================
 * The same decision as `onboarding/store.ts`, `search/memory.ts` and
 * `jobs/quotaStore.ts`. A preference that means nothing on another machine
 * does not belong in SQLite, in the export file, or in a migration.
 *
 * The key starts with `cviper.light.` so "delete everything" removes it —
 * `erase/localStorageKeys.contract.test.ts` fails the build if it does not.
 */

/** Exported so tests assert against the real key rather than a copy of it. */
export const UPDATE_CHECK_STORAGE_KEY = 'cviper.light.updateCheckOnLaunch';

/** The only value that means "the user switched this off". */
const OFF = 'off';

/** What is written when the user switches it back on. */
const ON = 'on';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Some embedders throw on the property access itself when storage is
    // disabled, rather than returning undefined.
    return null;
  }
}

/**
 * Should the app check for an update when it starts?
 *
 * `false` ONLY when the user has explicitly switched it off. Everything else —
 * nothing stored, unreadable storage, a value written by a future version —
 * is the default, which is on.
 */
export function updateCheckOnLaunchEnabled(): boolean {
  const store = storage();
  if (store === null) return true;

  try {
    return store.getItem(UPDATE_CHECK_STORAGE_KEY) !== OFF;
  } catch {
    return true;
  }
}

/**
 * Record the user's choice.
 *
 * `on` is written rather than the key being removed, so a deliberate "yes" and
 * a machine that has never been asked are distinguishable if that ever matters.
 */
export function setUpdateCheckOnLaunch(enabled: boolean): void {
  try {
    storage()?.setItem(UPDATE_CHECK_STORAGE_KEY, enabled ? ON : OFF);
  } catch {
    // Nothing to tell the user: the switch still moves, because what the
    // screen shows is component state. The preference simply will not survive
    // a restart on a machine whose storage cannot be written.
  }
}
