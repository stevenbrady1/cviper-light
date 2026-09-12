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
 * What the Updates section says, in each of the two states it can be in.
 *
 * ============================================================================
 * SAY WHICH ONE IT IS, BECAUSE THE USER CANNOT SEE A REQUEST
 * ============================================================================
 * There are now two honest sentences here rather than one, because there are
 * two behaviours and the user chooses between them (L-92). Whichever is on
 * screen has to be TRUE of the build the person is looking at — a note that
 * says "never checks on its own" while a launch check is switched on is worse
 * than no note, because it teaches the reader that this screen lies.
 *
 * Both sentences say the same three things in the same order: when a request
 * happens, what it carries, and what the other setting would do. Neither is
 * reassurance; both are descriptions somebody could go and check.
 */

/**
 * The note when the launch check is OFF.
 *
 * ============================================================================
 * AN ABSENCE LOOKS LIKE AN OVERSIGHT UNLESS YOU NAME IT.
 * ============================================================================
 * A missing feature and a deliberate omission look identical from the outside.
 * Without this sentence the honest choice reads as something nobody got round
 * to, and the user learns nothing about what the app does with their network.
 *
 * Left byte-for-byte as it was: it is still exactly true when the switch is
 * off, and `model.test.ts` holds it to the two facts it has to state.
 */
export const NO_AUTOMATIC_CHECK_NOTE =
  'CViper Light never checks on its own — not at startup, not in the ' +
  'background. Nothing leaves this machine until you press it, and what leaves ' +
  'is a request for a version number.';

/**
 * The note when the launch check is ON, which is the default.
 *
 * ============================================================================
 * THE DEFAULT HAS TO EXPLAIN ITSELF, NOT JUST BE DISCLOSED
 * ============================================================================
 * This is the state most people will be in without choosing it, so the
 * sentence has to do more than be technically accurate: it says WHEN (once, at
 * startup), WHAT (a version number and nothing else), and WHAT THE OTHER
 * SETTING DOES (no request at all, rather than a quieter one).
 *
 * "unless you press the button" is load-bearing and must not be tidied away —
 * an absolute claim with its exception stated in the same breath is an honest
 * claim, and `privacy-promise.contract.test.ts` recognises the shape.
 */
export const AUTOMATIC_CHECK_NOTE =
  'CViper Light looks for a new version once when it starts, and asks for ' +
  'nothing but a version number — no account, no identifier, nothing about ' +
  'you. Switch it off and it makes no update request at all: nothing leaves ' +
  'this machine unless you press the button.';

/** The switch itself. Plain, and it names the app so the scope is obvious. */
export const UPDATE_CHECK_TOGGLE_LABEL = 'Check for updates when CViper Light starts';

/** The note that belongs with the setting as it currently stands. */
export function updateCheckNote(checksOnLaunch: boolean): string {
  return checksOnLaunch ? AUTOMATIC_CHECK_NOTE : NO_AUTOMATIC_CHECK_NOTE;
}

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
