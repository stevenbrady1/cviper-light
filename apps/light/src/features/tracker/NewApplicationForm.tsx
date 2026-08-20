import { useState, type FormEvent } from 'react';

import { type ApplicationStatus } from '@cviper/core-types';

import { PRIMARY_BUTTON } from '../../app/buttons';

import {
  EMPTY_DRAFT,
  STATUS_LABELS,
  TRACKER_COLUMNS,
  draftIsValid,
  validateDraft,
  type ApplicationDraft,
  type DraftErrors,
} from './model';

/**
 * Adding an application by hand — and reviewing one an AI read off a paste.
 *
 * ============================================================================
 * ONE FORM, BOTH WAYS IN. THAT IS THE POINT.
 * ============================================================================
 * The paste flow does not get its own screen. It fills THIS form in and hands
 * it to the user, so an extracted card and a typed card are the same card, the
 * same validation and the same save button. A second, parallel "review" form
 * would be two places for the rules to live and one of them would drift.
 *
 * It also means the extraction cannot be saved without a human pressing the
 * button below, because there is no other way for a card to be created.
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

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly onChange: (value: string) => void;
  readonly optional?: boolean;
  /** Figures the user compares get Plex Mono and `tabular-nums`. */
  readonly numeric?: boolean;
  readonly placeholder?: string;
}

function Field({
  id,
  label,
  value,
  error,
  onChange,
  optional = false,
  numeric = false,
  placeholder,
}: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-muted">
        {label}
        {optional ? <span className="font-normal text-ink-faint"> (optional)</span> : null}
      </label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={`mt-1 w-full rounded-control border bg-card px-2.5 py-1.5 text-ink ${
          numeric ? 'font-mono tabular-nums' : ''
        } ${error === undefined ? 'border-line' : 'border-danger'}`}
      />
      {error === undefined ? null : (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The one multi-line box. Big enough to hold a whole advert, because it does. */
function DescriptionField({
  value,
  error,
  onChange,
}: {
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor="new-description" className="block text-xs font-medium text-ink-muted">
        Description
        <span className="font-normal text-ink-faint"> (optional)</span>
      </label>
      <textarea
        id="new-description"
        rows={5}
        value={value}
        data-testid="new-description"
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : 'new-description-error'}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={`mt-1 w-full rounded-control border bg-card px-2.5 py-1.5 text-ink ${
          error === undefined ? 'border-line' : 'border-danger'
        }`}
      />
      {error === undefined ? null : (
        <p id="new-description-error" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

interface NewApplicationFormProps {
  readonly onCreate: (draft: ApplicationDraft) => void;
  readonly onCancel: () => void;
  /**
   * What the boxes start with.
   *
   * Absent for a hand-typed card. Supplied by the paste flow, which is the ONLY
   * thing that ever pre-fills this form — and which has already turned every
   * `null` in the extraction into an empty string, so there is no "the model
   * was not sure" state for this component to render differently. A blank box
   * means the same thing however it got there.
   */
  readonly initial?: ApplicationDraft | undefined;
}

export function NewApplicationForm({ onCreate, onCancel, initial }: NewApplicationFormProps) {
  // Read ONCE, as the initial state. A pre-filled form the user is editing must
  // not be reset under them by a re-render higher up — and `Tracker` keys this
  // component on the pane so a genuinely new paste remounts it instead.
  const [draft, setDraft] = useState<ApplicationDraft>(initial ?? EMPTY_DRAFT);
  const [showErrors, setShowErrors] = useState(false);

  const errors: DraftErrors = validateDraft(draft);
  const visible: DraftErrors = showErrors ? errors : {};

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setShowErrors(true);

    // ========================================================================
    // THE ONLY WAY A CARD IS EVER CREATED.
    // ========================================================================
    // Reached only from a submit event, which is reached only from the button
    // below. An extraction that nobody pressed this for is not saved, is not
    // queued, and leaves no row behind. `pasteJob.test.tsx` asserts it.
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

      {/*
        The advert's own details, below the four things that identify a card.
        Grouped and labelled so a hand-typed card is not confronted with six
        extra boxes as though they were required — every one of them is
        optional, and a blank one is a correct answer.
      */}
      <fieldset className="space-y-3 border-line border-t pt-3">
        <legend className="sr-only">Advert details</legend>
        <p className="font-mono text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
          From the advert
        </p>

        <DescriptionField
          value={draft.description}
          error={visible.description}
          onChange={(description) => setDraft((current) => ({ ...current, description }))}
        />

        <div className="grid grid-cols-3 gap-2">
          <Field
            id="new-salary-min"
            label="Salary from"
            optional
            numeric
            placeholder="45000"
            value={draft.salaryMin}
            error={visible.salaryMin}
            onChange={(salaryMin) => setDraft((current) => ({ ...current, salaryMin }))}
          />
          <Field
            id="new-salary-max"
            label="Salary to"
            optional
            numeric
            placeholder="55000"
            value={draft.salaryMax}
            error={visible.salaryMax}
            onChange={(salaryMax) => setDraft((current) => ({ ...current, salaryMax }))}
          />
          <Field
            id="new-salary-currency"
            label="Currency"
            optional
            placeholder="GBP"
            value={draft.salaryCurrency}
            error={visible.salaryCurrency}
            onChange={(salaryCurrency) => setDraft((current) => ({ ...current, salaryCurrency }))}
          />
        </div>
        {/*
          Said once, under the boxes, rather than in three labels. A day rate,
          an hourly rate and pro-rata pay are all deliberately left blank by the
          extraction — the advert's own wording is in the description above —
          and a user who sees an empty salary box on a £650-a-day contract
          deserves to know that was a decision rather than a miss.
        */}
        <p className="text-xs text-ink-faint">
          Yearly figures. Day rates, hourly rates and pro-rata pay are left blank on purpose — the
          advert&rsquo;s own wording is kept in the description.
        </p>

        <Field
          id="new-url"
          label="Link"
          optional
          value={draft.url}
          error={visible.url}
          onChange={(url) => setDraft((current) => ({ ...current, url }))}
        />
        <Field
          id="new-posted-date"
          label="Posted"
          optional
          numeric
          placeholder="2026-08-18"
          value={draft.postedDate}
          error={visible.postedDate}
          onChange={(postedDate) => setDraft((current) => ({ ...current, postedDate }))}
        />
      </fieldset>

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
