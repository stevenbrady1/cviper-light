/**
 * The error channel for @cviper/job-apis.
 *
 * Nothing here throws across a boundary: every operation that can fail returns
 * a `Result` from `@cviper/core-types`, so a caller that forgets a failure path
 * is a compile error rather than a blank screen where results should be.
 *
 * Branch on `kind`, never on `message`. The wording is expected to improve; the
 * kinds are a contract, and `jobs.rs` has a test asserting that the ones Rust
 * emits are members of this union.
 */
import { type JobProviderId } from './types';

export type JobApiErrorKind =
  /** No API key is saved for this provider. Adzuna needs BOTH of its two. */
  | 'no-key'
  /** The request never completed: DNS, connection, timeout. */
  | 'network'
  /** Two searches too close together. Rust enforces the gap - see `jobs.rs`. */
  | 'throttled'
  /** The local daily request budget is spent. Nothing was sent. */
  | 'quota'
  /** We built something the provider would not accept. */
  | 'bad-request'
  /** 401/403 - the key is wrong, expired, or not activated yet. */
  | 'auth'
  /** 429 - the provider is asking us to slow down. */
  | 'rate-limit'
  /** 5xx - their end. */
  | 'server'
  /** A 2xx whose body was not the shape this package expects. */
  | 'bad-response';

export interface JobApiError {
  readonly provider: JobProviderId;
  readonly kind: JobApiErrorKind;
  /** Safe to show a user verbatim. NEVER contains a key or a raw response. */
  readonly message: string;
  /** Present only when the failure arrived as an HTTP response. */
  readonly status?: number;
}

export function jobApiError(
  provider: JobProviderId,
  kind: JobApiErrorKind,
  message: string,
  status?: number,
): JobApiError {
  // A factory rather than object literals: `exactOptionalPropertyTypes` makes
  // `{ status: undefined }` a type error, and every call site would otherwise
  // repeat the same conditional spread.
  return { provider, kind, message, ...(status === undefined ? {} : { status }) };
}

/** How each provider name reads in a sentence shown to a person. */
export const PROVIDER_LABEL: Readonly<Record<JobProviderId, string>> = {
  adzuna: 'Adzuna',
  reed: 'Reed',
};

/**
 * Turn a completed-but-unsuccessful HTTP response into an error the UI can act
 * on.
 *
 * The provider body is NOT quoted back. Adzuna returns an HTML error page for
 * some failures and Reed returns an empty body for others, so "show them what
 * it said" is a plan that shows the user a stack of markup. Each arm is a fixed
 * sentence naming the one thing they can do about it.
 */
export function httpStatusError(provider: JobProviderId, status: number): JobApiError {
  const label = PROVIDER_LABEL[provider];

  if (status === 401 || status === 403) {
    return jobApiError(
      provider,
      'auth',
      `${label} rejected the saved key. Check it in Settings - a new key can take a few minutes to become active.`,
      status,
    );
  }
  if (status === 429) {
    return jobApiError(
      provider,
      'rate-limit',
      `${label} is asking us to slow down. Wait a minute and search again.`,
      status,
    );
  }
  if (status >= 500) {
    return jobApiError(
      provider,
      'server',
      `${label} is having trouble at their end. Nothing is wrong with your search - try again shortly.`,
      status,
    );
  }
  return jobApiError(
    provider,
    'bad-request',
    `${label} would not accept that search. Try simpler keywords or a broader location.`,
    status,
  );
}
