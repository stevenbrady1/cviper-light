import { buildIndeedSearchUrl, buildLinkedInSearchUrl } from '@cviper/job-apis';

import { SECONDARY_BUTTON } from '../../app/buttons';
import { type BrowserPort } from '../../platform/browser';

import { type SearchForm } from './model';

/**
 * The two buttons that always work.
 *
 * ============================================================================
 * THIS IS A FEATURE, NOT A FALLBACK, AND THE COPY MUST NOT APOLOGISE
 * ============================================================================
 * It is always on screen — before any key is set up, after both are, and when a
 * board is down. It is not an error state and it is not something that appears
 * only when something else has failed, because the moment it becomes a
 * consolation prize it starts reading like one.
 *
 * The plain fact is that a person who has just installed this app, with no
 * account and no key, can type a job title and be looking at real results in
 * their own browser two seconds later. That is the best thing on this screen on
 * day one, and it is built from the SAME form state as the real search, so it
 * always searches for whatever is in the boxes.
 *
 * ============================================================================
 * NOTHING IS ADDED TO THE LINK
 * ============================================================================
 * No `utm_source`, no affiliate tag, no identifier of any kind. The URL is
 * built by `@cviper/job-apis` from two form fields and opened in the user's own
 * browser, where they are already signed in. See the module comment in
 * `links.ts` for why there is no LinkedIn scraper here either.
 */

interface KeylessBarProps {
  readonly form: SearchForm;
  readonly browser: BrowserPort;
}

export function KeylessBar({ form, browser }: KeylessBarProps) {
  const input = { keywords: form.keywords, location: form.location };

  return (
    <section
      data-testid="keyless-bar"
      className="rounded-card border border-line bg-sunken px-4 py-3"
    >
      <p className="font-mono text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
        No key needed
      </p>
      <p className="mt-1 text-ink">
        Open this same search on LinkedIn or Indeed, in your own browser, where you are already
        signed in. Nothing to set up and nothing to spend.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="keyless-linkedin"
          onClick={() => void browser.open(buildLinkedInSearchUrl(input))}
          className={SECONDARY_BUTTON}
        >
          Search LinkedIn
        </button>
        <button
          type="button"
          data-testid="keyless-indeed"
          onClick={() => void browser.open(buildIndeedSearchUrl(input))}
          className={SECONDARY_BUTTON}
        >
          Search Indeed
        </button>
        <span className="text-xs text-ink-faint">
          Opens in your browser. CViper adds nothing to the link.
        </span>
      </div>
    </section>
  );
}
