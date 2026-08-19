/**
 * Opening a link in the user's own browser — the only way this app shows a web
 * page at all.
 *
 * ============================================================================
 * THERE IS NO IN-APP BROWSER, AND THAT IS THE POINT
 * ============================================================================
 * A job advert, a signup page and a LinkedIn search all open in the browser the
 * user already has, where they are already signed in and where their own
 * extensions, blockers and password manager apply. Rendering a third-party page
 * inside this window would mean shipping a browser we cannot patch, inside an
 * app that has a credential store attached to it.
 *
 * ============================================================================
 * NOTHING IS ADDED TO THE LINK
 * ============================================================================
 * The CViper web application appends `utm_source` / `utm_medium` /
 * `utm_campaign` to every outbound job URL (`_tag_affiliate_url` in
 * `backend/job_sites_api.py`). This does not, and will not. The product promise
 * is that nothing about the user leaves their machine, and a tagged link
 * announces them to a third party the moment they click it — from a desktop
 * binary they cannot inspect. `browser.test.ts` asserts the URL arrives at the
 * plugin byte-for-byte.
 *
 * ============================================================================
 * THE SCHEME CHECK IS A BACKSTOP, AND BACKSTOPS NEED TESTS
 * ============================================================================
 * `openUrl` hands its string to the operating system shell. Every URL this app
 * opens is either a constant in our own source or an advert link that
 * `normalise.ts` already filtered to `http`/`https` — so in normal operation
 * this check never fires. It is here for the abnormal case, which is why the
 * refusals are what `browser.test.ts` spends most of its time on: `file:` opens
 * a local file, `javascript:` and `data:` are script, and a UNC path reaches a
 * network share.
 */
import { openUrl } from '@tauri-apps/plugin-opener';

import { err, ok, type Result } from '@cviper/core-types';

/** A web link, and nothing else. Anchored, so a scheme cannot be prefixed in. */
const WEB_URL = /^https?:\/\/[^\s/]/i;

export interface BrowserError {
  /** Legible enough to show a user without further translation. */
  readonly message: string;
}

export interface BrowserPort {
  /** Open a web link in the user's default browser. */
  open(url: string): Promise<Result<void, BrowserError>>;
}

/**
 * May this string be handed to the OS?
 *
 * Deliberately NOT `new URL(...)`: `URL` happily parses `file:` and
 * `javascript:` and would only tell us the string is well formed, which is not
 * the question. The question is whether it is a WEB link, and a whitelist of
 * two schemes is the whole answer.
 *
 * Not trimmed first, on purpose. A leading space or newline is not something a
 * real link has, and trimming here would mean accepting `\njavascript:` on the
 * assumption that whatever parses it downstream will not trim as well.
 */
export function isOpenableUrl(url: string): boolean {
  return WEB_URL.test(url);
}

/** The text of an unknown thrown value, without assuming it is an `Error`. */
function describeThrown(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string' && cause.trim() !== '') return cause;
  // Never `String(cause)` — an object renders as "[object Object]", which reads
  // as a bug in the app rather than as "your machine has no browser set".
  return 'This computer did not open the link. Check that a default browser is set.';
}

export function createTauriBrowserPort(): BrowserPort {
  return {
    async open(url) {
      if (!isOpenableUrl(url)) {
        // Never quotes the string back: it is the thing we have just decided is
        // not safe to render, and a `javascript:` payload in an error banner is
        // a smaller version of the same problem.
        return err({ message: 'That link could not be opened because it is not a web address.' });
      }

      try {
        await openUrl(url);
        return ok(undefined);
      } catch (thrown) {
        // Never swallowed. A link that silently does nothing is the kind of
        // dead end that ends a session.
        return err({ message: describeThrown(thrown) });
      }
    },
  };
}
