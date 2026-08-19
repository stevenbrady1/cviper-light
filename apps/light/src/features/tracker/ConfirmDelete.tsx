import { useEffect, useRef } from 'react';

/**
 * The app's only modal.
 *
 * ============================================================================
 * WHY THIS ONE IS ALLOWED TO BE A DIALOG
 * ============================================================================
 * Everything else in this app happens in the detail pane, because a modal that
 * interrupts an edit is a modal that costs three extra clicks per card. This is
 * the exception, and the test for the exception is simple: the action cannot be
 * undone. There is no undo stack and no bin — deleting an application removes
 * the row and the job with it — so the rest of the app genuinely should stop
 * and wait for an answer.
 *
 * ============================================================================
 * THE DETAILS THAT MAKE A DIALOG USABLE
 * ============================================================================
 *   * Focus lands on CANCEL, not on the destructive button. A stray Enter must
 *     not delete anything.
 *   * Escape cancels, and calls `preventDefault()` so the detail pane
 *     underneath does not ALSO close — otherwise one keypress cancels the
 *     dialog and throws away the selection behind it.
 *   * The card's title and company are in the question. "Delete this
 *     application?" is not a question anybody can answer confidently.
 *   * The confirm button says `Delete` — the same word as the button that
 *     opened it. An action keeps its name all the way through.
 */

interface ConfirmDeleteProps {
  readonly title: string;
  readonly company: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly confirmClassName: string;
}

export function ConfirmDelete({
  title,
  company,
  onConfirm,
  onCancel,
  confirmClassName,
}: ConfirmDeleteProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      // Claimed, so the detail pane's own Escape handler stands down.
      event.preventDefault();
      onCancel();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        data-testid="confirm-delete"
        className="w-full max-w-sm rounded-card bg-card p-5 shadow-overlay"
      >
        <h2 id="confirm-delete-title" className="font-semibold text-ink">
          Delete this application?
        </h2>
        <p className="mt-1 text-ink-muted">
          {`${title} at ${company} will be removed, along with its notes. This cannot be undone.`}
        </p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            data-testid="confirm-delete-cancel"
            className="rounded-control border border-line px-3 py-1.5 font-medium text-ink hover:bg-sunken"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="confirm-delete-confirm"
            className={confirmClassName}
          >
            Delete application
          </button>
        </div>
      </div>
    </div>
  );
}
