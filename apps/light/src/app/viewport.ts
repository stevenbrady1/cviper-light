import { useSyncExternalStore } from 'react';

/**
 * Is this a phone-sized screen or a desktop window?
 *
 * ============================================================================
 * ONE BREAKPOINT, THE SAME ONE TAILWIND USES
 * ============================================================================
 * `md:` in Tailwind 4 is `48rem` (768px). The shell decides in JavaScript
 * which navigation to mount — a rail or a bottom bar — because the two carry
 * the same `data-testid`s and must never be in the DOM together; every other
 * layout difference is plain `md:` CSS. Both halves read the same number, so
 * the bar and the CSS agree about where a phone stops.
 *
 * ============================================================================
 * NO `matchMedia`, NO PHONE
 * ============================================================================
 * jsdom has no `matchMedia`, and neither did the app before L-81 have a phone
 * layout: a test that stubs nothing gets the desktop shell it always got. A
 * real WebView always has it.
 */

export type ViewportClass = 'narrow' | 'wide';

/** Wide from here up. Matches Tailwind's `md:`. */
export const WIDE_QUERY = '(min-width: 48rem)';

function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(WIDE_QUERY);
}

function read(): ViewportClass {
  const list = query();
  if (list === null) return 'wide';
  return list.matches ? 'wide' : 'narrow';
}

function watch(onChange: () => void): () => void {
  const list = query();
  if (list === null) return () => undefined;
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

/** `'narrow'` on a phone, `'wide'` on a desktop window — and live across a rotation. */
export function useViewportClass(): ViewportClass {
  return useSyncExternalStore(watch, read, () => 'wide');
}
