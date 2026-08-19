/**
 * Keyless job-board links - the search that works before anything is set up.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY NOT HERE: THE LINKEDIN SCRAPER.
 * ============================================================================
 * The CViper web application has a `LinkedInAPI` class that calls LinkedIn's
 * unauthenticated guest endpoint and parses the returned HTML with
 * BeautifulSoup (`backend/job_sites_api.py`, line 336, whose own docstring says
 * "may break at any time"). Only the URL construction is ported. The scraper is
 * not, and this is a design decision rather than a shortcut:
 *
 *   * It would point LinkedIn's rate limiting and bot detection at the USER's
 *     home IP address, from software they installed. A server-side scraper
 *     costs the operator an IP block; a desktop one costs the user their
 *     LinkedIn account.
 *   * HTML parsing against an endpoint nobody promised us breaks on LinkedIn's
 *     schedule, and a desktop binary cannot be patched the same afternoon.
 *     Between the break and the update the feature is simply broken for
 *     everyone who installed it.
 *   * It needs an HTML parser in the bundle to read a page we are not entitled
 *     to read.
 *
 * A link that opens the user's own browser, where they are already signed in,
 * is not a lesser substitute for that. It is the correct design: it always
 * works, it needs no key, it breaks nothing when the site changes, and the
 * request comes from the user's browser because the user clicked something.
 *
 * ============================================================================
 * THE HOST AND PATH ARE FIXED STRINGS.
 * ============================================================================
 * Same principle as `providers.rs`: nothing the user types can reach anything
 * but a query VALUE. `URLSearchParams` does the encoding, so an `&` in a job
 * title cannot start a new parameter and a pasted URL cannot become the
 * destination.
 */

/** The same two fields the real search uses, so one form drives both. */
export interface BrowserSearchInput {
  readonly keywords: string;
  readonly location: string;
}

/**
 * Collapse whitespace and control characters.
 *
 * Deliberately duplicated from `params.ts` rather than imported: that copy
 * guards what goes on the wire to a paid API, this one guards what goes in a
 * link. They agree today and are allowed to diverge without one silently
 * changing the other.
 */
function tidy(raw: string): string {
  let cleaned = '';
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    cleaned += code < 0x20 || code === 0x7f ? ' ' : character;
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * A LinkedIn job search, ready to open in the user's browser.
 *
 * Both parameters are always emitted, even when empty, because that is the
 * shape LinkedIn's own search produces and an empty one is a valid search.
 */
export function buildLinkedInSearchUrl(input: BrowserSearchInput): string {
  const query = new URLSearchParams({
    keywords: tidy(input.keywords),
    location: tidy(input.location),
  });
  return `https://www.linkedin.com/jobs/search/?${query.toString()}`;
}

/** An Indeed UK job search, ready to open in the user's browser. */
export function buildIndeedSearchUrl(input: BrowserSearchInput): string {
  const query = new URLSearchParams({
    q: tidy(input.keywords),
    l: tidy(input.location),
  });
  return `https://uk.indeed.com/jobs?${query.toString()}`;
}
