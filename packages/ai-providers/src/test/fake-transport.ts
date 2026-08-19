/**
 * The fake transport every adapter test runs against.
 *
 * ============================================================================
 * NO TEST IN THIS PACKAGE OPENS A SOCKET (except the opt-in Ollama
 * integration spec, which says so in its name and is gated on an env var).
 * ============================================================================
 * Adapters take a `ChatTransport`, so the recorded response bodies below stand
 * in for a real provider. That is what makes every error envelope — a 429 from
 * OpenAI, a 404 from Ollama for a model that was never pulled — testable
 * without an API key, a network, or a running daemon.
 */
import { err, ok, type Result } from '@cviper/core-types';

import type { ChatTransport, ProviderError, ProviderHttpResponse, ProviderId } from '../types';

/** One canned outcome: an HTTP response that arrived, or a failure to send. */
export type FakeOutcome = { status: number; body: string } | { fail: ProviderError };

export interface FakeTransport extends ChatTransport {
  /** Raw request bodies passed to `chat`, oldest first. */
  readonly chatBodies: string[];
  readonly chatCalls: ProviderId[];
  readonly listModelsCalls: ProviderId[];
}

function toResult(outcome: FakeOutcome): Result<ProviderHttpResponse, ProviderError> {
  return 'fail' in outcome ? err(outcome.fail) : ok({ status: outcome.status, body: outcome.body });
}

export function fakeTransport(options: {
  /** A single outcome, or a queue consumed one call at a time. */
  chat?: FakeOutcome | FakeOutcome[];
  models?: FakeOutcome;
}): FakeTransport {
  const chatBodies: string[] = [];
  const chatCalls: ProviderId[] = [];
  const listModelsCalls: ProviderId[] = [];

  const queue = Array.isArray(options.chat) ? [...options.chat] : undefined;

  return {
    chatBodies,
    chatCalls,
    listModelsCalls,

    chat(provider, body) {
      chatCalls.push(provider);
      chatBodies.push(body);

      const outcome = queue
        ? // Past the end of the queue the LAST outcome repeats, so a test that
          // only cares about the first call does not have to pad the array.
          (queue.shift() ?? { status: 500, body: '{"error":"fake transport queue exhausted"}' })
        : options.chat;

      if (outcome === undefined || Array.isArray(outcome)) {
        throw new Error('fakeTransport: chat() called but no chat outcome was configured');
      }
      return Promise.resolve(toResult(outcome));
    },

    listModels(provider) {
      listModelsCalls.push(provider);
      if (options.models === undefined) {
        throw new Error('fakeTransport: listModels() called but no models outcome was configured');
      }
      return Promise.resolve(toResult(options.models));
    },
  };
}

/** Parse a recorded request body so tests can assert on what was sent. */
export function sentBody(transport: FakeTransport, index = 0): Record<string, unknown> {
  const raw = transport.chatBodies[index];
  if (raw === undefined) throw new Error(`no chat call at index ${index}`);
  return JSON.parse(raw) as Record<string, unknown>;
}
