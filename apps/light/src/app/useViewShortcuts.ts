import { useEffect, type Dispatch, type SetStateAction } from 'react';

import { viewForShortcut, type ViewId } from './views';

/**
 * `Ctrl+1` to `Ctrl+5`: see KEYBOARD at the top of `App.tsx`.
 *
 * Moved word for word out of `App` (L-373). Called where its effect was, so
 * it still runs in the same order among the shell's others.
 */
export function useViewShortcuts(setActiveView: Dispatch<SetStateAction<ViewId>>): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // Ctrl, and only Ctrl. `Ctrl+Alt+2` is AltGr on a good many European
      // keyboard layouts and types a character; stealing it would make the app
      // impossible to type in.
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;

      const digit = Number(event.key);
      if (!Number.isInteger(digit)) return;

      const target = viewForShortcut(digit);
      if (target === null) return;

      event.preventDefault();
      setActiveView(target);
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
