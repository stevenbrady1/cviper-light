import { useEffect, type RefObject } from 'react';

/**
 * Keeps keyboard focus inside a modal surface while it is open, and hands it
 * back to whatever opened it when it closes (L-236, WCAG 2.4.3).
 *
 * ============================================================================
 * WHAT IT DOES, AND WHAT IT LEAVES TO THE CALLER
 * ============================================================================
 *   * Tab from the last control goes to the first; Shift+Tab from the first
 *     goes to the last. Focus that has somehow got behind the surface is
 *     pulled back in on the next Tab.
 *   * On close, focus returns to the element that had it when the surface
 *     opened — if that element is still in the page. A Delete button whose
 *     card was just deleted is gone, and focus is left alone rather than
 *     forced somewhere surprising.
 *   * It does NOT choose the first focus. Each caller already decides that on
 *     purpose (ConfirmDelete lands on "Keep it", never on Delete), so call
 *     this hook BEFORE the caller's own focus effect: effects run in order,
 *     and the opener must be read before focus moves.
 *
 * ============================================================================
 * A MODAL OWNS TAB, AS IT OWNS ESCAPE
 * ============================================================================
 * The phone detail pane traps focus too, and a dialog can open over it. Both
 * listen on the document, and the pane registered first. So a trap whose
 * container is not the open `aria-modal` dialog stands down — the same rule
 * `DetailPane` already uses for Escape.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return undefined;
    const opener = document.activeElement;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Tab') return;
      const container = ref.current;
      if (container === null) return;

      const modal = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (modal !== null && modal !== container) return;

      const nodes = focusables(container);
      const first = nodes.at(0);
      const last = nodes.at(-1);
      if (first === undefined || last === undefined) {
        event.preventDefault();
        return;
      }

      const current = document.activeElement;
      if (current === null || !container.contains(current)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
        opener.focus();
      }
    };
  }, [ref, active]);
}
