/**
 * The error channel for the keyless feeds.
 *
 * ============================================================================
 * A FEED THAT HAS ROTTED MUST NOT LOOK LIKE A QUIET MARKET
 * ============================================================================
 * This is the reason the whole feature is shaped the way it is. Free feeds are
 * moved, renamed, rate-limited and quietly switched off, and the failure that
 * matters is not the 404 — it is what the 404 LOOKS LIKE. A source that returns
 * nothing, parses to nothing, or answers with a login page all end at the same
 * place if nobody distinguishes them: an empty results list, which a user reads
 * as "there are no jobs like that", and which they have no way to question.
 *
 * So a failure here is always a value with a `source` on it, and the screen
 * renders one line per source. Two sentences that must never be confused:
 *
 *   * "Arbeitnow could not be read" — the feed failed. Our problem.
 *   * "Nothing matched the words you typed" — the feed worked. Their choice.
 *
 * `empty-feed` is the third one, and it is the one that would otherwise be
 * silent: the request completed, the body parsed, and there were no adverts in
 * it. That is not a market with no jobs; a feed of "the most recent adverts"
 * that is empty is a feed that has stopped working.
 *
 * Branch on `kind`, never on `message`.
 */
import { KEYLESS_SOURCE_LABEL, type KeylessSourceId } from './types';

export type KeylessErrorKind =
  /** The request never completed: DNS, connection, timeout. */
  | 'network'
  /** Two browses too close together. Rust enforces the gap - see `keyless.rs`. */
  | 'throttled'
  /** 429 — the feed is asking us to slow down. */
  | 'rate-limit'
  /** 5xx, or a 4xx that means the address has moved or gone. */
  | 'server'
  /** A reply we could not read: not JSON, not RSS, or a shape that changed. */
  | 'bad-response'
  /** It answered, it parsed, and it held no adverts at all. */
  | 'empty-feed';

export interface KeylessError {
  readonly source: KeylessSourceId;
  readonly kind: KeylessErrorKind;
  /** Safe to show a user verbatim. Always names the source. */
  readonly message: string;
  /** Present only when the failure arrived as an HTTP response. */
  readonly status?: number;
}

export function keylessError(
  source: KeylessSourceId,
  kind: KeylessErrorKind,
  message: string,
  status?: number,
): KeylessError {
  // A factory rather than object literals, for the same reason `jobApiError`
  // is one: `exactOptionalPropertyTypes` makes `{ status: undefined }` a type
  // error and every call site would repeat the same conditional spread.
  return { source, kind, message, ...(status === undefined ? {} : { status }) };
}

/**
 * A completed-but-unsuccessful HTTP reply from a feed.
 *
 * Every arm names the source and says the one true thing: this is not about
 * what the user typed. Nobody can fix a dead feed by rewording their filter,
 * and a message that implies otherwise sends them round a loop.
 */
export function keylessHttpStatusError(source: KeylessSourceId, status: number): KeylessError {
  const label = KEYLESS_SOURCE_LABEL[source];

  if (status === 429) {
    return keylessError(
      source,
      'rate-limit',
      `${label} is asking us to slow down. Wait a minute and try again — this is not about what you typed.`,
      status,
    );
  }
  if (status >= 500) {
    return keylessError(
      source,
      'server',
      `${label} is having trouble at their end, so none of its jobs are below. Try again shortly.`,
      status,
    );
  }
  if (status === 404 || status === 410) {
    // The one a free feed really does do, and the one that must never be
    // mistaken for "no jobs matched". It is a broken app, not a quiet market.
    return keylessError(
      source,
      'server',
      `${label} no longer publishes its list of recent jobs at the address this app knows, so none of its jobs are below. This needs fixing in CViper — it is not something you can search your way past.`,
      status,
    );
  }
  return keylessError(
    source,
    'bad-response',
    `${label} refused to give CViper its list of recent jobs (error ${status}), so none of its jobs are below.`,
    status,
  );
}

/** A reply that arrived and could not be read. */
export function keylessUnreadable(source: KeylessSourceId): KeylessError {
  const label = KEYLESS_SOURCE_LABEL[source];
  return keylessError(
    source,
    'bad-response',
    `${label} sent something CViper could not read, so none of its jobs are below. The feed has probably changed — this is not about what you typed.`,
  );
}

/** A reply that was read perfectly and contained no adverts. */
export function keylessEmptyFeed(source: KeylessSourceId): KeylessError {
  const label = KEYLESS_SOURCE_LABEL[source];
  return keylessError(
    source,
    'empty-feed',
    `${label} answered with no jobs at all. A list of the most recent jobs is never empty, so the feed has probably stopped working — this is not about what you typed.`,
  );
}

/** A request that never completed. */
export function keylessUnreachable(source: KeylessSourceId): KeylessError {
  const label = KEYLESS_SOURCE_LABEL[source];
  return keylessError(
    source,
    'network',
    `CViper could not reach ${label}, so none of its jobs are below. Check your internet connection and try again.`,
  );
}
