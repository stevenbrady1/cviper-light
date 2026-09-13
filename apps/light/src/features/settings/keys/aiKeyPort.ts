/**
 * The four things an AI key card does to the outside world, and nothing else.
 *
 * ============================================================================
 * ONE PORT, ONE PROVIDER — BUILT PER CARD, NOT PER CALL
 * ============================================================================
 * `createTauriAiKeyPort(secret, providerId)` closes over which credential and
 * which `ProviderId` this instance speaks for, the same way `AiKeyProvider`
 * itself is one record per provider. `AiKeySetup` builds one port per card, so
 * every method here stays a plain zero-argument (or key-only) call — exactly
 * the shape `AiKeySetup.test.tsx`'s fake already had before Anthropic existed,
 * so that file needed no change beyond the one line that wires its fake to the
 * OpenAI card specifically.
 *
 * ============================================================================
 * TEST FIRST, SAVE SECOND. THE ORDER IS THE FEATURE.
 * ============================================================================
 * `test` sends the key the user just typed straight to the provider and saves
 * NOTHING. `save` is a separate call the caller only makes once the test has
 * come back green. A test that wrote first and rolled back on failure would
 * have already overwritten the working key it was replacing — and a crash mid
 * roll-back would leave the bad one in place with nothing to say so.
 *
 * `provider_test_key` in `providers.rs` has no route to the credential store at
 * all, and a Rust test asserts it: the two halves of the same guarantee, one on
 * each side of the boundary.
 *
 * ============================================================================
 * NOTHING HERE CAN READ A KEY BACK
 * ============================================================================
 * `status` answers a BOOL, and that is the whole of what this app can learn
 * about a stored credential. There is no command that answers anything more:
 * `secret_get` is deliberately not registered, and the `secret_hint` that once
 * returned the last four characters was removed before it shipped (see the
 * module comment in `src-tauri/src/secrets.rs`). A reveal affordance is
 * unimplementable rather than merely absent.
 */
import { invoke } from '@tauri-apps/api/core';

import { err, ok, type Result } from '@cviper/core-types';

// LOAD-BEARING, top-level `import type` (I3, coordinator review of PR #96) —
// per `aiKeyProviders.ts`'s own rule: `verbatimModuleSyntax` erases this
// entirely, while the inline spelling `import { type AiKeySecret }` still
// emits a runtime `import {} from './aiKeyModel'`. Only these two are pure
// types with no runtime member, so the whole import can be type-only; `err`,
// `ok` and `Result` above carry runtime values and stay as they are.
import type { AiKeyProviderId, AiKeySecret } from './aiKeyModel';

/** The command names registered in `generate_handler!`. */
const TEST_COMMAND = 'provider_test_key';

/** A credential store that would not do what was asked. */
export interface AiKeyStoreError {
  /** Legible enough to show a user without further translation. */
  readonly message: string;
}

/**
 * A key test that did not pass.
 *
 * Carries only a message, because Rust has already decided which of the fixed
 * sentences applies. Branching on a `kind` here would be a second place for the
 * same decision to be made differently.
 */
export interface AiKeyTestFailure {
  readonly message: string;
}

export interface AiKeyPort {
  /** Is a key saved? `null` = the store would not say. Never the value. */
  status(): Promise<boolean | null>;
  /** Prove this key works, WITHOUT saving it. */
  test(key: string): Promise<Result<void, AiKeyTestFailure>>;
  /** Write the key to the OS credential store. */
  save(key: string): Promise<Result<void, AiKeyStoreError>>;
  /** Remove it. */
  remove(): Promise<Result<void, AiKeyStoreError>>;
}

/** Shown when Rust fails in a way this file cannot read at all. */
const UNREADABLE_FAILURE = 'The key could not be tested. Try again in a moment.';

/**
 * Pull the sentence out of Rust's `{kind, message}` rejection.
 *
 * Defensive on purpose: a Tauri-level failure — the command not registered, a
 * broken IPC — rejects with something else entirely, and that must still
 * produce a sentence rather than a crash inside the error handler or raw JSON
 * on screen.
 */
function describeRustFailure(thrown: unknown): string {
  if (typeof thrown === 'string') {
    try {
      const parsed: unknown = JSON.parse(thrown);
      if (typeof parsed === 'object' && parsed !== null) {
        const message = (parsed as Record<string, unknown>)['message'];
        if (typeof message === 'string' && message.length > 0) return message;
      }
    } catch {
      // Not JSON. Fall through rather than showing the user a raw payload.
    }
    if (thrown.trim() !== '') return thrown;
  }

  if (thrown instanceof Error && thrown.message.length > 0) return thrown.message;

  // Never `String(thrown)` — an object renders as "[object Object]", which tells
  // the user nothing and looks like a bug in the app rather than in the call.
  return UNREADABLE_FAILURE;
}

/** The text of a credential-store refusal, without assuming it is an `Error`. */
function describeStoreFailure(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message;
  if (typeof thrown === 'string' && thrown.trim() !== '') return thrown;
  return 'This computer’s credential store did not answer. Try again in a moment.';
}

/**
 * @param secret Which credential this card reads and writes — spelled exactly
 *   as `SecretKey` serialises it in Rust (`OPENAI_SECRET_KEY`,
 *   `ANTHROPIC_SECRET_KEY`).
 * @param providerId Which `ProviderId` variant `provider_test_key` should try.
 *   `AiKeyProviderId`'s values are spelled identically to how Rust's
 *   `ProviderId` enum serialises (`'openai'`, `'anthropic'`), so this is
 *   passed straight through with nothing to translate.
 */
export function createTauriAiKeyPort(secret: AiKeySecret, providerId: AiKeyProviderId): AiKeyPort {
  return {
    async status() {
      try {
        const answer = await invoke('secret_status', { key: secret });
        // A non-boolean answer means Rust and this file disagree about the
        // command. Treating a truthy string as "yes" would claim a key exists
        // on the word of a bug, and the analysis screen would then offer an
        // option that cannot work.
        return typeof answer === 'boolean' ? answer : null;
      } catch {
        return null;
      }
    },

    async test(key) {
      try {
        // The argument names must be the Rust parameter names exactly. A
        // rename on either side would otherwise break silently at runtime —
        // see `the_frontend_calls_the_key_test_by_this_name` in `providers.rs`,
        // which greps for this exact literal shape.
        await invoke(TEST_COMMAND, { provider: providerId, key });
        return ok(undefined);
      } catch (thrown) {
        return err({ message: describeRustFailure(thrown) });
      }
    },

    async save(key) {
      try {
        await invoke('secret_set', { key: secret, value: key });
        return ok(undefined);
      } catch (thrown) {
        // Never swallowed. A save that silently did nothing would leave the
        // user believing a key is in place until their next analysis fails.
        return err({ message: describeStoreFailure(thrown) });
      }
    },

    async remove() {
      try {
        await invoke('secret_delete', { key: secret });
        return ok(undefined);
      } catch (thrown) {
        return err({ message: describeStoreFailure(thrown) });
      }
    },
  };
}
