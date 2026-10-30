import { useEffect, useRef } from 'react';

import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';

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
}

/**
 * The view's ONE blue button, and — when it is grey — why, right beside it.
 *
 * ============================================================================
 * THE REASON IS IN THE BUTTON'S OWN ROW, AT THE BUTTON'S OWN HEIGHT (L-335)
 * ============================================================================
 * It was in the same row before, as a plain paragraph, and a wrapping row puts
 * a long sentence at its natural width onto a line of its own: under the
 * button. In the owner's window that line started 2px below the bottom of the
 * screen, so the user saw a grey button and no reason at all. The reason area
 * is now a flexible item that shrinks into the rest of the button's line, and
 * drops under it only when the row is narrower than its basis — so whenever
 * the button is on screen, so is the reason. The button points at it with
 * `aria-describedby`, so a screen reader hears why as well.
 *
 * The fix button ticks the free feed(s) the default would have ticked. It is
 * secondary and `type="button"`, so it never submits the form (L-313), and
 * pressing it moves focus to Search — the fix button itself is gone by then,
 * and focus left on nothing is focus thrown back to the top of the page.
 */
export function SearchSubmitRow({ running, disabledReason, fix }: SearchSubmitRowProps) {
  const submit = useRef<HTMLButtonElement>(null);
  const focusWhenEnabled = useRef(false);

  useEffect(() => {
    if (!focusWhenEnabled.current || disabledReason !== null) return;
    focusWhenEnabled.current = false;
    submit.current?.focus();
  }, [disabledReason]);

  return (
    <div data-testid="search-submit-row" className="mt-4 flex flex-wrap items-center gap-3">
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

      {disabledReason === null ? null : (
        <div data-testid="search-reason-area" className="min-w-0 flex-1 basis-64">
          <p id="search-reason" data-testid="search-reason" className="text-ink-muted">
            {disabledReason}
          </p>
          {fix === null ? null : (
            <button
              type="button"
              data-testid={fix.testId ?? 'search-tick-feeds'}
              disabled={running}
              onClick={() => {
                focusWhenEnabled.current = true;
                fix.onFix();
              }}
              className={`mt-2 ${SECONDARY_BUTTON}`}
            >
              {fix.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
