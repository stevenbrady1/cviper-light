import { type JobProviderId, type KeylessSourceId } from '@cviper/job-apis';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { type Board } from '../boards/model';
import { type KeyState } from '../../status/environment';
import { ErrorBox } from '../../ui';

import { openBoardsLabel } from './boardChoice';
import { KeylessBar } from './KeylessBar';
import { isUkLocation, type FeedChoice } from './feedDefaults';
import { KeylessFeedToggles } from './KeylessFeedToggles';
import { ProviderToggles } from './ProviderToggles';
import { hasAnyJobBoardKey, type SearchForm } from './model';

/*
  Two parts of the Search form, moved here word for word so `Search.tsx` stays
  under the 800-line limit (L-389). Search still owns every piece of state and
  draws both exactly where they were; these only draw what they are handed.
*/

export interface WhereToLookProps {
  readonly keyStates: Record<JobProviderId, KeyState>;
  readonly chosen: ReadonlySet<JobProviderId>;
  readonly onToggle: (provider: JobProviderId, next: boolean) => void;
  readonly onOpenSettings?: (() => void) | undefined;
  readonly running: boolean;
  readonly keylessChosen: ReadonlySet<KeylessSourceId>;
  readonly onToggleKeyless: (source: KeylessSourceId, next: boolean) => void;
  readonly feedChoice: FeedChoice;
  readonly form: SearchForm;
  readonly jobBoards: readonly Board[];
  readonly ticked: ReadonlySet<string>;
  readonly onToggleBoard: (id: string, on: boolean) => void;
  readonly onOpenJobBoards?: (() => void) | undefined;
  /** What is ticked, said beside the heading while the box is folded (L-398). */
  readonly summary: string;
}

/**
 * The "Where to look" box: the keyed boards, the free feeds and the board
 * ticks, folded behind one line that says what is ticked (L-398).
 *
 * The browser's own fold, like the others in the app. Closed on every visit and
 * never remembered: a stored open/closed setting would be one more thing Search
 * keeps, which the privacy page would then have to list. Nothing in the summary
 * line is a button ("Manage job boards" stays inside), and it keeps
 * `display: list-item` so the browser draws its own mark; `marker:text-sm`
 * keeps the line a whole 44px in WebKit (see `KeyRow`).
 */
export function WhereToLook({
  keyStates,
  chosen,
  onToggle,
  onOpenSettings,
  running,
  keylessChosen,
  onToggleKeyless,
  feedChoice,
  form,
  jobBoards,
  ticked,
  onToggleBoard,
  onOpenJobBoards,
  summary,
}: WhereToLookProps) {
  return (
    <section
      aria-labelledby="search-where-heading"
      data-testid="search-where"
      className="mt-4 rounded-card border border-line bg-sunken px-4"
    >
      <details data-testid="search-where-fold">
        <summary className="min-h-11 cursor-pointer py-2.5 marker:text-sm">
          <h2 id="search-where-heading" className="inline font-medium text-ink">
            Where to look
          </h2>
          <span aria-hidden="true" className="mx-2 text-ink-muted">
            ·
          </span>
          <span data-testid="search-where-summary" className="text-ink-muted">
            {summary}
          </span>
        </summary>
        <div className="space-y-3 pt-1 pb-3">
          {hasAnyJobBoardKey(keyStates) ? (
            <div>
              <ProviderToggles
                keyStates={keyStates}
                chosen={chosen}
                onToggle={onToggle}
                onOpenSettings={onOpenSettings ?? (() => undefined)}
                disabled={running}
              />
            </div>
          ) : null}

          {/*
      Under the keyed boards, not instead of them. The two are different
      things and the screen says which is which: a search of a job board
      with the user's own free key, and a browse of what a public
      feed has just published. Neither is presented as a fallback for
      the other.
    */}
          <div>
            <KeylessFeedToggles
              chosen={keylessChosen}
              onToggle={onToggleKeyless}
              arbeitnowOffForUk={feedChoice.arbeitnow === undefined && isUkLocation(form.location)}
              disabled={running}
            />
          </div>

          {/*
        The same search on the whole of a job board, one tick away
        (L-219). Inside the form now, so its ticks come before the
        button that opens them.
      */}
          <KeylessBar
            boards={jobBoards}
            ticked={ticked}
            onToggle={onToggleBoard}
            disabled={running}
            onManageBoards={onOpenJobBoards}
          />
        </div>
      </details>
    </section>
  );
}

export interface OpenBoardsRowProps {
  readonly running: boolean;
  /** Why the boards' button cannot be pressed, or `null` when it can. */
  readonly openBoardsReason: string | null;
  readonly onOpenTicked: () => Promise<void>;
  readonly boardsToOpen: readonly Board[];
  /** Boards that would not open on the last press. */
  readonly boardsProblem: readonly string[];
  /** Tracker with the paste pane open (L-324). Left undefined, nothing is drawn. */
  readonly onBringJobIn?: (() => void) | undefined;
}

/** "Also open in N boards", its reason, and the boards that did not open. */
export function OpenBoardsRow({
  running,
  openBoardsReason,
  onOpenTicked,
  boardsToOpen,
  boardsProblem,
  onBringJobIn,
}: OpenBoardsRowProps) {
  return (
    <>
      <div data-testid="search-open-boards-row" className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="search-open-boards"
          disabled={running || openBoardsReason !== null}
          onClick={() => void onOpenTicked()}
          className={SECONDARY_BUTTON}
        >
          {openBoardsLabel(boardsToOpen.length)}
        </button>

        {openBoardsReason === null ? null : (
          <p data-testid="search-open-boards-reason" className="text-ink-muted">
            {openBoardsReason}
          </p>
        )}
      </div>

      {boardsProblem.length === 0 ? null : (
        <ErrorBox variant="box" gapAbove="mt-2" testId="search-boards-problem">
          {`${boardsProblem.join(', ')} did not open in your browser. Check that a default browser is set, then try again.`}
        </ErrorBox>
      )}

      {/*
        The way back for a job found on a board in the browser (L-324). Always
        enabled: boards also open from saved searches and the few-results panel.
      */}
      {onBringJobIn === undefined ? null : (
        <div className="mt-2">
          <button
            type="button"
            data-testid="search-bring-in"
            onClick={onBringJobIn}
            className={QUIET_BUTTON}
          >
            Found one? Bring it in
          </button>
        </div>
      )}
    </>
  );
}
