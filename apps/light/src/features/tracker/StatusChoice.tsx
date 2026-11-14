import { useId } from 'react';

import { type ApplicationStatus } from '@cviper/core-types';

import { STATUS_LABELS, TRACKER_COLUMNS } from './model';

interface StatusChoiceProps {
  readonly value: ApplicationStatus;
  readonly onChange: (status: ApplicationStatus) => void;
}

/**
 * A job's status: all five, side by side, one click (L-412).
 *
 * The keyboard route to the same thing dragging does. Drag-and-drop is faster
 * with a mouse and impossible without one, so the board is never the only way
 * to move a card.
 *
 * ============================================================================
 * NATIVE RADIO BUTTONS, DRAWN AS SEGMENTS
 * ============================================================================
 * Five real `<input type="radio">` sharing a name. The browser then gives, with
 * nothing written here: one Tab stop for the group, arrow keys that move AND
 * choose, and "Status, Interviewing, 3 of 5" to a screen reader. An arrow key
 * changes the status at once, as it did in the drop-down this replaced. Past
 * the last choice is the engine's rule: Edge (the Windows app) goes round to
 * the first, WebKit stops.
 *
 * shortcut: WebKit drops `:focus-visible`, and so the ring, while an arrow key
 * moves between radios (Edge keeps it). The arrow also chooses, so the white
 * segment still shows where focus is. Draw the ring on `:focus` as well if a
 * WebKit build ever ships to keyboard users.
 *
 * Each input is see-through and covers its whole segment, so the segment is
 * the target (44px tall below `md`, like every button) and the focus ring is
 * drawn round it. The chosen one is a white box WITH A BORDER on the sunken
 * track: the border is the mark that is not a colour, and it is on the chosen
 * input only, so it survives Windows High Contrast, which repaints fills.
 *
 * Not blue. The Tracker's one blue button is "Add application".
 *
 * Five words do not always fit one row (a phone held narrow, larger text), so
 * the row wraps. It never scrolls sideways and nothing is cut off.
 */
export function StatusChoice({ value, onChange }: StatusChoiceProps) {
  const id = useId();

  return (
    <fieldset
      role="radiogroup"
      aria-labelledby={`${id}-label`}
      data-testid="detail-status"
      className="min-w-0"
    >
      <legend id={`${id}-label`} className="block text-xs font-medium text-ink-muted">
        Status
      </legend>
      <div className="mt-1 flex flex-wrap gap-0.5 rounded-control bg-sunken p-0.5">
        {TRACKER_COLUMNS.map((status) => (
          <label
            key={status}
            // Above its neighbours while focused, or they would paint over the ring.
            className="relative inline-flex min-h-11 flex-auto cursor-pointer items-center justify-center px-1.5 py-1.5 text-xs font-medium has-focus-visible:z-10 md:min-h-0"
          >
            <input
              type="radio"
              name={id}
              value={status}
              checked={value === status}
              // Fires only on becoming chosen: a click on the chosen one saves nothing.
              onChange={() => onChange(status)}
              data-testid={`detail-status-${status}`}
              className="peer absolute inset-0 cursor-pointer appearance-none rounded-control checked:border checked:border-ink-faint checked:bg-card"
            />
            <span className="pointer-events-none relative text-ink-muted peer-checked:text-ink peer-hover:text-ink">
              {STATUS_LABELS[status]}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
