/**
 * The production `ChatTransport`: a thin wrapper over `invoke()` into Rust.
 *
 * ============================================================================
 * THIS FILE IS THE ONLY THING THAT KNOWS A PROVIDER CALL LEAVES THE PROCESS.
 * ============================================================================
 * `@cviper/ai-providers` builds request bodies and reads response bodies and
 * has no idea how they travel. This module supplies the how, and the how is
 * deliberately incapable of choosing a destination: it passes a provider name
 * from a three-value union and a body, and Rust decides the URL, the method and
 * the `Authorization` header.
 *
 * That is why there is no base URL in this file and no API key anywhere in
 * JavaScript. See `src-tauri/src/providers.rs`.
 */
import { invoke } from '@tauri-apps/api/core';

import {
  providerError,
  type ChatTransport,
  type ProviderError,
  type ProviderErrorKind,
  type ProviderHttpResponse,
  type ProviderId,
} from '@cviper/ai-providers';
import { err, ok, type Result } from '@cviper/core-types';

/** The command names registered in `generate_handler!`. */
const CHAT_COMMAND = 'provider_chat';
const LIST_MODELS_COMMAND = 'provider_list_models';
const PROBE_COMMAND = 'ollama_probe';

/**
 * Error kinds Rust is allowed to name.
 *
 * A closed list rather than a cast: an unrecognised kind from a future Rust
 * change must degrade to something the UI can still render, not become a
 * `ProviderErrorKind` that no switch statement handles.
 */
const RUST_ERROR_KINDS = new Set<ProviderErrorKind>([
  'no-key',
  'not-running',
  'network',
  'bad-request',
  'bad-response',
]);

/** Shown when Rust fails in a way we cannot classify at all. */
const UNCLASSIFIED_MESSAGE = 'The request could not be sent. Try again.';

/**
 * Turn whatever `invoke` rejected with into a `ProviderError`.
 *
 * Rust sends a JSON object `{kind, message}` — see the `TransportError` comment
 * in providers.rs for why it is structured rather than a sentence. This parses
 * it defensively: a Tauri-level failure (the command is not registered, the IPC
 * is broken) rejects with something else entirely, and that must still produce
 * a sensible error rather than a crash inside the error handler.
 */
function toProviderError(provider: ProviderId, thrown: unknown): ProviderError {
  if (typeof thrown === 'string') {
    try {
      const parsed: unknown = JSON.parse(thrown);
      if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>;
        const kind = record['kind'];
        const message = record['message'];
        if (
          typeof kind === 'string' &&
          RUST_ERROR_KINDS.has(kind as ProviderErrorKind) &&
          typeof message === 'string' &&
          message.length > 0
        ) {
          return providerError(provider, kind as ProviderErrorKind, message);
        }
      }
    } catch {
      // Not JSON. An older Rust build, or a Tauri-level rejection that happens
      // to be a string. Fall through rather than showing the user raw JSON.
    }
  }

  return providerError(provider, 'network', UNCLASSIFIED_MESSAGE);
}

/** Read the `{status, body}` envelope Rust returns for a completed request. */
function toHttpResponse(
  provider: ProviderId,
  raw: unknown,
): Result<ProviderHttpResponse, ProviderError> {
  if (typeof raw !== 'string') {
    return err(providerError(provider, 'bad-response', UNCLASSIFIED_MESSAGE));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err(providerError(provider, 'bad-response', UNCLASSIFIED_MESSAGE));
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return err(providerError(provider, 'bad-response', UNCLASSIFIED_MESSAGE));
  }

  const record = parsed as Record<string, unknown>;
  const status = record['status'];
  const body = record['body'];
  if (typeof status !== 'number' || typeof body !== 'string') {
    return err(providerError(provider, 'bad-response', UNCLASSIFIED_MESSAGE));
  }

  return ok({ status, body });
}

async function call(
  provider: ProviderId,
  command: string,
  args: Record<string, unknown>,
): Promise<Result<ProviderHttpResponse, ProviderError>> {
  try {
    return toHttpResponse(provider, await invoke(command, args));
  } catch (thrown) {
    // Never swallowed: every failure becomes a typed error the caller must
    // narrow on before it can reach the value.
    return err(toProviderError(provider, thrown));
  }
}

export function createTauriTransport(): ChatTransport {
  return {
    chat(provider, body) {
      return call(provider, CHAT_COMMAND, { provider, body });
    },
    listModels(provider) {
      return call(provider, LIST_MODELS_COMMAND, { provider });
    },
  };
}

/**
 * Is Ollama running? Returns the raw `/api/tags` body, or `null`.
 *
 * `null` is NOT an error. Most people will never install Ollama, and the ones
 * who do will not have it running all the time — see the `ollama_probe` comment
 * in providers.rs. Anything that throws here (a missing command, a broken IPC)
 * is also `null`, because a failed probe and an absent daemon lead to exactly
 * the same UI: offer the cloud providers instead.
 */
export async function probeOllama(): Promise<string | null> {
  try {
    const raw = await invoke(PROBE_COMMAND);
    return typeof raw === 'string' ? raw : null;
  } catch {
    return null;
  }
}
