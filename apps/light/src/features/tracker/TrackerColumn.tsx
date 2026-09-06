import { useState } from 'react';

import { type ApplicationStatus } from '@cviper/core-types';

import { CARD_DRAG_TYPE, TrackerCard } from './TrackerCard';
import { STATUS_LABELS, type TrackerEntry } from './model';

/**
 * One column of the board.
 *
 * ============================================================================
 * THE COUNT IS MONO
 * ============================================================================
 * Like every other number in this app. Five column headers with proportional
 * digits do not line up with each other, and the whole point of a count in a
 * header is that you compare it with the one next to it.
 *
 * ============================================================================
 * DROP TARGETS ARE THE WHOLE COLUMN
 * ============================================================================
 * Including the empty space below the last card, which is where a user actually
 * aims. A column that only accepts a drop onto its list makes moving a card
 * into an empty column feel broken.
 *
 * The `dragOver` highlight uses `sunken` — the same well the column already
 * sits in, one step stronger. It is not a colour from the grammar, because
 * "you may let go here" is not a state of the user's job hunt.
 */

interface TrackerColumnProps {
  readonly status: ApplicationStatus;
  readonly entries: readonly TrackerEntry[];
  readonly today: string;
  readonly now: Date;
  readonly selectedId: string | null;
  readonly settlingId: string | null;
  readonly onSelect: (applicationId: string) => void;
  readonly onDropCard: (applicationId: string, status: ApplicationStatus) => void;
}

export function TrackerColumn({
  status,
  entries,
  today,
  now,
  selectedId,
  settlingId,
  onSelect,
  onDropCard,
}: TrackerColumnProps) {
  const [over, setOver] = useState(false);

  return (
    <section
      data-testid={`tracker-column-${status}`}
      data-drop-target={over ? 'active' : 'idle'}
      aria-label={`${STATUS_LABELS[status]}, ${entries.length} ${
        entries.length === 1 ? 'application' : 'applications'
      }`}
      onDragOver={(event) => {
        // Only our own payload. Without this check a dragged file or a
        // selection of text from another window would light the column up as
        // though it could be dropped there.
        if (!event.dataTransfer.types.includes(CARD_DRAG_TYPE)) return;
        // `preventDefault` on dragover is what MAKES an element a drop target.
        // Leaving it out is the classic HTML drag-and-drop bug: everything
        // looks wired up and nothing can ever be dropped.
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);

        const applicationId = event.dataTransfer.getData(CARD_DRAG_TYPE);
        if (applicationId === '') return;
        onDropCard(applicationId, status);
      }}
      className={`flex min-h-0 min-w-[85vw] flex-1 snap-start flex-col rounded-card md:min-w-0 ${
        over ? 'bg-sunken' : 'bg-transparent'
      }`}
    >
      <header className="flex items-baseline justify-between gap-2 px-2 pt-2 pb-1.5">
        <h2 className="font-mono text-[11px] font-medium tracking-[0.12em] text-ink-muted uppercase">
          {STATUS_LABELS[status]}
        </h2>
        <span
          data-testid={`tracker-count-${status}`}
          className="font-mono text-xs tabular-nums text-ink-faint"
        >
          {entries.length}
        </span>
      </header>

      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {entries.map((entry) => (
          <li key={entry.application.id}>
            <TrackerCard
              entry={entry}
              today={today}
              now={now}
              selected={entry.application.id === selectedId}
              settling={entry.application.id === settlingId}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
