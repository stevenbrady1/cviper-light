import { useRef } from 'react';

import { SECONDARY_BUTTON } from '../../app/buttons';
import { Dialog } from '../../ui';

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
 *   * Tab stays inside it, and focus goes back to the Delete button when it
 *     closes (L-236). `aria-modal` alone tells a screen reader the page behind
 *     is inert; it does not stop Tab from reaching it.
 *
 * The backdrop, markers, trap, first focus and Escape are `ui/Dialog.tsx`'s
 * (L-356); this file keeps the words, the buttons, and which one gets focus.
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

  return (
    <Dialog
      initialFocus={cancelRef}
      onEscape={onCancel}
      labelledBy="confirm-delete-title"
      testId="confirm-delete"
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
          className={SECONDARY_BUTTON}
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
    </Dialog>
  );
}
