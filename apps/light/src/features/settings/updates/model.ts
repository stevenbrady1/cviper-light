/**
 * What the update check is doing, and what to say about it.
 *
 * No React and no plugin import, so the whole state machine can be tested
 * without a Tauri runtime — and so the module that DOES import the plugin stays
 * small enough to audit by eye (`port.ts`).
 */
import { type Result } from '@cviper/core-types';

import { type UpdateInfo, type UpdateProblem } from './port';

/**
 * The sentence that makes the absence of a launch-time check legible.
 *
 * ============================================================================
 * SAY IT, BECAUSE AN ABSENCE LOOKS LIKE AN OVERSIGHT.
 * ============================================================================
 * This app tells the user it collects nothing. A silent HTTPS request on launch
 * — even one carrying only an IP address and a version string — would make that
 * false, on a screen that says otherwise. So there is no automatic check.
 *
 * But a missing feature and a deliberate omission look identical from the
 * outside. Without this sentence the honest choice reads as something nobody
 * got round to, and the user learns nothing about what the app does with their
 * network. With it, the design is visible.
 */
export const NO_AUTOMATIC_CHECK_NOTE =
  'CViper Light never checks on its own — not at startup, not in the ' +
  'background. Nothing leaves this machine until you press it, and what leaves ' +
  'is a request for a version number.';

export type UpdateState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  /** Asked, and this build is the newest one published. */
  | { readonly kind: 'current' }
  | { readonly kind: 'available'; readonly version: string; readonly notes: string | null }
  | { readonly kind: 'installing' }
  /** Downloaded and written. The new version starts on the next launch. */
  | { readonly kind: 'installed' }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Turn a finished check into the next state.
 *
 * A pure function over the port's `Result`, so the interesting half of this
 * feature is testable without rendering anything or reaching a network.
 */
export function nextStateAfterCheck(result: Result<UpdateInfo | null, UpdateProblem>): UpdateState {
  if (!result.ok) return { kind: 'failed', message: result.error.message };
  if (result.value === null) return { kind: 'current' };

  return { kind: 'available', version: result.value.version, notes: result.value.notes };
}

/**
 * One line for the user, or `null` when the button already says everything.
 *
 * The failure branch passes the port's own message through untouched. Those
 * messages name the cause — no network, an unverifiable signature, a release
 * feed that is not there — and when a signature will not verify the message IS
 * the diagnosis. Replacing it with "update check failed" would leave the reader
 * with nothing to act on.
 */
export function describeUpdateState(state: UpdateState, currentVersion: string): string | null {
  switch (state.kind) {
    case 'idle':
      return null;
    case 'checking':
      return 'Asking GitHub whether there is a newer version…';
    case 'current':
      return `You are on ${currentVersion}, which is the newest version.`;
    case 'available':
      return state.notes === null
        ? `Version ${state.version} is available. You are on ${currentVersion}.`
        : `Version ${state.version} is available. You are on ${currentVersion}. ${state.notes}`;
    case 'installing':
      return 'Downloading and installing. Leave the window open.';
    case 'installed':
      return 'Installed. Restart CViper Light to finish — your data is untouched.';
    case 'failed':
      return state.message;
  }
}
