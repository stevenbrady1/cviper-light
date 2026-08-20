/**
 * Running one fetch — the tracker's single door to a web page.
 *
 * Deliberately shaped like `runExtraction.ts`, for the same two reasons: the
 * transport factory is INJECTED so a test can prove a path never built one, and
 * everything the user is told is decided in one place rather than assembled
 * from whatever the layer below happened to know.
 *
 * ============================================================================
 * NOTHING HERE CAN FAIL IN A WAY THE CALLER HAS TO HANDLE
 * ============================================================================
 * Every path returns a `PageFetchOutcome`, never a `Result`, so a component
 * calling this cannot forget the failure case — there is no failure case, there
 * is an outcome whose `available` is false and whose `reason` is a sentence the
 * user can act on. Same contract as `extractJob`, and for the same reason: a
 * fetch that did not work is not a dead end, it is the paste box the user
 * already had.
 *
 * ============================================================================
 * ONE MESSAGE. SIX FAILURES, SIX MORE LATER, ONE MESSAGE.
 * ============================================================================
 * A blocklisted domain, an unreachable host, a timeout, a redirect that left
 * the site, a PDF where a page should have been, a login wall, a 404, an
 * address that would not parse — every one of these ends in
 * `FETCH_FALLBACK_NOTE`. That is not laziness about error handling; it is the
 * observation that all eight mean exactly one thing to a person recording a
 * job, and that the thing to do about all eight is identical: open the page in
 * your browser and copy the text.
 *
 * A status code or a kind string on screen would be eight dead ends instead of
 * one route forward, and none of the eight is anything the user did wrong.
 */
import { htmlToText, isPlausiblyReadable } from './htmlToText';
import { isBlockedUrl } from './fetchBlocklist';
import { createTauriPageTransport, type PageFetchTransport } from './pageFetch';

/**
 * The one thing a failed fetch says.
 *
 * Names the route forward first and the problem second, because the route
 * forward is the useful half. It never says why — see the header — and it never
 * implies the user typed something wrong, because eight times out of ten they
 * did not: the site simply does not serve its adverts to anything that is not a
 * signed-in browser.
 *
 * "The link stays in the box" is a promise the form keeps: the address is
 * carried into the review form's own link field whichever way the user leaves
 * this screen, so nothing they typed is lost.
 */
export const FETCH_FALLBACK_NOTE =
  'That page could not be read from here. Open it in your browser, copy the advert text, ' +
  'and paste it in the box below — the link stays in the box above and is saved with the job.';

/** The schemes a fetch is ever attempted for. Rust enforces this too. */
const FETCHABLE_SCHEMES = new Set(['http:', 'https:']);

export interface PageFetchOutcome {
  /** False means no usable text. `text` is then empty, never partial. */
  readonly available: boolean;
  /** The advert as readable text. `''` when unavailable. */
  readonly text: string;
  /** Safe to show verbatim. Non-null exactly when `available` is false. */
  readonly reason: string | null;
}

/** The fail-open shape, built here so every refusal below cannot drift. */
const UNAVAILABLE: PageFetchOutcome = {
  available: false,
  text: '',
  reason: FETCH_FALLBACK_NOTE,
};

/**
 * Is this an address we will attempt at all?
 *
 * Checked here as well as in Rust, and that is not duplication for its own
 * sake: it is what lets the "no request was made" promise be a promise. A
 * `file:` URL that reached the transport would be refused by Rust in a
 * microsecond, but the transport would have been built, `invoke` would have
 * been called, and the test that proves this path is inert would have nothing
 * to assert. Rust remains the authority; this is the fast, checkable half.
 */
function isFetchable(raw: string): boolean {
  try {
    return FETCHABLE_SCHEMES.has(new URL(raw).protocol);
  } catch {
    return false;
  }
}

/**
 * Fetch one page and turn it into advert text.
 *
 * The order of the three refusals before the network matters and is the whole
 * security-adjacent behaviour of this function: an empty box, an address we
 * will not open, and a blocklisted domain are all answered BEFORE
 * `createTransport()` is called, so none of them can reach a socket even by
 * accident. `runFetch.test.ts` passes a factory that throws and fails if it is
 * ever invoked.
 */
export async function runFetch(
  url: string,
  createTransport: () => PageFetchTransport = createTauriPageTransport,
): Promise<PageFetchOutcome> {
  const address = url.trim();

  // 1. Nothing typed.
  if (address === '') return UNAVAILABLE;

  // 2. Not an address this app opens.
  if (!isFetchable(address)) return UNAVAILABLE;

  // 3. A site we already know answers a fetcher with a wall. No request is
  //    attempted — see `fetchBlocklist.ts` for why this is about the user's
  //    fifteen seconds and not about security.
  if (isBlockedUrl(address)) return UNAVAILABLE;

  const result = await createTransport().fetchPage(address);
  if (!result.ok) return UNAVAILABLE;

  // A 404 or a 503 completed perfectly and is still not an advert. The
  // transport is right to call it a success; this is the layer that decides
  // what it was worth.
  const { status, body } = result.value;
  if (status < 200 || status > 299) return UNAVAILABLE;

  const text = htmlToText(body);

  // A login wall and a JavaScript-only shell both arrive with a 200 and look
  // like successes to anything watching the network. They are failures.
  if (!isPlausiblyReadable(text)) return UNAVAILABLE;

  return { available: true, text, reason: null };
}
