import { type JobProviderId, type KeylessSourceId } from '@cviper/job-apis';

import { type Board } from '../boards/model';
import { type KeyState } from '../../status/environment';
import { Icon } from '../../ui';

import { KeylessBar } from './KeylessBar';
import { type FeedChoice } from './feedDefaults';
import { KeylessFeedToggles } from './KeylessFeedToggles';
import { ProviderToggles } from './ProviderToggles';
import { hasAnyJobBoardKey } from './model';

/*
  A part of the Search form, moved here word for word so `Search.tsx` stays
  under the 800-line limit (L-389). Search still owns every piece of state and
  draws it exactly where it was; this only draws what it is handed. The other
  part, "Also open", is in Search's one action row since L-433.
*/

export interface WhereToLookProps {
  readonly keyStates: Record<JobProviderId, KeyState>;
  readonly chosen: ReadonlySet<JobProviderId>;
  readonly onToggle: (provider: JobProviderId, next: boolean) => void;
  readonly onOpenSettings?: (() => void) | undefined;
  /** True while a search runs, and while no country is chosen (L-417): every tick waits. */
  readonly running: boolean;
  /** Why a keyed board cannot search the chosen country, or `null` (L-417). */
  readonly blocked: (provider: JobProviderId) => string | null;
  readonly keylessChosen: ReadonlySet<KeylessSourceId>;
  readonly onToggleKeyless: (source: KeylessSourceId, next: boolean) => void;
  readonly feedChoice: FeedChoice;
  /** A United Kingdom search with a place typed (L-419): the free feed's default is off. */
  readonly ukPlace: boolean;
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
 * The browser's own fold. Closed on every visit and never remembered: a stored
 * open/closed setting would be one more thing Search keeps, which the privacy
 * page would then have to list. Nothing in the summary line is a button
 * ("Manage job boards" stays inside).
 *
 * The mark is ours, a drawn chevron that turns down when the fold opens
 * (L-437), not the browser's ▸. `list-none` switches off the browser's mark;
 * WebKit ignores that and needs its `::-webkit-details-marker` hidden too. No
 * transition: the motion budget has no room for it. The app's other folds
 * keep the browser's mark for now.
 */
export function WhereToLook({
  keyStates,
  chosen,
  onToggle,
  onOpenSettings,
  running,
  blocked,
  keylessChosen,
  onToggleKeyless,
  feedChoice,
  ukPlace,
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
      <details data-testid="search-where-fold" className="group">
        <summary className="min-h-11 cursor-pointer list-none py-2.5 [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden="true"
            data-testid="search-where-mark"
            className="mr-2 inline-flex h-lh items-center align-top text-ink-muted group-open:rotate-90"
          >
            <Icon name="chevron" size={16} />
          </span>
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
                blocked={blocked}
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
              arbeitnowOffForUk={feedChoice.arbeitnow === undefined && ukPlace}
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
