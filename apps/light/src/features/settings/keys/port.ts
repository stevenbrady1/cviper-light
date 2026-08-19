/**
 * The four things the key wizard does to the outside world, and nothing else.
 *
 * ============================================================================
 * TEST FIRST, SAVE SECOND. THE ORDER IS THE FEATURE.
 * ============================================================================
 * `test` sends the credentials the user just typed straight to the board and
 * saves NOTHING. `save` is a separate call the caller only makes once the test
 * has come back green. A test that wrote first and rolled back on failure would
 * have already overwritten the working key it was replacing — and a crash mid
 * roll-back would leave the bad one in place with nothing to say so.
 *
 * `port.test.ts` asserts that the test path invokes exactly one command, and
 * `jobs.rs` asserts that the command it invokes cannot reach `secret_set`. Two
 * halves of the same guarantee, one on each side of the boundary.
 *
 * ============================================================================
 * NOTHING HERE CAN READ A KEY BACK
 * ============================================================================
 * `status` answers a bool per credential, because `secret_status` answers a
 * bool and there is no command that answers anything else (see the module
 * comment in `src-tauri/src/secrets.rs`). Every state the wizard renders is
 * derived from those bools. A "reveal" affordance is not missing from the UI —
 * it is unimplementable, on purpose.
 */
import { invoke } from '@tauri-apps/api/core';

import {
  httpStatusError,
  normaliseAdzunaResponse,
  normaliseReedResponse,
  type JobApiError,
  type JobProviderId,
} from '@cviper/job-apis';
import { err, ok, type Result } from '@cviper/core-types';

import { invokeJobCommand } from '../../../jobs/transport';
import { countProviderRequest } from '../../../jobs/quotaStore';
import { type SecretKeyName } from '../../../status/environment';

import { keyProvider, type CredentialAnswers } from './model';

/** The command name registered in `generate_handler!`. See `jobs.rs`. */
const TEST_COMMAND = 'job_test_credentials';

/** Which parser reads which board's probe reply. */
const PARSERS = {
  adzuna: normaliseAdzunaResponse,
  reed: normaliseReedResponse,
} as const;

/** A credential store that would not do what was asked. */
export interface KeyStoreError {
  /** Legible enough to show a user without further translation. */
  readonly message: string;
}

export interface KeyPort {
  /** Is each of this board's credentials saved? `null` = the store would not say. */
  status(provider: JobProviderId): Promise<CredentialAnswers>;
  /**
   * Prove these credentials work, WITHOUT saving them.
   *
   * Resolves with the number of adverts the one-result probe found. Zero is a
   * pass: the board answered and the body parsed, which is the whole question.
   */
  test(
    provider: JobProviderId,
    values: Readonly<Partial<Record<SecretKeyName, string>>>,
  ): Promise<Result<number, JobApiError>>;
  /** Write one credential to the OS credential store. */
  save(key: SecretKeyName, value: string): Promise<Result<void, KeyStoreError>>;
  /** Remove EVERY credential this board needs. Half of a pair is not a key. */
  remove(provider: JobProviderId): Promise<Result<void, KeyStoreError>>;
}

/** The text of an unknown thrown value, without assuming it is an `Error`. */
function describeThrown(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string' && cause.trim() !== '') return cause;
  // Never `String(cause)` — an object renders as "[object Object]", which tells
  // the user nothing and looks like a bug in the app rather than in the store.
  return 'This computer’s credential store did not answer. Try again in a moment.';
}

/** One credential: is it there? `null` means the store could not say. */
async function credentialStatus(key: SecretKeyName): Promise<boolean | null> {
  try {
    const answer = await invoke('secret_status', { key });
    // A non-boolean answer means Rust and this file disagree about the command.
    // Treating a truthy string as "yes" would claim a key exists on the word of
    // a bug, and the user would be left wondering why searches still fail.
    return typeof answer === 'boolean' ? answer : null;
  } catch {
    // The Rust side already turned the keyring error into a sentence, and the
    // card renders "could not be read" rather than "no key saved" — see the
    // four-state note in `status/environment.ts`.
    return null;
  }
}

export function createTauriKeyPort(now: Date = new Date()): KeyPort {
  return {
    async status(provider) {
      const fields = keyProvider(provider).fields;

      // Concurrently, and independently: one locked credential must not stop
      // the app finding out about the other.
      const answers = await Promise.all(fields.map((field) => credentialStatus(field.key)));

      const state: Partial<Record<SecretKeyName, boolean | null>> = {};
      fields.forEach((field, index) => {
        state[field.key] = answers[index] ?? null;
      });
      return state;
    },

    async test(provider, values) {
      // Only the credentials this board needs. A Reed test carrying an Adzuna
      // id must not put the Adzuna id on the wire to Reed — Rust ignores the
      // extra one too, and this is the half that means it never travels.
      const supplied: Partial<Record<SecretKeyName, string>> = {};
      for (const field of keyProvider(provider).fields) {
        const value = values[field.key];
        if (value !== undefined) supplied[field.key] = value;
      }

      // Counted BEFORE the answer, and counted whatever it is. A 401 spent the
      // request just as surely as a page of results did, and the reserve of ten
      // exists precisely so a key can still be tested on a nearly-spent day.
      countProviderRequest(provider, now);

      const response = await invokeJobCommand(provider, TEST_COMMAND, { provider, supplied });
      if (!response.ok) return response;

      const { status, body } = response.value;
      if (status < 200 || status >= 300) return err(httpStatusError(provider, status));

      // Parsed with the SAME parser a real search uses. A key that authenticates
      // but returns something this app cannot read is not a working key from the
      // user's point of view, and finding that out now is the point.
      const parsed = PARSERS[provider](body, {
        createdAt: now.toISOString(),
        // The probe's adverts are counted and thrown away; they are never shown
        // and never stored, so they need no identity beyond being distinct.
        newId: () => 'key-test',
      });

      return parsed.ok ? ok(parsed.value.length) : err(parsed.error);
    },

    async save(key, value) {
      try {
        await invoke('secret_set', { key, value });
        return ok(undefined);
      } catch (thrown) {
        // Never swallowed. A save that silently did nothing would leave the
        // user believing a key is in place until their next search fails.
        return err({ message: describeThrown(thrown) });
      }
    },

    async remove(provider) {
      // Sequential, so the message names the FIRST credential that refused
      // rather than whichever promise happened to reject first.
      for (const field of keyProvider(provider).fields) {
        try {
          await invoke('secret_delete', { key: field.key });
        } catch (thrown) {
          return err({ message: describeThrown(thrown) });
        }
      }
      return ok(undefined);
    },
  };
}
