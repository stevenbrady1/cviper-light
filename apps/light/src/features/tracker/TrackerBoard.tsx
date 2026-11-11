import { type ApplicationStatus, type InterviewSubstage, type Job } from '@cviper/core-types';

import { SECONDARY_BUTTON } from '../../app/buttons';
import { LiveStatus } from '../../app/LiveStatus';

import { type JobProgress, type StepId } from '../flow/steps';

import { TrackerColumn } from './TrackerColumn';
import { TRACKER_COLUMNS, type TrackerEntry } from './model';
import { type Pane } from './TrackerSidePane';

/**
 * The board once it has cards: the search box above, then the five columns.
 * Every value and handler belongs to `Tracker`, which passes them down.
 */
export interface TrackerBoardProps {
  readonly searchQuery: string;
  readonly setSearchQuery: (value: string) => void;
  readonly normalizedQuery: string;
  readonly visibleEntries: readonly TrackerEntry[];
  readonly grouped: Record<ApplicationStatus, TrackerEntry[]>;
  readonly today: string;
  readonly clock: Date;
  readonly selected: TrackerEntry | null;
  readonly settlingId: string | null;
  readonly substages: readonly InterviewSubstage[];
  readonly substagesLoaded: boolean;
  readonly openSubstageEditor: (trigger: HTMLElement | null) => void;
  readonly setPane: (pane: Pane) => void;
  readonly onStatusChange: (applicationId: string, status: ApplicationStatus) => void;
  readonly progressFor: (entry: TrackerEntry) => JobProgress;
  readonly onContinue: ((job: Job, step: StepId) => void) | undefined;
}

export function TrackerBoard({
  searchQuery,
  setSearchQuery,
  normalizedQuery,
  visibleEntries,
  grouped,
  today,
  clock,
  selected,
  settlingId,
  substages,
  substagesLoaded,
  openSubstageEditor,
  setPane,
  onStatusChange,
  progressFor,
  onContinue,
}: TrackerBoardProps) {
  return (
    /*
     * Phone: the columns are wider than the screen and scroll sideways,
     * one column snapping into view at a time — the same board, read a
     * column at a time. Desktop: all of them, side by side, each at
     * least 11rem wide (L-175). With the 380px detail pane open the
     * five used to share ~630px and every title shrank to "Senior
     * Pr…"; now the board scrolls sideways instead of crushing.
     */
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <label className="sr-only" htmlFor="tracker-search">
          Search applications
        </label>
        <input
          id="tracker-search"
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search applications"
          className="min-h-11 min-w-0 flex-1 rounded-control border border-field-line bg-card px-3 py-2 text-ink placeholder:text-ink-faint focus:border-blue focus:outline-none md:min-h-0"
        />
        {searchQuery.trim() === '' ? null : (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setSearchQuery('')}
            className={SECONDARY_BUTTON}
          >
            Clear
          </button>
        )}
      </div>
      <LiveStatus
        text={
          normalizedQuery !== '' && visibleEntries.length === 0
            ? 'No applications match your search.'
            : null
        }
      />
      {normalizedQuery !== '' && visibleEntries.length === 0 ? (
        <p data-testid="tracker-search-no-results" className="shrink-0 text-sm text-ink-muted">
          No applications match “{searchQuery.trim()}”.
        </p>
      ) : null}
      <div
        data-testid="tracker-board"
        className="flex min-h-0 flex-1 snap-x snap-mandatory gap-2 overflow-x-auto md:snap-none"
      >
        {TRACKER_COLUMNS.map((status) => (
          <TrackerColumn
            key={status}
            status={status}
            entries={grouped[status]}
            today={today}
            now={clock}
            selectedId={selected?.application.id ?? null}
            settlingId={settlingId}
            substages={substages}
            onEditSubstages={substagesLoaded ? openSubstageEditor : undefined}
            onSelect={(applicationId) => setPane({ kind: 'entry', applicationId })}
            onDropCard={onStatusChange}
            progressFor={progressFor}
            onContinue={
              onContinue === undefined ? undefined : (entry, step) => onContinue(entry.job, step)
            }
          />
        ))}
      </div>
    </div>
  );
}
