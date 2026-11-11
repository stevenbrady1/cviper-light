import { type ReactNode } from 'react';

import { WARNING_TRIANGLE } from './Icon';

/**
 * The marks that carry a meaning: a tick, a warning, a step's dot (L-354).
 *
 * ============================================================================
 * WHY DRAWN, AND WHY NOT MORE ICONS
 * ============================================================================
 * These used to be typed characters — ✓ ⚠ ✗ ▲ ▼ ⊘ ● ○ ◀ — which render in
 * whatever fallback font the machine happens to pick, so their size, weight
 * and even their shape changed from one computer to the next. Drawn, they
 * match the icons: the same 24-unit grid, the same 2-unit round stroke, and
 * `currentColor` set by SVG attribute (never a `fill-*`/`stroke-*` utility,
 * which the contrast contract cannot check).
 *
 * They are a component of their own, not nine more `Icon` names, because an
 * icon is decorative and a state mark is not. The L-215 check ("no symbol
 * without its meaning", `app/hints.contract.test.tsx`) finds a mark in source
 * by the one word `StateMark` and on screen by the one attribute `data-mark`,
 * and fails any mark that is not explained by a `Hint`.
 *
 * A mark is hidden from assistive tech and never takes focus: the `Hint` that
 * wraps it is the focus stop, and its words are what a screen reader hears.
 *
 * ============================================================================
 * NINE SHAPES, EACH DIFFERENT WITHOUT COLOUR
 * ============================================================================
 * Done (tick), current (dot), to do (ring) and skipped differ by shape, so
 * they read the same to somebody who cannot tell the colours apart.
 * `ui.test.tsx` fails if any two marks draw the same thing.
 */

const MARKS = {
  /** Done, passed. */
  tick: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  /** Needs a look. The `alert` icon's triangle. */
  warning: WARNING_TRIANGLE,
  /** Failed, missing. */
  cross: (
    <>
      <path d="m7 7 10 10" />
      <path d="M17 7 7 17" />
    </>
  ),
  /** Went up. A solid triangle, point up. */
  up: <path d="M12 6.5 18.5 17h-13z" fill="currentColor" />,
  /** Went down. A solid triangle, point down. */
  down: <path d="M12 17.5 5.5 7h13z" fill="currentColor" />,
  /** Skipped: a ring struck through. */
  skipped: (
    <>
      <circle cx="12" cy="12" r="6" />
      <path d="m7.8 16.2 8.4-8.4" />
    </>
  ),
  /** The current step: a solid disc. */
  dot: <circle cx="12" cy="12" r="6" fill="currentColor" />,
  /** A step still to do: an empty ring, the same size as the disc. */
  ring: <circle cx="12" cy="12" r="6" />,
  /** Back to an earlier step. A solid triangle, point left. */
  back: <path d="M6.5 12 17 5.5v13z" fill="currentColor" />,
} satisfies Record<string, ReactNode>;

export type StateMarkName = keyof typeof MARKS;

/** Every mark there is. Exported so the tests can prove each one is distinct. */
export const STATE_MARK_NAMES = Object.keys(MARKS) as readonly StateMarkName[];

export interface StateMarkProps {
  readonly name: StateMarkName;
}

/** One mark, 1em square, in the colour of the text around it. Wrap it in a `Hint`. */
export function StateMark({ name }: StateMarkProps) {
  return (
    <span
      data-mark={name}
      aria-hidden="true"
      className="inline-block shrink-0 align-[-0.125em] leading-none"
    >
      <svg
        focusable="false"
        width="1em"
        height="1em"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="block"
      >
        {MARKS[name]}
      </svg>
    </span>
  );
}
