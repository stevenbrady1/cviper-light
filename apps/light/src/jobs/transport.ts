/**
 * The production `JobSearchTransport`: a thin wrapper over `invoke()` into Rust.
 *
 * ============================================================================
 * THIS FILE IS THE ONLY THING THAT KNOWS A JOB SEARCH LEAVES THE PROCESS.
 * ============================================================================
 * `@cviper/job-apis` builds typed search parameters and reads response bodies
 * and has no idea how they travel. This module supplies the how, and the how is
 * deliberately incapable of choosing a destination: it passes a provider name
 * from a two-value union and a params object whose every field is a value, and
 * Rust decides the URL, the query parameter NAMES, the timeout and the
 * credentials.
 *
 * That is why there is no base URL in this file and no API key anywhere in
 * JavaScript. See `src-tauri/src/jobs.rs`. It is the same arrangement as
 * `src/ai/transport.ts`, for the same reason.
 */
import { invoke } from '@tauri-apps/api/core';

import {
  jobApiError,
  type JobApiError,
  type JobApiErrorKind,
  type JobApiHttpResponse,
  type JobProviderId,
  type JobSearchParams,
  type JobSearchTransport,
} from '@cviper/job-apis';
import { err, ok, type Result } from '@cviper/core-types';

import { recordRequest } from '../status/requestLog';

/** The command name registered in `generate_handler!`. */
const SEARCH_COMMAND = 'job_search';

/**
 * Error kinds Rust is allowed to name.
 *
 * A closed list rather than a cast: an unrecognised kind from a future Rust
 * change must degrade to something the UI can still render, not become a
 * `JobApiErrorKind` that no switch statement handles.
 *
 * `jobs.rs` has a test asserting every kind it emits is a member of the
 * TypeScript union, so the two lists can only drift deliberately.
 */
const RUST_ERROR_KINDS = new Set<JobApiErrorKind>([
  'no-key',
  'network',
  'throttled',
  'bad-request',
  'bad-response',
]);

/** Shown when Rust fails in a way we cannot classify at all. */
const UNCLASSIFIED_MESSAGE = 'The search could not be sent. Try again.';

/**
 * Turn whatever `invoke` rejected with into a `JobApiError`.
 *
 * Rust sends a JSON object `{kind, message}` — see the `TransportError` comment
 * in providers.rs for why it is structured rather than a sentence. Parsed
 * defensively: a Tauri-level failure (the command is not registered, the IPC is
 * broken) rejects with something else entirely, and that must still produce a
 * sensible error rather than a crash inside the error handler.
 */
function toJobApiError(provider: JobProviderId, thrown: unknown): JobApiError {
  if (typeof thrown === 'string') {
    try {
      const parsed: unknown = JSON.parse(thrown);
      if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>;
        const kind = record['kind'];
        const message = record['message'];
        if (
          typeof kind === 'string' &&
          RUST_ERROR_KINDS.has(kind as JobApiErrorKind) &&
          typeof message === 'string' &&
          message.length > 0
        ) {
          return jobApiError(provider, kind as JobApiErrorKind, message);
        }
      }
    } catch {
      // Not JSON. An older Rust build, or a Tauri-level rejection that happens
      // to be a string. Fall through rather than showing the user raw JSON.
    }
  }

  return jobApiError(provider, 'network', UNCLASSIFIED_MESSAGE);
}

/** Read the `{status, body}` envelope Rust returns for a completed request. */
function toHttpResponse(
  provider: JobProviderId,
  raw: unknown,
): Result<JobApiHttpResponse, JobApiError> {
  if (typeof raw !== 'string') {
    return err(jobApiError(provider, 'bad-response', UNCLASSIFIED_MESSAGE));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err(jobApiError(provider, 'bad-response', UNCLASSIFIED_MESSAGE));
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return err(jobApiError(provider, 'bad-response', UNCLASSIFIED_MESSAGE));
  }

  const record = parsed as Record<string, unknown>;
  const status = record['status'];
  const body = record['body'];
  if (typeof status !== 'number' || typeof body !== 'string') {
    return err(jobApiError(provider, 'bad-response', UNCLASSIFIED_MESSAGE));
  }

  return ok({ status, body });
}

/**
 * Send one job-board command into Rust and read its envelope back.
 *
 * Shared by the search transport below and by the key-setup screen's "test this
 * key" button (`features/settings/keys/port.ts`), which invokes a DIFFERENT
 * command with the same envelope, the same error format and the same request
 * counter. Two copies of this would be two places for a Rust-side rejection to
 * be classified differently — and the key screen is exactly where a
 * misclassified 401 does the most damage.
 *
 * The command name is a caller-supplied string and that is not a hole: it names
 * a Tauri command, never a URL, and both commands it can name are in this file.
 */
export async function invokeJobCommand(
  provider: JobProviderId,
  command: string,
  args: Record<string, unknown>,
): Promise<Result<JobApiHttpResponse, JobApiError>> {
  // Counted BEFORE the call, and counted whatever the outcome. A 401 or a
  // timeout still consumed the provider's daily allowance, so counting only
  // successes would under-report precisely when the user needs the number.
  //
  // Wrapped because a diagnostic must never be able to fail a real request.
  try {
    recordRequest();
  } catch {
    // Nothing to do and nothing to tell the user. The request continues.
  }

  try {
    return toHttpResponse(provider, await invoke(command, args));
  } catch (thrown) {
    // Never swallowed: every failure becomes a typed error the caller must
    // narrow on before it can reach the value.
    return err(toJobApiError(provider, thrown));
  }
}

export function createTauriJobTransport(): JobSearchTransport {
  return {
    search(
      provider: JobProviderId,
      params: JobSearchParams,
    ): Promise<Result<JobApiHttpResponse, JobApiError>> {
      return invokeJobCommand(provider, SEARCH_COMMAND, { provider, params });
    },
  };
}
