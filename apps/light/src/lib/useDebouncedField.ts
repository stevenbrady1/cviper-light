import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A text field that saves itself shortly after the user stops typing.
 *
 * ============================================================================
 * WHY AUTOSAVE AND NOT A SAVE BUTTON
 * ============================================================================
 * The detail pane exists so the user can change one thing and move on. A Save
 * button would put an extra click between every note and the next card, and —
 * worse — would make losing work possible: click another card with unsaved
 * text and it is gone, with nothing to say so.
 *
 * ============================================================================
 * THE PART EVERYONE FORGETS: THE FLUSH
 * ============================================================================
 * A naive debounce loses the last thing you typed. Type a note, click straight
 * onto another card, and the pending timer is cleared by React's cleanup before
 * it ever fires — the text is simply gone, silently, which is the worst way for
 * an app to lose a user's work.
 *
 * There are TWO answers here, and both are needed:
 *
 *   * `flush`, wired to the field's `onBlur`. Clicking anything else blurs the
 *     field first, so the save lands before the selection changes.
 *   * A commit on UNMOUNT. Blur is not guaranteed — a keyboard shortcut, a
 *     programmatic selection change, or a field that was never focused at all
 *     can all replace the pane without any blur ever firing. Only the unmount
 *     path catches those, and it is the one that turned up as a real failing
 *     test rather than as a theory.
 *
 * Both are safe to call when nothing has changed: they compare against what was
 * last committed and do nothing if the two match.
 */

export interface DebouncedField {
  /** What the input shows. */
  readonly draft: string;
  /** Call from `onChange`. */
  readonly setDraft: (next: string) => void;
  /** Call from `onBlur`, or anywhere the pending value must land NOW. */
  readonly flush: () => void;
}

export function useDebouncedField(
  initial: string,
  commit: (value: string) => void,
  delayMs: number,
): DebouncedField {
  const [draft, setDraft] = useState(initial);

  // The latest `commit` without making it a dependency: a caller passing an
  // inline arrow — which is every caller — would otherwise restart the timer on
  // every render and the save would never fire.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const lastCommitted = useRef(initial);

  // The current draft, readable from a cleanup that runs after the last render.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    // Runs ONCE, on unmount. An empty dependency list is what makes that true —
    // with `draft` in it, this would "unmount-flush" on every keystroke and the
    // debounce would do nothing at all.
    return () => {
      if (draftRef.current === lastCommitted.current) return;
      lastCommitted.current = draftRef.current;
      commitRef.current(draftRef.current);
    };
  }, []);

  useEffect(() => {
    if (draft === lastCommitted.current) return;

    const timer = setTimeout(() => {
      lastCommitted.current = draft;
      commitRef.current(draft);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [draft, delayMs]);

  const flush = useCallback(() => {
    if (draft === lastCommitted.current) return;
    lastCommitted.current = draft;
    commitRef.current(draft);
  }, [draft]);

  return { draft, setDraft, flush };
}
