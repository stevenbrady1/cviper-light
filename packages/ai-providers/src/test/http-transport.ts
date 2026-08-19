/**
 * A REAL HTTP transport — for the integration spec ONLY.
 *
 * ============================================================================
 * THIS IS NOT EXPORTED FROM THE PACKAGE, AND MUST NOT BE.
 * ============================================================================
 * In the app, `ChatTransport` is implemented by `invoke()`ing into Rust, which
 * is what keeps base URLs and API keys out of JavaScript. This file bypasses
 * all of that and talks to a loopback address directly, which is only
 * acceptable because:
 *
 *   - it is reached exclusively by `ollama.integration.test.ts`, which is
 *     itself gated behind an environment variable, and
 *   - it handles the ONE provider that has no API key to leak.
 *
 * It deliberately has no branch for Anthropic or OpenAI. Adding one would put a
 * key-bearing code path in JavaScript, which is the thing the Rust transport
 * exists to prevent. If you need to integration-test a cloud provider, do it
 * through the Rust command, not here.
 */
import { err, ok, type Result } from '@cviper/core-types';

import {
  providerError,
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
  type ProviderId,
} from '../types';

/** Ollama's loopback address. Never configurable from a test. */
export const OLLAMA_TEST_BASE_URL = 'http://127.0.0.1:11434';

/** Matches the Rust chat timeout: a cold model load can take 30 seconds. */
const CHAT_TIMEOUT_MS = 180_000;

/** Matches the Rust probe timeout. */
export const PROBE_TIMEOUT_MS = 500;

function reject(kind: 'not-running' | 'network', message: string): ProviderError {
  return providerError('ollama', kind, message);
}

async function request(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Result<ProviderHttpResponse, ProviderError>> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${OLLAMA_TEST_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
    });
    return ok({ status: response.status, body: await response.text() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown transport failure';
    return err(reject('not-running', `Could not reach Ollama on 127.0.0.1:11434 (${message}).`));
  } finally {
    clearTimeout(timer);
  }
}

export function httpOllamaTransport(): ChatTransport {
  function assertOllama(provider: ProviderId): void {
    if (provider !== 'ollama') {
      throw new Error(
        `httpOllamaTransport refuses provider "${provider}" — see the header comment.`,
      );
    }
  }

  return {
    chat(provider, body) {
      assertOllama(provider);
      return request(
        '/api/chat',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body },
        CHAT_TIMEOUT_MS,
      );
    },
    listModels(provider) {
      assertOllama(provider);
      return request('/api/tags', { method: 'GET' }, CHAT_TIMEOUT_MS);
    },
  };
}

/**
 * Is a daemon there? Mirrors the Rust `ollama_probe`: a short timeout, and ANY
 * failure means "not running" rather than an error.
 */
export async function probeOllama(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${OLLAMA_TEST_BASE_URL}/api/tags`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
