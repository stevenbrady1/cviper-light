import { useState } from 'react';

import { boardFilterSupport, buildBoardUrl, type KeylessSourceId } from '@cviper/job-apis';

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

interface BoardCheckboxesProps {
  readonly boards: readonly Board[];
  readonly ticked: ReadonlySet<string>;
  readonly onToggle: (id: string, on: boolean) => void;
  readonly disabled: boolean;
}

/**
 * One checkbox per board (L-219 part 4). Each still says, on hover or focus,
 * which of the form's filters its link carries. The hint's handlers sit on the
 * label (focus events bubble to it from the checkbox); its description is on
 * the checkbox itself, where a screen reader reads it.
 */
function BoardCheckboxes({ boards, ticked, onToggle, disabled }: BoardCheckboxesProps) {
  return (
    <>
      {boards.map((board) => (
        <Hint
          key={board.id}
          text={boardHint(board.label, boardFilterSupport(board), board.filters)}
        >
          {({ 'aria-describedby': describedBy, ...trigger }) => (
            <label
              {...trigger}
              className="inline-flex min-h-11 items-center gap-1.5 text-ink md:min-h-0"
            >
              <input
                type="checkbox"
                data-testid={`keyless-${board.id}`}
                data-board={board.id}
                aria-describedby={describedBy}
                checked={ticked.has(board.id)}
                disabled={disabled}
                onChange={(event) => onToggle(board.id, event.currentTarget.checked)}
                className="size-4 accent-blue"
              />
              {board.label}
            </label>
          )}
        </Hint>
      ))}
    </>
  );
}

interface KeylessBarProps {
  /** Shipped defaults with the user's choices applied. Disabled boards included. */
  readonly boards: readonly Board[];
  /** The ticked board ids (the page owns them: its Search button opens them). */
  readonly ticked: ReadonlySet<string>;
  readonly onToggle: (id: string, on: boolean) => void;
  /** While a search is running. */
  readonly disabled?: boolean | undefined;
  /**
   * Go to Settings → Job boards (L-310). The shell owns which view shows, so
   * it is handed in; left undefined, no button is drawn rather than one that
   * does nothing.
   */
  readonly onManageBoards?: (() => void) | undefined;
}

export function KeylessBar({
  boards,
  ticked,
  onToggle,
  disabled = false,
  onManageBoards,
}: KeylessBarProps) {
  const [showAll, setShowAll] = useState(false);
  const shown = boards.filter((board) => board.enabled);
  const { main, rest } = mainBoards(shown);
  // A ticked board behind "More" stays on show, so nothing ticked is ever hidden.
  const visible = showAll
    ? shown
    : shown.filter((board) => main.includes(board) || ticked.has(board.id));
  const hiddenCount = shown.length - visible.length;

  return (
    <section
      data-testid="keyless-bar"
      aria-labelledby="keyless-heading"
      // No box of its own: it sits in Search's "Where to look" box (L-313).
      className="border-t border-line pt-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 id="keyless-heading" className="font-medium text-ink">
          Search job boards with these filters
        </h3>
        {/*
          Where the boards are chosen, ordered and added (L-310). It used to be
          a sentence at the bottom of this box; now it is one press, and it is
          here even when every board is switched off — the state that needs it.
        */}
        {onManageBoards === undefined ? null : (
          <button
            type="button"
            data-testid="keyless-manage"
            onClick={onManageBoards}
            className={`${QUIET_BUTTON} text-xs`}
          >
            Manage job boards
          </button>
        )}
      </div>
      <p className="mt-0.5 text-xs text-ink-muted">
        Tick the boards you want, then press Search. Each one opens in your browser, where you are
        already signed in, with the words and filters above. Point at a board to see which filters
        it takes.
      </p>

      {shown.length === 0 ? (
        <p data-testid="keyless-none" className="mt-2 text-ink-muted">
          Every board is switched off. Turn one back on under Job boards in Settings.
        </p>
      ) : (
        <fieldset data-testid="keyless-boards" className="mt-2 min-w-0">
          <legend className="sr-only">Job boards to open</legend>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <BoardCheckboxes
              boards={visible}
              ticked={ticked}
              onToggle={onToggle}
              disabled={disabled}
            />
            {rest.length === 0 ? null : (
              <button
                type="button"
                data-testid="keyless-more"
                aria-expanded={showAll}
                onClick={() => setShowAll((was) => !was)}
                className={QUIET_BUTTON}
              >
                {showAll ? 'Fewer boards' : `More boards (${hiddenCount})`}
              </button>
            )}
          </div>
        </fieldset>
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
 * What a screen reader hears when few results come back, or `null` when the
 * message is not shown (L-238). `FewResults` carries no role: `Search` speaks
 * this through a `LiveStatus` that is always on the page, because a message
 * that arrives with its words already in it is not reliably announced.
 */
export function fewResultsText(count: number, boards: readonly Board[]): string | null {
  const { main } = mainBoards(boards.filter((board) => board.enabled));
  if (count >= FEW_RESULTS || main.length === 0) return null;
  const found =
    count === 0
      ? 'No matches in CViper’s sources.'
      : `Only ${count} ${count === 1 ? 'match' : 'matches'} in CViper’s sources.`;
  return `${found} Try the same search on a job board.`;
}

/**
 * "Only 2 matches in CViper's sources. Try the same search on a job board:"
 * with the main boards, each one click and one tab (L-219, owner decision
 * 2026-10-08). Nothing is opened on its own: a search that suddenly opened
 * five browser tabs would be the most jarring thing on the screen.
 */
export function FewResults({ count, form, browser, boards }: FewResultsProps) {
  const { main } = mainBoards(boards.filter((board) => board.enabled));
  if (fewResultsText(count, boards) === null) return null;

  return (
    <div
      data-testid="search-few-results"
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

/**
 * One line per free feed that answered but had nothing matching (L-219).
 *
 * NOT an alert, and deliberately worded so it cannot be mistaken for one: the
 * feed answered, it published N jobs, and none of them matched. The only thing
 * to change is what the user typed, and this is the one line on the screen
 * that says so. (Moved here from `Search.tsx` with the keyless pieces, L-238.)
 */
export function NothingMatchedNotes({
  entries,
}: {
  readonly entries: readonly { readonly source: KeylessSourceId; readonly note: string }[];
}) {
  return (
    <>
      {entries.map((entry) => (
        <p
          key={entry.source}
          data-testid={`keyless-nothing-matched-${entry.source}`}
          className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
        >
          {entry.note}
        </p>
      ))}
    </>
  );
}
