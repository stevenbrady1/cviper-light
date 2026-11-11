import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

import { useFocusTrap } from '../lib/useFocusTrap';

/**
 * The one pop-up window (L-356). Every modal in the app is drawn by this.
 *
 * `ConfirmDelete`, `ConsentGate` and `TailorContactDialog` each used to build
 * their own backdrop, dialog markers, focus trap, first focus and Escape, and
 * three copies drift. They keep their own words and buttons; this owns the
 * rest. `lib/one-dialog.contract.test.ts` fails the build if the dialog
 * markers appear anywhere else.
 *
 * ============================================================================
 * WHAT IT OWNS
 * ============================================================================
 *   * The backdrop, and the card the content sits on.
 *   * `role="dialog"` and `aria-modal="true"` — on the SAME element as the
 *     focus trap. The trap stands down for any container that is not the open
 *     `aria-modal` dialog (that is how a pop-up over the phone detail pane
 *     wins Tab), so markers on one element and the trap on another would
 *     break Tab silently.
 *   * Tab and Shift+Tab stay inside, and focus goes back to the opener on
 *     close (L-236, `lib/useFocusTrap.ts`).
 *   * First focus, on the control the caller names. There is no default on
 *     purpose: ConfirmDelete lands on "Keep it" and ConsentGate on "Not now",
 *     never on the button that does the irreversible thing, and that choice
 *     must be made by whoever writes the buttons. With no control to focus,
 *     focus stays where it was and Tab cannot reach the page behind.
 *   * Escape calls `onEscape` and claims the key with `preventDefault()`, so
 *     the detail pane underneath does not ALSO close.
 *
 * ============================================================================
 * WHAT IT DOES NOT DO
 * ============================================================================
 * A click on the backdrop does nothing, and Enter does nothing of its own.
 * None of the three pop-ups ever closed that way: each is a question the app
 * waits on, and a stray click must not answer it.
 */

export interface DialogProps {
  /** The control that gets focus when the pop-up opens. Required: see above. */
  readonly initialFocus: RefObject<HTMLElement | null>;
  /** What Escape means. Usually the same as the pop-up's "no" button. */
  readonly onEscape: () => void;
  /** The `id` of the heading that names the pop-up. */
  readonly labelledBy: string;
  /** Space-separated `id`s of the text a screen reader reads with the heading. */
  readonly describedBy?: string | undefined;
  readonly testId: string;
  readonly children: ReactNode;
}

export function Dialog({
  initialFocus,
  onEscape,
  labelledBy,
  describedBy,
  testId,
  children,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Before the focus effect below: effects run in order, and the trap must
  // read the opener before focus moves.
  useFocusTrap(dialogRef);

  useEffect(() => {
    initialFocus.current?.focus();
  }, [initialFocus]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      // Claimed, so the detail pane's own Escape handler stands down.
      event.preventDefault();
      onEscape();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onEscape]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        data-testid={testId}
        className="w-full max-w-sm rounded-card bg-card p-5 shadow-overlay"
      >
        {children}
      </div>
    </div>
  );
}
