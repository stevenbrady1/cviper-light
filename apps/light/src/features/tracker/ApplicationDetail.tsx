import { useState } from 'react';

import { type Application, type ApplicationStatus } from '@cviper/core-types';

import { DESTRUCTIVE_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { daysSinceTimestamp } from '../../lib/dates';
import { useDebouncedField } from '../../lib/useDebouncedField';

import { ConfirmDelete } from './ConfirmDelete';
import { NEXT_ACTION_TONES, nextActionUrgency } from './nextAction';
import { STATUS_LABELS, TRACKER_COLUMNS, type TrackerEntry } from './model';
import { STALENESS_BANDS, stalenessBand, stalenessDescription } from './staleness';

/**
 * Editing one application, in the pane.
 *
 * ============================================================================
 * THERE IS NO SAVE BUTTON, AND THAT IS THE POINT
 * ============================================================================
 * The status select and the date commit the moment they change; the two text
 * fields commit shortly after you stop typing, and immediately if you click
 * away (see `useDebouncedField` for why the second half matters). So the loop
 * is: click a card, change one thing, click the next card. No dialog, no
 * confirmation, nothing to forget to press.
 *
 * A Save button would add a click to every single edit and — worse — would make
 * losing work possible.
 *
 * ============================================================================
 * THE ONE MODAL
 * ============================================================================
 * Delete, and only delete. Deleting an application is the single action here
 * that cannot be undone, and it is the one case where the rest of the app
 * genuinely should wait.
 */

/** How long after the last keystroke a text field saves itself. */
export const AUTOSAVE_DELAY_MS = 600;

interface ApplicationDetailProps {
  readonly entry: TrackerEntry;
  readonly today: string;
  readonly now: Date;
  readonly onEdit: (
    changes: Partial<Pick<Application, 'notes' | 'next_action' | 'next_action_date'>>,
  ) => void;
  readonly onStatusChange: (status: ApplicationStatus) => void;
  readonly onDelete: () => void;
}

/** `''` from an input means "nothing here", and the model spells that `null`. */
function orNull(value: string): string | null {
  const text = value.trim();
  return text === '' ? null : text;
}

export function ApplicationDetail({
  entry,
  today,
  now,
  onEdit,
  onStatusChange,
  onDelete,
}: ApplicationDetailProps) {
  const { application, job } = entry;
  const [confirming, setConfirming] = useState(false);

  const notes = useDebouncedField(
    application.notes ?? '',
    (value) => onEdit({ notes: orNull(value) }),
    AUTOSAVE_DELAY_MS,
  );

  const nextAction = useDebouncedField(
    application.next_action ?? '',
    (value) => onEdit({ next_action: orNull(value) }),
    AUTOSAVE_DELAY_MS,
  );

  const days = daysSinceTimestamp(application.updated_at, now);
  const band = stalenessBand(days);
  const urgency = nextActionUrgency(application.next_action_date, today);

  return (
    <div className="space-y-4">
      <p
        data-testid="detail-staleness"
        data-staleness={band}
        className="flex items-center gap-2 text-xs text-ink-muted"
      >
        <span
          aria-hidden="true"
          className={`h-4 w-0.5 shrink-0 border-l-2 ${STALENESS_BANDS[band].edgeClass}`}
        />
        {stalenessDescription(days)}
      </p>

      <div>
        <label htmlFor="detail-status" className="block text-xs font-medium text-ink-muted">
          Status
        </label>
        {/*
          The keyboard route to the same thing dragging does. Drag-and-drop is
          faster with a mouse and impossible without one, so the board is never
          the only way to move a card.
        */}
        <select
          id="detail-status"
          data-testid="detail-status"
          value={application.status}
          onChange={(event) => onStatusChange(event.currentTarget.value as ApplicationStatus)}
          className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
        >
          {TRACKER_COLUMNS.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="detail-next-action" className="block text-xs font-medium text-ink-muted">
          Next action
        </label>
        <input
          id="detail-next-action"
          data-testid="detail-next-action"
          value={nextAction.draft}
          placeholder="Chase the recruiter"
          onChange={(event) => nextAction.setDraft(event.currentTarget.value)}
          onBlur={nextAction.flush}
          className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
        />
      </div>

      <div>
        <label
          htmlFor="detail-next-action-date"
          className="block text-xs font-medium text-ink-muted"
        >
          Due
        </label>
        <input
          id="detail-next-action-date"
          data-testid="detail-next-action-date"
          type="date"
          value={application.next_action_date ?? ''}
          onChange={(event) => onEdit({ next_action_date: orNull(event.currentTarget.value) })}
          className={`mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 ${
            urgency === 'none' ? 'font-mono tabular-nums text-ink' : NEXT_ACTION_TONES[urgency]
          }`}
        />
        {urgency === 'overdue' ? (
          <p data-testid="detail-overdue" className="mt-1 text-xs text-danger">
            This was due before today. Move the date or do the thing.
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="detail-notes" className="block text-xs font-medium text-ink-muted">
          Notes
        </label>
        <textarea
          id="detail-notes"
          data-testid="detail-notes"
          rows={6}
          value={notes.draft}
          placeholder="What happened, who you spoke to, what they said."
          onChange={(event) => notes.setDraft(event.currentTarget.value)}
          onBlur={notes.flush}
          className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
        />
        <p className="mt-1 text-xs text-ink-faint">Saved as you type.</p>
      </div>

      <div className="border-t border-line pt-3">
        <button
          type="button"
          data-testid="detail-delete"
          onClick={() => setConfirming(true)}
          className={SECONDARY_BUTTON}
        >
          Delete application
        </button>
      </div>

      {confirming ? (
        <ConfirmDelete
          title={job.title}
          company={job.company}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onDelete();
          }}
          confirmClassName={DESTRUCTIVE_BUTTON}
        />
      ) : null}
    </div>
  );
}
