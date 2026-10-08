import { useState } from 'react';

import { boardFilterSupport, buildBoardUrl } from '@cviper/job-apis';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { Hint } from '../../app/Hint';
import { boardHint } from '../../app/hints';
import { type Board } from '../boards/model';
import { type BrowserPort } from '../../platform/browser';

import { boardSearchInput, type SearchForm } from './model';

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
 * IT IS NO LONGER THE ONLY KEYLESS THING ON THE SCREEN, SO IT SAYS WHAT IT IS
 * ============================================================================
 * Since L-110 the free feeds above also need no key, so the old eyebrow "No key
 * needed" described two different sections and distinguished neither. This one
 * hands the address to the user's own browser and gets them a real search of a
 * whole site; the feeds above are read inside the app and can only show what
 * was recently published. Both are worth having and they are not the same
 * thing, so each says which it is.
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
 * comment in `links.ts` for why there is no scraper behind these buttons
 * either.
 */

/** How many boards show before "More" (L-219). The shipped order puts the five main UK boards first. */
export const MAIN_BOARD_COUNT = 5;

/**
 * The boards always on show, and the rest behind "More" (L-219): the first
 * five shipped boards in the user's order, plus every board the user added
 * themselves — they added it to use it, so it is never hidden.
 */
export function mainBoards(enabled: readonly Board[]): {
  readonly main: readonly Board[];
  readonly rest: readonly Board[];
} {
  const shippedShown = new Set(
    enabled
      .filter((board) => !board.userAdded)
      .slice(0, MAIN_BOARD_COUNT)
      .map((board) => board.id),
  );
  const isMain = (board: Board) => board.userAdded || shippedShown.has(board.id);
  return { main: enabled.filter(isMain), rest: enabled.filter((board) => !isMain(board)) };
}

interface BoardButtonsProps {
  readonly boards: readonly Board[];
  readonly form: SearchForm;
  readonly browser: BrowserPort;
  /** Test-id prefix, so two rows of the same boards stay distinguishable. */
  readonly prefix: string;
}

/** One button per board; each says which of the form's filters its link carries (L-219). */
function BoardButtons({ boards, form, browser, prefix }: BoardButtonsProps) {
  const input = boardSearchInput(form);
  return (
    <>
      {boards.map((board) => (
        <Hint
          key={board.id}
          text={boardHint(board.label, boardFilterSupport(board), board.filters)}
        >
          {(trigger) => (
            <button
              {...trigger}
              type="button"
              data-testid={`${prefix}-${board.id}`}
              data-board={board.id}
              aria-label={`Search ${board.label} in your browser`}
              onClick={() => void browser.open(buildBoardUrl(board, input))}
              className={SECONDARY_BUTTON}
            >
              {board.label}
            </button>
          )}
        </Hint>
      ))}
    </>
  );
}

interface KeylessBarProps {
  readonly form: SearchForm;
  readonly browser: BrowserPort;
  /** Shipped defaults with the user's choices applied. Disabled boards included. */
  readonly boards: readonly Board[];
}

export function KeylessBar({ form, browser, boards }: KeylessBarProps) {
  const [showAll, setShowAll] = useState(false);
  const shown = boards.filter((board) => board.enabled);
  const { main, rest } = mainBoards(shown);

  return (
    <section
      data-testid="keyless-bar"
      aria-labelledby="keyless-heading"
      className="rounded-card border border-line bg-sunken px-4 py-3"
    >
      <h2 id="keyless-heading" className="font-medium text-ink">
        Search job boards with these filters
      </h2>
      <p className="mt-0.5 text-xs text-ink-muted">
        Opens the site in your browser, where you are already signed in, with the words and filters
        above. Point at a board to see which filters it takes.
      </p>

      {shown.length === 0 ? (
        <p data-testid="keyless-none" className="mt-2 text-ink-muted">
          Every board is switched off. Turn one back on under Job boards in Settings.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <BoardButtons
            boards={showAll ? shown : main}
            form={form}
            browser={browser}
            prefix="keyless"
          />
          {rest.length === 0 ? null : (
            <button
              type="button"
              data-testid="keyless-more"
              aria-expanded={showAll}
              onClick={() => setShowAll((was) => !was)}
              className={QUIET_BUTTON}
            >
              {showAll ? 'Fewer boards' : `More boards (${rest.length})`}
            </button>
          )}
        </div>
      )}

      <p className="mt-2 text-xs text-ink-faint">
        CViper adds nothing to the link. Choose which boards appear, in what order, and add your
        own, under Job boards in Settings.
      </p>
    </section>
  );
}

/** Below this many results, the boards are offered beside them (L-219). */
export const FEW_RESULTS = 5;

interface FewResultsProps {
  /** How many jobs CViper's own sources found. */
  readonly count: number;
  readonly form: SearchForm;
  readonly browser: BrowserPort;
  readonly boards: readonly Board[];
}

/**
 * "Only 2 matches in CViper's sources. Try the same search on a job board:"
 * with the main boards, each one click and one tab (L-219, owner decision
 * 2026-10-08). Nothing is opened on its own: a search that suddenly opened
 * five browser tabs would be the most jarring thing on the screen.
 */
export function FewResults({ count, form, browser, boards }: FewResultsProps) {
  const { main } = mainBoards(boards.filter((board) => board.enabled));
  if (count >= FEW_RESULTS || main.length === 0) return null;

  return (
    <div
      data-testid="search-few-results"
      role="status"
      className="rounded-card border border-line bg-sunken px-4 py-3"
    >
      <p className="text-ink">
        {count === 0
          ? 'No matches in CViper’s sources.'
          : `Only ${count} ${count === 1 ? 'match' : 'matches'} in CViper’s sources.`}{' '}
        Try the same search on a job board:
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <BoardButtons boards={main} form={form} browser={browser} prefix="few" />
      </div>
    </div>
  );
}
