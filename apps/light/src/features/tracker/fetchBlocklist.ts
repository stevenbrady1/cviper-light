/**
 * Sites where fetching the page is known to be a waste of the user's time.
 *
 * ============================================================================
 * THIS IS NOT A SECURITY CONTROL. SAY IT OUT LOUD SO NOBODY LEANS ON IT.
 * ============================================================================
 * Everything that stops this app reaching somewhere it should not — schemes,
 * private addresses, `localhost`, redirects, credentials, size, time — is in
 * `src-tauri/src/fetch_page.rs`, is enforced in Rust before every connection,
 * and does not read this file. A frontend that skipped this module entirely
 * would get exactly the same refusals.
 *
 * What this list is for is SPEED AND HONESTY. The big aggregators answer
 * anything that is not a signed-in browser with a login wall or a bot check.
 * Fetching one of them takes fifteen seconds and ends in the same guided
 * message the user could have had immediately, so a blocked domain skips the
 * network ENTIRELY — no request is attempted — and gets that message straight
 * away. `runFetch` never even builds a transport for one.
 *
 * ============================================================================
 * A MALFORMED SHIPPED FILE DEGRADES; IT DOES NOT WHITE-SCREEN
 * ============================================================================
 * The same arrangement as `features/boards/defaults.ts`, and safe for the same
 * reason plus one more: a `throw` at module scope would take the whole app down
 * at import time, and here the worst an empty list can do is let a fetch of
 * LinkedIn go out and come back with the wall it was going to come back with
 * anyway. It cannot open a hole, because it was never what was holding one
 * shut. `fetchBlocklist.test.ts` asserts `SHIPPED_BLOCKLIST_PROBLEM` is `null`,
 * so a bad file fails the build rather than a user's afternoon.
 */
import rawBlocklist from '../../config/fetch-blocklist.json';

export interface BlockedSite {
  /** The registrable domain. Every subdomain of it is covered. */
  readonly domain: string;
  /** Why it is here — so nobody has to guess before taking one out. */
  readonly why: string;
}

/**
 * Read the shipped file without trusting it.
 *
 * Hand-rolled rather than a schema library: this is one shape with two string
 * fields, and the app has no `zod` of its own. The rules are the ones the
 * matcher depends on — a domain must be a non-empty lower-case string with no
 * scheme, slash or whitespace in it, because "linkedin.com/jobs" in this file
 * would match nothing and look like it worked.
 */
function parseBlocklist(raw: unknown): { sites: BlockedSite[]; problem: string | null } {
  if (!Array.isArray(raw)) {
    return { sites: [], problem: 'fetch-blocklist.json is not a list.' };
  }

  const sites: BlockedSite[] = [];
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return { sites: [], problem: `fetch-blocklist.json entry ${index} is not an object.` };
    }
    const record = entry as Record<string, unknown>;
    const domain = record['domain'];
    const why = record['why'];

    if (typeof domain !== 'string' || domain.trim() === '') {
      return { sites: [], problem: `fetch-blocklist.json entry ${index} has no domain.` };
    }
    if (domain !== domain.trim().toLowerCase() || /[\s/:]/.test(domain)) {
      return {
        sites: [],
        problem: `fetch-blocklist.json entry ${index} is not a bare lower-case domain.`,
      };
    }
    if (typeof why !== 'string' || why.trim() === '') {
      return { sites: [], problem: `fetch-blocklist.json entry ${index} does not say why.` };
    }

    sites.push({ domain, why });
  }

  return { sites, problem: null };
}

const parsed = parseBlocklist(rawBlocklist);

/** The shipped list. */
export const SHIPPED_BLOCKLIST: readonly BlockedSite[] = parsed.sites;

/** Why the shipped file could not be read, or `null`. Asserted `null` by a test. */
export const SHIPPED_BLOCKLIST_PROBLEM: string | null = parsed.problem;

/**
 * Is this host on the list?
 *
 * The rule is "equal to the domain, or a subdomain of it" — NOT `includes`.
 * `includes` would block `notlinkedin.com` and, much worse, would block
 * nothing about `linkedin.com.phishing.test` while looking like it did. A
 * leading dot is what separates a subdomain from a lookalike.
 */
export function isBlockedHost(
  host: string,
  list: readonly BlockedSite[] = SHIPPED_BLOCKLIST,
): boolean {
  const normalised = host.trim().toLowerCase().replace(/\.$/, '');
  if (normalised === '') return false;

  return list.some((site) => normalised === site.domain || normalised.endsWith(`.${site.domain}`));
}

/**
 * Is the page at this address one we will not go and get?
 *
 * An address that will not parse answers `false`, and that is deliberate: it is
 * not blocked, it is not a URL, and the verdict on what is fetchable belongs to
 * Rust. Answering `true` here would hide a real refusal behind a guess made in
 * the browser, and the user would be told "open it yourself" about something
 * that was never openable.
 */
export function isBlockedUrl(
  raw: string,
  list: readonly BlockedSite[] = SHIPPED_BLOCKLIST,
): boolean {
  try {
    return isBlockedHost(new URL(raw.trim()).hostname, list);
  } catch {
    return false;
  }
}
