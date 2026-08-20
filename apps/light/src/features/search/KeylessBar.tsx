import { buildBoardUrl } from '@cviper/job-apis';

import { SECONDARY_BUTTON } from '../../app/buttons';
import { type Board } from '../boards/model';
import { type BrowserPort } from '../../platform/browser';

import { type SearchForm } from './model';

/**
 * The buttons that always work.
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
 * NOT ONE BOARD IS NAMED IN THIS FILE
 * ============================================================================
 * Every button comes from `boards`, which comes from `job-boards.json` with the
 * user's own list layered on top. A hard-coded board here would be a board
 * nobody could switch off, could not reorder, and could not sit next to one
 * they added themselves — and it would be the one that got forgotten when the
 * shipped list changed. The label, the order and the URL shape are all data.
 *
 * ============================================================================
 * NOTHING IS ADDED TO THE LINK
 * ============================================================================
 * No `utm_source`, no affiliate tag, no identifier of any kind. The URL is
 * built by `@cviper/job-apis` from a template and two form fields, and opened
 * in the user's own browser, where they are already signed in. See the module
 * comment in `links.ts` for why there is no LinkedIn scraper here either.
 */

interface KeylessBarProps {
  readonly form: SearchForm;
  readonly browser: BrowserPort;
  /** Shipped defaults with the user's choices applied. Disabled boards included. */
  readonly boards: readonly Board[];
}

export function KeylessBar({ form, browser, boards }: KeylessBarProps) {
  const input = { keywords: form.keywords, location: form.location };
  const shown = boards.filter((board) => board.enabled);

  return (
    <section
      data-testid="keyless-bar"
      className="rounded-card border border-line bg-sunken px-4 py-3"
    >
      <p className="font-mono text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
        No key needed
      </p>
      <p className="mt-1 text-ink">
        Send this same search to a job board in your own browser, where you are already signed in.
        Nothing to set up and nothing to spend.
      </p>

      {shown.length === 0 ? (
        <p data-testid="keyless-none" className="mt-2 text-ink-muted">
          Every board is switched off. Turn one back on under Job boards in Settings.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {shown.map((board) => (
            <button
              key={board.id}
              type="button"
              data-testid={`keyless-${board.id}`}
              aria-label={`Search ${board.label} in your browser`}
              onClick={() => void browser.open(buildBoardUrl(board, input))}
              className={SECONDARY_BUTTON}
            >
              {board.label}
            </button>
          ))}
        </div>
      )}

      <p className="mt-2 text-xs text-ink-faint">
        Opens in your browser. CViper adds nothing to the link. Choose which boards appear, and add
        your own, under Job boards in Settings.
      </p>
    </section>
  );
}
