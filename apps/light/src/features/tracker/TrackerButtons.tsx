import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';

/**
 * The single "Add application" button, wherever it happens to be.
 *
 * One component so the two placements cannot drift into two different buttons,
 * and so `data-primary` — which the tests count — is attached in exactly one
 * place.
 */
export function AddApplicationButton({
  testId,
  disabled,
  onClick,
  className = '',
}: {
  testId: string;
  disabled: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-primary="true"
      disabled={disabled}
      onClick={onClick}
      className={`${PRIMARY_BUTTON} ${className}`}
    >
      Add application
      {disabled ? <span className="sr-only"> — the form is already open</span> : null}
    </button>
  );
}

/**
 * The second way in — and NOT a blue button.
 *
 * "Add application" stays the view's one primary. Pasting an advert is a
 * shortcut to the same form, not a different destination, and a second blue
 * button beside the first would leave neither of them meaning anything.
 */
export function PasteJobButton({
  testId,
  disabled,
  onClick,
  className = '',
}: {
  testId: string;
  disabled: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={`${SECONDARY_BUTTON} ${className}`}
    >
      Paste a job
      {disabled ? <span className="sr-only"> — a form is already open</span> : null}
    </button>
  );
}
