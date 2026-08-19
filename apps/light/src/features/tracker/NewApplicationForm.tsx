import { useState, type FormEvent } from 'react';

import { type ApplicationStatus } from '@cviper/core-types';

import { PRIMARY_BUTTON } from '../../app/buttons';

import {
  STATUS_LABELS,
  TRACKER_COLUMNS,
  draftIsValid,
  validateDraft,
  type ApplicationDraft,
  type DraftErrors,
} from './model';

/**
 * Adding an application by hand.
 *
 * ============================================================================
 * IN THE PANE, NOT IN A MODAL
 * ============================================================================
 * The board stays visible while you type, which matters more than it sounds:
 * the most common reason to add a card by hand is that you have just applied
 * somewhere, and being able to see the rest of the column while you do it is
 * the whole value of a board.
 *
 * ============================================================================
 * VALIDATION SHOWS UP AFTER YOU TRY, NOT WHILE YOU TYPE
 * ============================================================================
 * Errors appear on submit and then update live. Validating from the first
 * keystroke means telling someone their title is empty while they are in the
 * middle of typing it, which is both true and useless.
 *
 * Every broken field is reported at once. Fixing one error only to be shown the
 * next one is the worst version of a form.
 */

const EMPTY: ApplicationDraft = { title: '', company: '', location: '', status: 'saved' };

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly onChange: (value: string) => void;
  readonly optional?: boolean;
}

function Field({ id, label, value, error, onChange, optional = false }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-muted">
        {label}
        {optional ? <span className="font-normal text-ink-faint"> (optional)</span> : null}
      </label>
      <input
        id={id}
        value={value}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={`mt-1 w-full rounded-control border bg-card px-2.5 py-1.5 text-ink ${
          error === undefined ? 'border-line' : 'border-danger'
        }`}
      />
      {error === undefined ? null : (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

interface NewApplicationFormProps {
  readonly onCreate: (draft: ApplicationDraft) => void;
  readonly onCancel: () => void;
}

export function NewApplicationForm({ onCreate, onCancel }: NewApplicationFormProps) {
  const [draft, setDraft] = useState<ApplicationDraft>(EMPTY);
  const [showErrors, setShowErrors] = useState(false);

  const errors: DraftErrors = validateDraft(draft);
  const visible: DraftErrors = showErrors ? errors : {};

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setShowErrors(true);

    if (!draftIsValid(errors)) return;
    onCreate(draft);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3" data-testid="new-application-form">
      <Field
        id="new-title"
        label="Job title"
        value={draft.title}
        error={visible.title}
        onChange={(title) => setDraft((current) => ({ ...current, title }))}
      />
      <Field
        id="new-company"
        label="Company"
        value={draft.company}
        error={visible.company}
        onChange={(company) => setDraft((current) => ({ ...current, company }))}
      />
      <Field
        id="new-location"
        label="Location"
        optional
        value={draft.location}
        error={visible.location}
        onChange={(location) => setDraft((current) => ({ ...current, location }))}
      />

      <div>
        <label htmlFor="new-status" className="block text-xs font-medium text-ink-muted">
          Status
        </label>
        <select
          id="new-status"
          value={draft.status}
          onChange={(event) => {
            // Read the value NOW. React nulls `currentTarget` once the handler
            // returns, and the updater passed to `setDraft` runs afterwards —
            // so reading it in there throws on `null`.
            const status = event.currentTarget.value as ApplicationStatus;
            setDraft((current) => ({ ...current, status }));
          }}
          className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
        >
          {TRACKER_COLUMNS.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2 pt-1">
        {/*
          The view's ONE blue button while this form is open — the header's
          "Add application" is disabled for exactly as long as this is on
          screen. "Save" produces "Saved": an action keeps its name through the
          whole flow.
        */}
        <button type="submit" data-primary="true" className={PRIMARY_BUTTON}>
          Save application
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-control px-3 py-1.5 text-ink-muted hover:bg-sunken hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
