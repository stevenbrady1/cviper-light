/**
 * The provider contract.
 *
 * Three adapters implement `AiProvider`. They differ in exactly two ways: how
 * they ASK for strict JSON, and how they unwrap the response envelope. Anything
 * else that starts to differ between them belongs in shared code, not in an
 * adapter.
 */
import { type Result } from '@cviper/core-types';

export type ProviderId = 'anthropic' | 'openai' | 'ollama';

/** One model a provider will accept in `ChatJsonRequest.model`. */
export interface ModelInfo {
  /** Exactly the string to send as `model`. For Ollama this is `name:tag`. */
  readonly id: string;
  /** What to show a human. Falls back to `id` when the API offers no name. */
  readonly label: string;
}

/**
 * Why a provider call failed, in the shape the UI needs to decide what to say.
 *
 * These are deliberately coarse. The user can act on "no key saved" and
 * "Ollama is not running"; they cannot act on an HTTP status code.
 */
export type ProviderErrorKind =
  /** No API key is saved for a provider that needs one. */
  | 'no-key'
  /** The local daemon is not reachable. A NORMAL condition, not a crash. */
  | 'not-running'
  /** 401/403 — the key is wrong, expired, or lacks access. */
  | 'auth'
  /** 429 — slow down. */
  | 'rate-limit'
  /** 400/404/422 — we sent something the provider would not accept. */
  | 'bad-request'
  /** 5xx — their end. */
  | 'server'
  /** The request never completed: DNS, connection, timeout. */
  | 'network'
  /** A 2xx whose body was not the shape the adapter expects. */
  | 'bad-response'
  /** The model hit its output cap mid-answer. */
  | 'truncated';

export interface ProviderError {
  readonly provider: ProviderId;
  readonly kind: ProviderErrorKind;
  /** Safe to show a user verbatim. NEVER contains a key or a raw header. */
  readonly message: string;
  /** Present only when the failure arrived as an HTTP response. */
  readonly status?: number;
}

export function providerError(
  provider: ProviderId,
  kind: ProviderErrorKind,
  message: string,
  status?: number,
): ProviderError {
  // Built through a factory rather than inline object literals because
  // `exactOptionalPropertyTypes` makes `{ status: undefined }` a type error,
  // and every adapter would otherwise repeat this conditional spread.
  return { provider, kind, message, ...(status === undefined ? {} : { status }) };
}

export interface ChatJsonRequest {
  readonly model: string;
  readonly system: string;
  readonly user: string;
  /** JSON Schema. In practice always `CV_ANALYSIS_JSON_SCHEMA`. */
  readonly schema: object;
  /**
   * ==========================================================================
   * A LITERAL `0`, NOT `number`. THIS IS LOAD-BEARING.
   * ==========================================================================
   * Every call in this package scores a CV, and scoring is not a creative
   * task: the same CV against the same advert must not swing thirty points
   * because someone thought a bit of variety would be nice. Typing this as the
   * literal turns "turn the creativity up" into a COMPILE ERROR rather than a
   * code review someone has to remember to do.
   *
   * `_TemperatureIsLiteralZero` below fails the build if this ever widens.
   */
  readonly temperature: 0;
  readonly maxOutputTokens: number;
}

/** Errors if its argument is not exactly `true`. */
type AssertTrue<T extends true> = T;

/**
 * Fails to compile if `ChatJsonRequest['temperature']` widens to `number`.
 *
 * The tuple wrapper stops the conditional distributing over a union, so a
 * widening to `0 | 1` is caught too.
 */
export type _TemperatureIsLiteralZero = AssertTrue<
  [number] extends [ChatJsonRequest['temperature']] ? false : true
>;

/**
 * One HTTP exchange that actually completed. A non-2xx `status` is still a
 * response — the adapter reads the body to classify it, because every provider
 * puts its real explanation in the error envelope rather than the status line.
 */
export interface ProviderHttpResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * How a provider reaches the network. INJECTED, ALWAYS.
 *
 * ============================================================================
 * THIS INTERFACE IS WHY THIS PACKAGE HAS NO NETWORK IN ITS TESTS.
 * ============================================================================
 * In the app the implementation is a thin wrapper over `invoke()` into Rust, so
 * the base URL and the API key live on the Rust side and never enter
 * JavaScript. In tests it is a hand-written fake returning recorded response
 * bodies. The adapters cannot tell the difference, which means every envelope
 * and every error path is exercised without a socket.
 *
 * `Err` here means the request never completed. A 401 is `Ok` with
 * `status: 401` — the adapter decides what that means.
 */
export interface ChatTransport {
  chat(provider: ProviderId, body: string): Promise<Result<ProviderHttpResponse, ProviderError>>;
  listModels(provider: ProviderId): Promise<Result<ProviderHttpResponse, ProviderError>>;
}

export interface AiProvider {
  readonly id: ProviderId;
  listModels(): Promise<Result<ModelInfo[], ProviderError>>;
  /** Returns the RAW assistant content. Parsing is the orchestrator's job. */
  chatJson(request: ChatJsonRequest): Promise<Result<string, ProviderError>>;
}
