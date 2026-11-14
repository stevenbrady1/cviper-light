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
 * One application, as four parts.
 *
 *   title                          Inter 500 — the thing you scan for. Up to
 *                                  three lines (L-393). When the next action is
 *                                  overdue, a red dot sits in the card's top-right
 *                                  corner, in its padding, so it never narrows
 *                                  the title (L-409)
 *   company · location             Inter 400, muted — context, not headline. Up
 *                                  to two lines
 *   12 days since last change      the left edge's age in words (L-318)
 *   Reply by Friday                the next action, when there is one: the
 *   due in 2 days                  user's words on one line, clipped with an
 *                                  ellipsis; how close it is on the next,
 *                                  coloured by urgency, never clipped (L-409).
 *                                  With a date and no words, the due alone.
 *                                  With no date, the words alone, muted (L-393)
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
  const age = stalenessDescription(days);
  const urgency = nextActionUrgency(application.next_action_date, today);
  const line = nextActionLine(application.next_action, application.next_action_date, today);
  const dueDescription = nextActionDescription(
    application.next_action,
    application.next_action_date,
    today,
  );
  // An action with no readable date is a note, not a deadline: the user's own
  // words, muted, with no colour and no dot (L-393).
  const words = application.next_action?.trim() ?? '';
  const note = line === null && words !== '' ? words : null;

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
      aria-label={[
        job.title,
        where,
        substage === null ? null : `Stage: ${substage}`,
        age,
        dueDescription,
        note === null ? null : `Next action: ${note}`,
      ]
        .filter((part) => part !== null && part !== '')
        .join('. ')}
      onClick={() => onSelect(application.id)}
      onDragStart={(event) => {
        event.dataTransfer.setData(CARD_DRAG_TYPE, application.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      className={[
        'block w-full cursor-grab rounded-card border border-line border-l-2 bg-card',
        'relative px-3 py-2.5 text-left shadow-raised active:cursor-grabbing',
        STALENESS_BANDS[band].edgeClass,
        selected ? 'border-blue' : 'hover:border-ink-faint',
        // The app's ONE motion moment: a card arriving in its new column. See
        // theme.css, where `prefers-reduced-motion` removes it.
        settling ? 'cviper-card-settle' : '',
      ].join(' ')}
    >
      <p className="line-clamp-3 break-words font-medium text-ink">{job.title}</p>
      {urgency === 'overdue' ? (
        // Built like the side bar's status dot: a second telling of the red
        // "overdue" words below, so it is hidden from screen readers. Not a
        // StateMark: a mark needs a hint, and nothing can sit inside the card's button.
        // In the card's right padding, level with the title's first line, and
        // out of its flow, so the title keeps the card's full width (L-409).
        <span
          aria-hidden="true"
          data-testid={`tracker-card-overdue-${application.id}`}
          className="absolute top-4.5 right-0.5 size-2 rounded-pill bg-danger"
        />
      ) : null}
      <p className="line-clamp-2 break-words text-xs text-ink-muted">{where}</p>

      {substage === null ? null : (
        <p
          data-testid={`tracker-card-substage-${application.id}`}
          className="mt-1 truncate font-mono text-[11px] tracking-[0.04em] text-ink-muted"
        >
          {substage}
        </p>
      )}

      <p
        data-testid={`tracker-card-age-${application.id}`}
        className="mt-1 truncate text-[11px] text-ink-muted"
      >
        {age}
      </p>

      {line === null || urgency === 'none' ? null : (
        <p
          data-testid={`tracker-card-due-${application.id}`}
          data-urgency={urgency}
          className="mt-2 text-[11px]"
        >
          {/*
            Two lines (L-409). The user's words get the card's full width and
            clip with "…"; the due sits under them and may wrap, never clip. On
            one shared row the due held its width and the words were what went:
            in a narrow column, nothing but "· 2 days overdue".
          */}
          {line.action === null ? null : (
            <span
              data-testid={`tracker-card-due-action-${application.id}`}
              className="block truncate text-ink-muted"
            >
              {line.action}
            </span>
          )}
          <span
            data-testid={`tracker-card-due-when-${application.id}`}
            className={`block ${NEXT_ACTION_TONES[urgency]}`}
          >
            {line.when}
          </span>
        </p>
      )}

      {note === null ? null : (
        <p
          data-testid={`tracker-card-next-${application.id}`}
          className="mt-2 truncate text-[11px] text-ink-muted"
        >
          {note}
        </p>
      )}
    </button>
  );
}
