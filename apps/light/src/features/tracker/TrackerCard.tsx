import { daysSinceTimestamp } from '../../lib/dates';

import {
  NEXT_ACTION_TONES,
  nextActionDescription,
  nextActionLine,
  nextActionUrgency,
} from './nextAction';
import { type TrackerEntry } from './model';
import { STALENESS_BANDS, stalenessBand, stalenessDescription } from './staleness';

/**
 * One application, as three lines.
 *
 *   title                          Inter 500 — the thing you scan for
 *   company · location             Inter 400, muted — context, not headline
 *   Reply by Friday · due in 2 days  the next action, when there is one: the
 *                                  user's words, then how close it is, coloured
 *                                  by urgency. One line; the words clip with an
 *                                  ellipsis, the due never does
 *
 * No status pill (L-175). The column header already says the status, so a
 * pill repeating it on every card spent the footer on a fact already on
 * screen, while the one fact that was NOT — what the date is for — went
 * unsaid. The footer used to print the raw ISO date; with the detail pane open
 * it also spilled out of the card's border.
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
  /** The name of the interview sub-stage this card is in (L-205), or null. */
  readonly substage?: string | null | undefined;
  readonly onSelect: (applicationId: string) => void;
}

export function TrackerCard({
  entry,
  today,
  now,
  selected,
  settling,
  substage = null,
  onSelect,
}: TrackerCardProps) {
  const { application, job } = entry;

  const days = daysSinceTimestamp(application.updated_at, now);
  const band = stalenessBand(days);
  const urgency = nextActionUrgency(application.next_action_date, today);
  const line = nextActionLine(application.next_action, application.next_action_date, today);
  const dueDescription = nextActionDescription(
    application.next_action,
    application.next_action_date,
    today,
  );

  const where = [job.company, job.agency === null ? null : `via ${job.agency}`, job.location]
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
      aria-label={[job.title, where, substage, stalenessDescription(days), dueDescription]
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

      {substage === null ? null : (
        <p
          data-testid={`tracker-card-substage-${application.id}`}
          className="mt-1 truncate font-mono text-[11px] tracking-[0.04em] text-blue"
        >
          {substage}
        </p>
      )}

      {line === null || urgency === 'none' ? null : (
        <p
          data-testid={`tracker-card-due-${application.id}`}
          data-urgency={urgency}
          className="mt-2 flex min-w-0 text-[11px]"
        >
          {/*
            Only the user's words shrink. The due holds its width, so a long
            action can never push "due today" off the card — the first cut of
            this line clipped the whole thing, and the due was what went.
          */}
          {line.action === null ? null : (
            <>
              <span
                data-testid={`tracker-card-due-action-${application.id}`}
                className="min-w-0 truncate text-ink-muted"
              >
                {line.action}
              </span>
              <span className="shrink-0 whitespace-pre text-ink-muted"> · </span>
            </>
          )}
          <span
            data-testid={`tracker-card-due-when-${application.id}`}
            className={`shrink-0 ${NEXT_ACTION_TONES[urgency]}`}
          >
            {line.when}
          </span>
        </p>
      )}
    </button>
  );
}
