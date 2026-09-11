/**
 * The five things the OpenAI key card does to the outside world, and nothing
 * else.
 *
 * ============================================================================
 * TEST FIRST, SAVE SECOND. THE ORDER IS THE FEATURE.
 * ============================================================================
 * `test` sends the key the user just typed straight to OpenAI and saves
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
 * `status` answers a bool and `hint` answers bullets plus at most four
 * characters, both computed in Rust. There is no command that answers anything
 * more — `secret_get` is deliberately not registered (see the module comment in
 * `src-tauri/src/secrets.rs`), so a reveal affordance is unimplementable rather
 * than merely absent.
 */
import { invoke } from '@tauri-apps/api/core';

import { err, ok, type Result } from '@cviper/core-types';

import { OPENAI_SECRET_KEY } from './aiKeyModel';

/** The command names registered in `generate_handler!`. */
const TEST_COMMAND = 'provider_test_key';
const HINT_COMMAND = 'secret_hint';

/** The `ProviderId` variant Rust expects, spelled as serde serialises it. */
const OPENAI_PROVIDER = 'openai';

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
  /** Is a key saved? `null` = the store would not say. */
  status(): Promise<boolean | null>;
  /** Bullets and at most the last four characters, or `null` if nothing is saved. */
  hint(): Promise<string | null>;
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

export function createTauriAiKeyPort(): AiKeyPort {
  return {
    async status() {
      try {
        const answer = await invoke('secret_status', { key: OPENAI_SECRET_KEY });
        // A non-boolean answer means Rust and this file disagree about the
        // command. Treating a truthy string as "yes" would claim a key exists
        // on the word of a bug, and the analysis screen would then offer an
        // OpenAI option that cannot work.
        return typeof answer === 'boolean' ? answer : null;
      } catch {
        return null;
      }
    },

    async hint() {
      try {
        const answer = await invoke(HINT_COMMAND, { key: OPENAI_SECRET_KEY });
        return typeof answer === 'string' ? answer : null;
      } catch {
        // A hint is a convenience. A store that will not answer is reported by
        // `status`, which is what the card actually renders its state from.
        return null;
      }
    },

    async test(key) {
      try {
        await invoke(TEST_COMMAND, { provider: OPENAI_PROVIDER, key });
        return ok(undefined);
      } catch (thrown) {
        return err({ message: describeRustFailure(thrown) });
      }
    },

    async save(key) {
      try {
        await invoke('secret_set', { key: OPENAI_SECRET_KEY, value: key });
        return ok(undefined);
      } catch (thrown) {
        // Never swallowed. A save that silently did nothing would leave the
        // user believing a key is in place until their next analysis fails.
        return err({ message: describeStoreFailure(thrown) });
      }
    },

    async remove() {
      try {
        await invoke('secret_delete', { key: OPENAI_SECRET_KEY });
        return ok(undefined);
      } catch (thrown) {
        return err({ message: describeStoreFailure(thrown) });
      }
    },
  };
}
