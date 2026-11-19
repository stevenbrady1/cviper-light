import { useEffect, useRef } from 'react';

import { PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { type Board } from '../boards/model';
import { ErrorBox } from '../../ui';

import { openBoardsDisabledReason, openBoardsLabel } from './boardChoice';
import { SaveSearchOpener, type SaveSearchBox } from './SearchSaved';

export interface SearchSubmitRowProps {
  readonly running: boolean;
  /** Why Search cannot be pressed, or `null` when it can. */
  readonly disabledReason: string | null;
  /**
   * The one-press fix for that reason (L-335), or `null` when there is none:
   * its label, what pressing it does, and — when it is not a feed tick, like
   * the UK's "Get a free Reed key" (L-338) — its own test id.
   */
  readonly fix: {
    readonly label: string;
    readonly onFix: () => void;
    readonly testId?: string | undefined;
  } | null;
  /** No country chosen yet (L-417): "Also open" and "Save this search" wait too. */
  readonly locked?: boolean | undefined;
  /** The ticked boards "Also open" opens in the browser (L-329). Left out, it is not drawn. */
  readonly boardsToOpen?: readonly Board[] | undefined;
  readonly onOpenTicked?: (() => Promise<void>) | undefined;
  /** Boards that would not open on the last press. */
  readonly boardsProblem?: readonly string[] | undefined;
  /** "Save this search" (L-309): only its opener is here; the name box is a form of its own. */
  readonly saveBox?: SaveSearchBox | undefined;
  readonly suggestedName?: string | undefined;
  /** Tracker with the paste pane open (L-324). Left undefined, nothing is drawn. */
  readonly onBringJobIn?: (() => void) | undefined;
}

/**
 * Search's ONE action row (L-433): the view's one blue button, "Also open in N
 * boards", a thin divider, then "Save this search" and "Found one? Bring it in"
 * as quiet buttons. Every button but Search is `type="button"`, so none of them
 * submits the search. "Save this search" is only the opener: its name box is a
 * form of its own, and forms cannot nest, so `SearchSaved` draws it outside the
 * search form.
 *
 * ============================================================================
 * THE REASONS ARE IN THE ROW, ON ONE LINE UNDER THE BUTTONS (L-335, L-433)
 * ============================================================================
 * The L-335 bug: Search's reason was drawn under the row, and in the owner's
 * window that line started 2px below the bottom of the screen, so the user saw
 * a grey button and no reason at all. The reason then sat beside the button.
 * With four buttons there is no room beside it, but since L-342 the row is
 * sticky, so a line INSIDE the row, under the buttons, is on screen whenever
 * the buttons are. Search's reason and the reason "Also open" is grey share
 * that line, and each button points at its own with `aria-describedby`.
 *
 * The fix button ticks the free feed(s) the default would have ticked. It is
 * secondary and `type="button"`, so it never submits the form (L-313), and
 * pressing it moves focus to Search — the fix button itself is gone by then,
 * and focus left on nothing is focus thrown back to the top of the page.
 *
 * ============================================================================
 * STICKY FROM `md:` UP, SO A SHORT WINDOW CANNOT HIDE IT (L-342)
 * ============================================================================
 * The form is tall and the smallest window is 1000×700, so the row could fall
 * below the bottom edge, taking the button and its reason with it. It now holds
 * at the bottom of the scroll area until the page reaches its natural place. It
 * stays in the form's flow and after every choice in the DOM (L-313), and a
 * sticky box never moves below where it belongs, so it scrolls away with the
 * form and never floats over the results.
 *
 *   - `-bottom-5` cancels the scroll area's `py-5`: sticky stops at the PADDING
 *     edge, and `bottom-0` left a 20px strip of form showing under the row.
 *   - `mt-0 pt-4` is the same 16px gap as `mt-4`, with the background behind
 *     it; `pb-3 -mb-3` paints 12px below the row without moving what follows.
 *   - No z-index: a sticky box already paints above the unpositioned form
 *     before it, and hints (`z-50`) still paint above it.
 *   - The scroll area's `scroll-pb` keeps a focused tick clear of the row. The
 *     row itself sits in that zone, so focus moved to Search from code does not
 *     scroll: the fix was pressed right below it, so it is already on screen.
 *
 * Phones keep all of it off: an on-screen keyboard plus a tall wrapped row
 * would cover the very fields being typed in. There the row wraps, and the
 * divider is not drawn: it would dangle at the end of a line.
 */
export function SearchSubmitRow({
  running,
  disabledReason,
  fix,
  locked = false,
  boardsToOpen,
  onOpenTicked,
  boardsProblem = [],
  saveBox,
  suggestedName = '',
  onBringJobIn,
}: SearchSubmitRowProps) {
  const submit = useRef<HTMLButtonElement>(null);
  const focusWhenEnabled = useRef(false);

  useEffect(() => {
    if (!focusWhenEnabled.current || disabledReason !== null) return;
    focusWhenEnabled.current = false;
    submit.current?.focus({ preventScroll: true });
  }, [disabledReason]);

  const boardsReason =
    boardsToOpen === undefined ? null : openBoardsDisabledReason(boardsToOpen.length);

  return (
    <>
      <div
        data-testid="search-submit-row"
        className="mt-4 md:sticky md:-bottom-5 md:mt-0 md:-mb-3 md:bg-canvas md:pt-4 md:pb-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            ref={submit}
            type="submit"
            data-testid="search-submit"
            data-primary="true"
            disabled={running || disabledReason !== null}
            aria-describedby={disabledReason === null ? undefined : 'search-reason'}
            className={PRIMARY_BUTTON}
          >
            {/*
              "Search" (L-219, owner decision 2026-10-08): one action, one
              name — and since L-329 one job: it searches here and opens
              no browser tabs, so pressing it always shows results here.
            */}
            {running ? 'Working…' : 'Search'}
          </button>

          {/* The ticked boards, in the browser (L-329). Disabled — never hidden — with none ticked. */}
          {boardsToOpen === undefined ? null : (
            <button
              type="button"
              data-testid="search-open-boards"
              disabled={running || locked || boardsReason !== null}
              aria-describedby={boardsReason === null ? undefined : 'search-open-boards-reason'}
              onClick={() => void onOpenTicked?.()}
              className={SECONDARY_BUTTON}
            >
              {openBoardsLabel(boardsToOpen.length)}
            </button>
          )}

          {saveBox === undefined && onBringJobIn === undefined ? null : (
            <span
              aria-hidden="true"
              data-testid="search-row-divider"
              className="hidden h-5 w-px bg-line md:block"
            />
          )}

          {saveBox === undefined ? null : (
            <SaveSearchOpener
              box={saveBox}
              suggestedName={suggestedName}
              disabled={running || locked}
            />
          )}

          {/*
            The way back for a job found on a board in the browser (L-324). Always
            enabled: boards also open from saved searches and the few-results panel.
          */}
          {onBringJobIn === undefined ? null : (
            <button
              type="button"
              data-testid="search-bring-in"
              onClick={onBringJobIn}
              className={QUIET_BUTTON}
            >
              Found one? Bring it in
            </button>
          )}
        </div>

        {disabledReason === null && boardsReason === null ? null : (
          <div
            data-testid="search-reason-area"
            className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-ink-muted"
          >
            {disabledReason === null ? null : (
              <p id="search-reason" data-testid="search-reason" className="min-w-0">
                {disabledReason}
              </p>
            )}
            {boardsReason === null ? null : (
              <p
                id="search-open-boards-reason"
                data-testid="search-open-boards-reason"
                className="min-w-0"
              >
                {boardsReason}
              </p>
            )}
            {disabledReason === null || fix === null ? null : (
              <button
                type="button"
                data-testid={fix.testId ?? 'search-tick-feeds'}
                disabled={running}
                onClick={() => {
                  focusWhenEnabled.current = true;
                  fix.onFix();
                }}
                className={SECONDARY_BUTTON}
              >
                {fix.label}
              </button>
            )}
          </div>
        )}
      </div>

      {boardsProblem.length === 0 ? null : (
        <ErrorBox variant="box" gapAbove="mt-2" testId="search-boards-problem">
          {`${boardsProblem.join(', ')} did not open in your browser. Check that a default browser is set, then try again.`}
        </ErrorBox>
      )}
    </>
  );
}
