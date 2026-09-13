/**
 * The production `KeylessFetchTransport`: a thin wrapper over `invoke()`.
 *
 * ============================================================================
 * A SEPARATE TRANSPORT FROM `transport.ts`, DELIBERATELY
 * ============================================================================
 * They look alike and they are not the same thing. `transport.ts` invokes
 * `job_search`, which reads the user's Adzuna and Reed keys out of the
 * credential store; this invokes `keyless_fetch`, which `keyless.rs` proves
 * cannot reach the credential store at all.
 *
 * Folding them into one function to save twenty lines would put the keyed and
 * the keyless path behind the same door, and the structural guarantee — "this
 * request cannot carry a key, and here is the test that says so" — would become
 * a matter of which branch was taken at runtime. Two doors is the point.
 *
 * As in `transport.ts`, nothing here knows a URL. The command takes a feed name
 * from a two-value union and a page number, and Rust owns both addresses.
 */
import { invoke } from '@tauri-apps/api/core';

import {
  keylessError,
  type JobApiHttpResponse,
  type KeylessError,
  type KeylessErrorKind,
  type KeylessFetchTransport,
  type KeylessSourceId,
} from '@cviper/job-apis';
import { err, ok, type Result } from '@cviper/core-types';

import { recordRequest } from '../status/requestLog';

/** The command name registered in `generate_handler!`. */
const FETCH_COMMAND = 'keyless_fetch';

/**
 * Error kinds Rust is allowed to name.
 *
 * A closed list rather than a cast, for the same reason `transport.ts` keeps
 * one: an unrecognised kind from a future Rust change must degrade to something
 * the UI can still render, not become a `KeylessErrorKind` that no branch
 * handles. `keyless.rs` has a test asserting every kind it emits is a member of
 * the TypeScript union, so the two can only drift deliberately.
 */
const RUST_ERROR_KINDS = new Set<KeylessErrorKind>([
  'network',
  'rate-limit',
  'server',
  'bad-response',
  'throttled',
]);

/** Shown when Rust fails in a way we cannot classify at all. */
const UNCLASSIFIED_MESSAGE = 'That job feed could not be read. Try again in a moment.';

/** Turn whatever `invoke` rejected with into a `KeylessError`. */
function toKeylessError(source: KeylessSourceId, thrown: unknown): KeylessError {
  if (typeof thrown === 'string') {
    try {
      const parsed: unknown = JSON.parse(thrown);
      if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>;
        const kind = record['kind'];
        const message = record['message'];
        if (
          typeof kind === 'string' &&
          RUST_ERROR_KINDS.has(kind as KeylessErrorKind) &&
          typeof message === 'string' &&
          message.length > 0
        ) {
          return keylessError(source, kind as KeylessErrorKind, message);
        }
      }
    } catch {
      // Not JSON. An older Rust build, or a Tauri-level rejection that happens
      // to be a string. Fall through rather than showing the user raw JSON.
    }
  }

  return keylessError(source, 'network', UNCLASSIFIED_MESSAGE);
}

/** Read the `{status, body}` envelope Rust returns for a completed request. */
function toHttpResponse(
  source: KeylessSourceId,
  raw: unknown,
): Result<JobApiHttpResponse, KeylessError> {
  if (typeof raw !== 'string') {
    return err(keylessError(source, 'bad-response', UNCLASSIFIED_MESSAGE));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err(keylessError(source, 'bad-response', UNCLASSIFIED_MESSAGE));
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return err(keylessError(source, 'bad-response', UNCLASSIFIED_MESSAGE));
  }

  const record = parsed as Record<string, unknown>;
  const status = record['status'];
  const body = record['body'];
  if (typeof status !== 'number' || typeof body !== 'string') {
    return err(keylessError(source, 'bad-response', UNCLASSIFIED_MESSAGE));
  }

  return ok({ status, body });
}

export function createTauriKeylessTransport(): KeylessFetchTransport {
  return {
    async fetch(
      source: KeylessSourceId,
      page: number,
    ): Promise<Result<JobApiHttpResponse, KeylessError>> {
      // Counted BEFORE the call and whatever the outcome, like every other
      // request this app makes. These feeds have no allowance to spend, but the
      // status strip's promise is "here is how much went out", and a request
      // that failed still left the machine.
      //
      // Wrapped because a diagnostic must never be able to fail a real request.
      try {
        recordRequest();
      } catch {
        // Nothing to do and nothing to tell the user. The request continues.
      }

      try {
        return toHttpResponse(source, await invoke(FETCH_COMMAND, { source, page }));
      } catch (thrown) {
        // Never swallowed: every failure becomes a typed error the caller must
        // narrow on before it can reach the value.
        return err(toKeylessError(source, thrown));
      }
    },
  };
}
