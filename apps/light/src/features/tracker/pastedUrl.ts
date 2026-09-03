/**
 * Noticing that the advert box contains a link instead of an advert.
 *
 * ============================================================================
 * WHY THIS EXISTS: A BARE URL IS THE ONE PASTE A MODEL CANNOT DO ANYTHING WITH
 * ============================================================================
 * A model cannot open a link. Sent one, it does the worst possible thing — it
 * answers anyway, from the words in the address itself. Paste
 * `https://jobs.example.com/senior-java-developer-london` and a confident,
 * entirely invented extraction comes back: title "Senior Java Developer",
 * location "London", company guessed off the domain. Every box on the review
 * form then looks exactly as trustworthy as one read from real advert text, and
 * the user has no way to tell the difference.
 *
 * That is the same failure the whole feature is built to avoid — see the "NO
 * REGEX FALLBACK" note in `PasteJobForm.tsx`, which refuses to guess a title
 * off a first line for precisely this reason. A guess from a URL is worse,
 * because the round trip through a model makes it look like a reading.
 *
 * So the paste never happens. This module spots the case, the form says so, and
 * NO REQUEST IS MADE — not to a provider, not anywhere. It is also the polite
 * outcome: it costs the user nothing, where the alternative spends an API
 * allowance, or thirty seconds of local model time, to produce fiction.
 *
 * ============================================================================
 * NO NETWORK, NO REACT, NO I/O. PURE FUNCTIONS OVER STRINGS.
 * ============================================================================
 * Same arrangement as `extraction.ts`, for the same reason: the rules that
 * matter can be tested without rendering anything or mocking a model.
 */
import { isBlockedUrl, type BlockedSite } from './fetchBlocklist';

/** The schemes a link box can do anything with. Deliberately `runFetch`'s set. */
const FETCHABLE_SCHEMES = new Set(['http:', 'https:']);

export interface UrlOnlyPaste {
  /** The address, trimmed. Ready to drop into the link box as typed. */
  readonly url: string;
  /** Is this a site we already know will not answer a fetch? */
  readonly blocked: boolean;
}

/**
 * Is the advert box holding nothing but a web address?
 *
 * ============================================================================
 * A SCHEME IS REQUIRED, AND THAT IS NOT PEDANTRY
 * ============================================================================
 * `www.example.com/jobs/1` is refused by this function even though a person
 * would call it a link. The reason is that the message this guard shows points
 * at the Fetch button, and `runFetch` opens `http:` and `https:` and NOTHING
 * else — so recognising a scheme-less address here would send the user to a
 * button that then refused it. Two dead ends instead of one, and the second one
 * of our own making. The rule is the same rule in both places on purpose.
 *
 * It also keeps the guard honest about ordinary words. `Node.js` and `React.js`
 * are single dotted tokens, and a rule loose enough to catch `www.example.com`
 * catches those too — at which case a real (if short) paste gets refused with
 * "that is a link", which is a far worse failure than the one being prevented.
 *
 * ============================================================================
 * ANY OTHER CONTENT AT ALL AND THIS IS A NORMAL PASTE
 * ============================================================================
 * Whitespace inside the trimmed text means there is more here than an address —
 * an advert that happens to quote its own URL, a recruiter's email with a link
 * in it, two links pasted together. All of those are real text a model can
 * genuinely read, so they go the ordinary way. This guard only fires when there
 * is provably nothing to extract, because a false positive blocks a paste the
 * user was entitled to make.
 *
 * Returns `null` for "this is an ordinary paste, carry on" rather than a flag
 * object, so the caller cannot accidentally read a falsy field as a verdict.
 */
export function urlOnlyPaste(text: string, list?: readonly BlockedSite[]): UrlOnlyPaste | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  // More than one token: there is prose here, whatever else there is.
  if (/\s/.test(trimmed)) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Not an address. A single long word, a reference number, a file path.
    return null;
  }

  if (!FETCHABLE_SCHEMES.has(parsed.protocol)) return null;

  return {
    url: trimmed,
    blocked: list === undefined ? isBlockedUrl(trimmed) : isBlockedUrl(trimmed, list),
  };
}

/**
 * What to say when the advert box holds a link to a site we will fetch.
 *
 * Route forward first, and the route is one button away: the address has
 * already been put in the link box by the time this is on screen, so the
 * sentence describes a press, not a chore. It never says the user did something
 * wrong, because pasting the link is a completely reasonable thing to try — it
 * is what the link box is for, one field up.
 */
export const URL_ONLY_NOTE =
  'That is a link, not the advert itself, and a model cannot open one. It is in the link box ' +
  'above now — press Fetch to bring the advert text down here, or open the page in your ' +
  'browser and paste the text in yourself.';

/**
 * What to say when the advert box holds a link to a site that will not answer.
 *
 * A different sentence from the one above, because the button the other message
 * points at would not work here, and sending someone to press it would be a
 * worse outcome than saying nothing. This is the same guided paste the blocked
 * fetch path gives — see `FETCH_FALLBACK_NOTE` — reworded for a user who has
 * not pressed anything yet and is owed the reason.
 */
export const URL_ONLY_BLOCKED_NOTE =
  'That is a link, not the advert itself, and this site only shows its adverts to a signed-in ' +
  'browser — fetching it would come back empty. Open the page in your browser, copy the advert ' +
  'text, and paste it here. The link is in the box above and is saved with the job.';

/** The one sentence for this paste, whichever kind of site it points at. */
export function urlOnlyNote(paste: UrlOnlyPaste): string {
  return paste.blocked ? URL_ONLY_BLOCKED_NOTE : URL_ONLY_NOTE;
}
