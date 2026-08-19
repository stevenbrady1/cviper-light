import { useEffect, type ReactNode } from 'react';

/**
 * The right-hand detail pane. 380px, persistent, NOT a modal.
 *
 * ============================================================================
 * WHY A PANE AND NOT A DIALOG
 * ============================================================================
 * The tracker loop is "look at a card, change one thing, look at the next one".
 * A modal turns every single one of those into open, edit, close, reopen — four
 * actions for one edit, repeated across dozens of applications. It also hides
 * the board behind the thing you are using the board to understand: you cannot
 * see that the column is full of stale cards while a dialog sits on top of it.
 *
 * A pane keeps both on screen. Selection changes the pane's contents; nothing
 * opens and nothing closes.
 *
 * Modals are kept for exactly two jobs: confirming something destructive, and
 * a wizard where the whole point is that the rest of the app should wait.
 *
 * ============================================================================
 * ESCAPE CLOSES IT
 * ============================================================================
 * Listened for on `document`, in the bubble phase, and SKIPPED if something
 * nearer the event has already called `preventDefault()`. That is how the
 * delete confirmation can take Escape for itself without the pane vanishing out
 * from underneath it.
 */

interface DetailPaneProps {
  /** The heading. Names the thing being edited, not the action. */
  readonly title: string;
  /** One line under the heading, or `null`. */
  readonly subtitle?: string | null;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function DetailPane({ title, subtitle = null, onClose, children }: DetailPaneProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // Something closer to the event — the delete confirmation — has already
      // decided what Escape means here.
      if (event.defaultPrevented) return;
      if (event.key !== 'Escape') return;

      event.preventDefault();
      onClose();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <aside
      aria-label={title}
      data-testid="detail-pane"
      className="flex w-[380px] shrink-0 flex-col border-l border-line bg-card"
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-ink">{title}</h2>
          {subtitle === null ? null : <p className="truncate text-xs text-ink-muted">{subtitle}</p>}
        </div>

        {/*
          Always rendered, never conditionally hidden. A close affordance that
          comes and goes is a close affordance the user cannot rely on.
        */}
        <button
          type="button"
          onClick={onClose}
          data-testid="detail-pane-close"
          className="shrink-0 rounded-control px-2 py-1 text-xs text-ink-muted hover:bg-sunken hover:text-ink"
        >
          Close
          <span className="sr-only"> the details panel (Escape)</span>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
    </aside>
  );
}
