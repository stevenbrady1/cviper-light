import { daysSinceTimestamp } from '../../lib/dates';

import { NEXT_ACTION_TONES, nextActionDescription, nextActionUrgency } from './nextAction';
import { STATUS_LABELS, STATUS_PILL_TONES, type TrackerEntry } from './model';
import { STALENESS_BANDS, stalenessBand, stalenessDescription } from './staleness';

/**
 * One application, as three lines.
 *
 *   title                      Inter 500 — the thing you scan for
 *   company · location         Inter 400, muted — context, not headline
 *   [status pill]  [due date]  the footer: state on the left, deadline on the
 *                              right, the date in mono so a column of them
 *                              lines up
 *
 * ============================================================================
 * THE LEFT EDGE
 * ============================================================================
 * A 2px rule down the left, coloured by how long the card has sat still. It is
 * the one piece of decoration in the app and it is not decoration: the column
 * tells you the STATUS, the edge tells you the AGE, and those are the two facts
 * that together say what to do next. See `staleness.ts` for why age is the fact
 * worth this much of the design.
 *
 * The colour is never the only telling. `aria-label` carries the same fact in
 * words, because a coloured stripe says nothing on a greyscale screen, nothing
 * to a screen reader, and very little to the one man in twelve with a colour
 * vision deficiency.
 */

/** The drag payload's type. Namespaced so nothing else can be dropped here. */
export const CARD_DRAG_TYPE = 'application/x-cviper-application-id';

interface TrackerCardProps {
  readonly entry: TrackerEntry;
  readonly today: string;
  readonly now: Date;
  readonly selected: boolean;
  readonly settling: boolean;
  readonly onSelect: (applicationId: string) => void;
}

export function TrackerCard({ entry, today, now, selected, settling, onSelect }: TrackerCardProps) {
  const { application, job } = entry;

  const days = daysSinceTimestamp(application.updated_at, now);
  const band = stalenessBand(days);
  const urgency = nextActionUrgency(application.next_action_date, today);
  const dueDescription = nextActionDescription(
    application.next_action,
    application.next_action_date,
    today,
  );

  const where = [job.company, job.location]
    .filter((part) => part !== null && part !== '')
    .join(' · ');

  return (
    <button
      type="button"
      draggable
      data-testid={`tracker-card-${application.id}`}
      data-staleness={band}
      data-status={application.status}
      aria-pressed={selected}
      aria-label={[job.title, where, stalenessDescription(days), dueDescription]
        .filter((part) => part !== null && part !== '')
        .join('. ')}
      onClick={() => onSelect(application.id)}
      onDragStart={(event) => {
        event.dataTransfer.setData(CARD_DRAG_TYPE, application.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      className={[
        'block w-full cursor-grab rounded-card border border-line border-l-2 bg-card',
        'px-3 py-2.5 text-left shadow-raised active:cursor-grabbing',
        STALENESS_BANDS[band].edgeClass,
        selected ? 'border-blue' : 'hover:border-ink-faint',
        // The app's ONE motion moment: a card arriving in its new column. See
        // theme.css, where `prefers-reduced-motion` removes it.
        settling ? 'cviper-card-settle' : '',
      ].join(' ')}
    >
      <p className="truncate font-medium text-ink">{job.title}</p>
      <p className="truncate text-xs text-ink-muted">{where}</p>

      <p className="mt-2 flex items-center justify-between gap-2">
        <span
          className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${STATUS_PILL_TONES[application.status]}`}
        >
          {STATUS_LABELS[application.status]}
        </span>

        {application.next_action_date === null || urgency === 'none' ? null : (
          <span
            data-testid={`tracker-card-due-${application.id}`}
            data-urgency={urgency}
            className={`shrink-0 text-[11px] ${NEXT_ACTION_TONES[urgency]}`}
          >
            {application.next_action_date}
          </span>
        )}
      </p>
    </button>
  );
}
