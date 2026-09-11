/**
 * The parts every adapter would otherwise copy.
 *
 * Adapters are allowed to differ in exactly two ways — how they ASK for strict
 * JSON, and how they unwrap the response envelope. Status classification, JSON
 * decoding and message trimming are the same everywhere, so they live here.
 */
import { err, ok, type Result } from '@cviper/core-types';

import {
  providerError,
  type ProviderError,
  type ProviderErrorKind,
  type ProviderId,
} from '../types';

/** How much provider error text is passed on to the user. */
const MAX_PROVIDER_MESSAGE_CHARS = 300;

/**
 * HTTP status to error kind.
 *
 * Coarse on purpose: the user can act on "your key is wrong" and "their end is
 * down". They cannot act on 422 versus 400.
 */
export function classifyStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  return 'bad-request';
}

/**
 * The provider's own prose, or `null` when it must not be repeated.
 *
 * ============================================================================
 * AN AUTH FAILURE IS NEVER QUOTED BACK.
 * ============================================================================
 * OpenAI's 401 body quotes the key it rejected, masked:
 *
 *     {"error":{"message":"Incorrect API key provided: sk-proj-****abcd", …}}
 *
 * `httpError` used to pass that straight through, and the analysis screen
 * renders a failure verbatim (`runAnalysis.ts` → `Analysis.tsx`). So a fragment
 * of the user's own credential ended up on screen — and in every screenshot of
 * it, which is exactly what people attach to a support message.
 *
 * Dropping the detail costs nothing here, because `httpError`'s auth fallback
 * already says the one thing the user can act on: the key was rejected, and
 * Settings is where it is fixed. Every other status keeps its prose, where the
 * provider's explanation is genuinely the most useful thing available.
 *
 * A rule about a SHAPE of response rather than about one provider's wording:
 * OpenAI is the one known to echo the key today, and a second provider deciding
 * to do it tomorrow is the sort of change nobody here would hear about.
 */
export function detailUnlessAuth(status: number, detail: string | null): string | null {
  return classifyStatus(status) === 'auth' ? null : detail;
}

/** Trim provider prose to something that fits in a toast. */
export function trimMessage(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_PROVIDER_MESSAGE_CHARS
    ? flat
    : `${flat.slice(0, MAX_PROVIDER_MESSAGE_CHARS)}…`;
}

/**
 * Decode a response body that should be JSON.
 *
 * A 2xx whose body is not JSON is `bad-response`, never a silent empty result:
 * in practice it means a corporate proxy returned an HTML login page, and
 * "the model gave no answer" would send the user hunting the wrong problem.
 */
export function decodeJsonBody(
  provider: ProviderId,
  raw: string,
): Result<Record<string, unknown>, ProviderError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err(
      providerError(
        provider,
        'bad-response',
        'The provider replied with something that was not JSON. If you are on a ' +
          'corporate network, a proxy may be intercepting the request.',
      ),
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err(
      providerError(provider, 'bad-response', 'The provider replied in an unexpected format.'),
    );
  }

  return ok(parsed as Record<string, unknown>);
}

/** Read a string property, or null when it is absent or the wrong type. */
export function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

/** Read an object property, or null. */
export function readObject(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = source[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read an array property, or null. */
export function readArray(source: Record<string, unknown>, key: string): unknown[] | null {
  const value = source[key];
  return Array.isArray(value) ? value : null;
}

/**
 * The message shown when a model stops mid-answer at its output cap.
 *
 * Shared so all three providers give the same advice for the same symptom, and
 * so it matches what `extract-json.ts` says when it detects the same thing from
 * the text alone.
 */
export const TRUNCATED_MESSAGE =
  'The model ran out of room and its answer was cut off part-way through. ' +
  'Try again with a shorter CV or job description, or raise the output limit ' +
  'for this model.';

/** Build the error for a non-2xx response whose envelope has been read. */
export function httpError(
  provider: ProviderId,
  status: number,
  detail: string | null,
): ProviderError {
  const kind = classifyStatus(status);
  const fallback =
    kind === 'auth'
      ? 'The provider rejected the saved API key. Check it in Settings.'
      : kind === 'rate-limit'
        ? 'The provider is rate-limiting this key. Wait a moment and try again.'
        : kind === 'server'
          ? 'The provider had a problem at their end. Try again shortly.'
          : 'The provider rejected the request.';

  return providerError(
    provider,
    kind,
    detail === null || detail.trim().length === 0 ? fallback : trimMessage(detail),
    status,
  );
}
