import { useEffect, type ReactNode } from 'react';

/**
 * The right-hand detail pane. 380px, persistent, NOT a modal — and on a phone,
 * the whole screen, because 380px IS the whole screen (L-81).
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
 * Listened for on `document`, and skipped in two cases:
 *
 *   * something nearer the event already called `preventDefault()`, and
 *   * A MODAL DIALOG IS OPEN.
 *
 * The second is not belt-and-braces. Both listeners are on `document`, so which
 * one runs first is decided by REGISTRATION ORDER — and the pane is always
 * mounted before the dialog inside it, so the pane's handler wins the race and
 * `preventDefault` arrives too late to stop it. One Escape would then cancel
 * the delete confirmation AND throw away the selection behind it, which is a
 * punishment for changing your mind.
 *
 * Asking whether a modal is open is order-independent, and it states the actual
 * rule: while a modal is up, it owns Escape.
 *
 * ============================================================================
 * THE TITLE IS CLIPPED. THE SUBTITLE WRAPS. THAT ASYMMETRY IS THE POINT.
 * ============================================================================
 * The pane is 380px, which leaves the header's text block 287px. The title is
 * a VALUE — usually a job title — and clipping a long one to one line is right:
 * the header stays one height whatever is selected, and the full text is in the
 * form below.
 *
 * The subtitle is PROSE. Every caller passes a sentence, and the longest of
 * them — "Nothing has been saved yet. Correct anything that is wrong, then
 * save." — measures 402px in this font. `truncate` was on it, so what the user
 * actually read was "Nothing has been saved yet. Correct anything th…", losing
 * the entire confirm-before-save promise of the paste flow. Every unit test
 * passed the whole time: the string is in the DOM, and jsdom does no layout.
 *
 * So it wraps, and the header grows to fit — 62px to 78px for a two-line
 * subtitle, with `items-start` keeping Close pinned to the top of it.
 *
 * `break-words` is not decoration. Without it the ONE subtitle that is a value
 * rather than a sentence — the CV filename on Past checks — spills straight out
 * of the pane the moment it has no spaces in it (`Steven_Brady_Senior_…docx`
 * measured 530px in a 287px box and put a horizontal scrollbar on the window).
 * Removing a clip without it trades a hidden sentence for a broken layout.
 *
 * `styles/prose-clipping.contract.test.ts` holds the clip off this slot. It
 * checks the CLASS, not the width — no test in a jsdom process can measure a
 * rendered pixel.
 */

interface DetailPaneProps {
  /** The heading. Names the thing being edited, not the action. */
  readonly title: string;
  /** A sentence under the heading, or `null`. Wraps; see the note above. */
  readonly subtitle?: string | null;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function DetailPane({ title, subtitle = null, onClose, children }: DetailPaneProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      // Something closer to the event has already decided what Escape means.
      if (event.defaultPrevented) return;
      // A modal is up, and a modal owns Escape. See the note above for why
      // `defaultPrevented` alone does not cover this.
      if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) return;

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
      className={[
        'flex shrink-0 flex-col border-line bg-card',
        // Phone: over everything, edge to edge, above the bottom bar. Close is
        // in the header, always rendered, so there is always a way back.
        'fixed inset-0 z-40 w-full pt-safe pb-safe',
        // Desktop: the pane it always was, beside the view.
        'md:static md:inset-auto md:z-auto md:w-[380px] md:border-l md:pt-0 md:pb-0',
      ].join(' ')}
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-ink">{title}</h2>
          {subtitle === null ? null : (
            <p data-testid="detail-pane-subtitle" className="break-words text-xs text-ink-muted">
              {subtitle}
            </p>
          )}
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
