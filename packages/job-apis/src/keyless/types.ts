/**
 * The keyless-feed contract (L-110).
 *
 * ============================================================================
 * THIS IS BROWSING, NOT SEARCHING. THE DIFFERENCE IS THE WHOLE DESIGN.
 * ============================================================================
 * The feed accepts no query. Arbeitnow publishes its most recent 250 adverts
 * per page and ignores any parameter asking for something narrower — measured,
 * not assumed. So there is no keyword or location ANYWHERE in this contract:
 * the app reads what the feed published and narrows it on this machine
 * afterwards (`filter.ts`).
 *
 * Guardian Jobs was a second feed until it closed on 2 Sep 2026; its address
 * now redirects to an article about the closure, so it was removed (L-336).
 *
 * Calling it a search would be a lie in the one place a user cannot check.
 *
 * ============================================================================
 * NO CREDENTIAL EXISTS ON THIS PATH
 * ============================================================================
 * The feed takes none. There is no key to omit, no header to forget, and
 * nothing in the credential store for this path to read — `keyless.rs` carries
 * a test proving it cannot so much as name the credential module, which is the
 * same structural guard `fetch_page.rs` has.
 *
 * That also means the daily quota does not apply here. `quota.ts` counts Reed's
 * hundred-a-day allowance; a feed with no account has no allowance to spend,
 * and counting these requests against Reed's would take real searches away from
 * the user for nothing.
 */
import { type Result } from '@cviper/core-types';

import { type KeylessError } from './errors';
import { type JobApiHttpResponse } from '../types';

/**
 * The keyless feeds. A CLOSED SET, for the same reason `JobProviderId` is.
 *
 * One member now. `'guardian'` stays a `JobSource` (saved jobs and backups
 * still hold it) but is no longer a feed anything reads.
 */
export type KeylessSourceId = 'arbeitnow';

/** Every keyless feed, in the order the UI lists them. */
export const KEYLESS_SOURCE_IDS: readonly KeylessSourceId[] = ['arbeitnow'];

/** How each feed is named in a sentence shown to a person. */
export const KEYLESS_SOURCE_LABEL: Readonly<Record<KeylessSourceId, string>> = {
  arbeitnow: 'Arbeitnow',
};

/**
 * How many pages of each feed ONE browse asks for.
 *
 * ============================================================================
 * A FIXED COST, NEVER A FUNCTION OF WHAT THE USER TYPED
 * ============================================================================
 * Two requests per browse: two pages of Arbeitnow (500 adverts). That is the
 * entire cost, it is the same for every browse, and nothing in the form can
 * raise it.
 *
 * Two pages rather than one because of what page 1 actually contains: in a live
 * sample of 250 adverts, 59 were plausibly UK and 42 of those were London.
 * Arbeitnow is a Germany-first board that has recently added the UK, so one page
 * leaves a UK reader with a derisory list. Two pages roughly doubles it while
 * keeping the cost a number somebody can hold in their head.
 *
 * Arbeitnow's own terms say "please do not abuse", so the ceiling is deliberate
 * and low, and there is no automatic refresh anywhere in this feature.
 */
export const KEYLESS_PAGES: Readonly<Record<KeylessSourceId, number>> = {
  arbeitnow: 2,
};

/**
 * How a keyless feed reaches the network. INJECTED, ALWAYS.
 *
 * Same shape and the same reasoning as `JobSearchTransport`: this package
 * cannot open a socket and does not know a URL. In the app the transport is a
 * thin wrapper over `invoke()` into Rust, which owns both addresses; in tests
 * it is a hand-written fake returning recorded bodies.
 *
 * `page` is a number this package decides from `KEYLESS_PAGES` — never
 * something a caller passed in — and Rust clamps it again on arrival.
 */
export interface KeylessFetchTransport {
  fetch(source: KeylessSourceId, page: number): Promise<Result<JobApiHttpResponse, KeylessError>>;
}
