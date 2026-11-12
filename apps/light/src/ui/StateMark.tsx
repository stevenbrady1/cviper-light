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
 * match the icons: the same 24-unit grid, a round stroke, and `currentColor`
 * set by SVG attribute (never a `fill-*`/`stroke-*` utility, which the
 * contrast contract cannot check).
 *
 * ============================================================================
 * SIZED TO READ BESIDE THEIR WORDS (L-370)
 * ============================================================================
 * The first drawings filled too little of the 1em box — the tick was 48% of
 * it tall, the cross 50% — so beside 13px text the cross was a 6px speck where
 * the typed one had been about 11px. Every mark now covers 60–73% of its box
 * top to bottom (the shared warning triangle 81%), between the height of a
 * lower-case x and a capital, and the line is 2.5 units, not the icons' 2: about
 * the stem of the medium-weight text the marks sit beside. The up, down and
 * back arrows are one triangle, turned. The box itself is still exactly 1em
 * and aligned as before, so no row grows. `StateMark.size.test.tsx` holds the
 * size; `e2e/contrast-webkit.spec.ts` measures the rows in a real browser.
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
  tick: <path d="m4.5 13.5 5 5 10-13" />,
  /** Needs a look. The `alert` icon's triangle. */
  warning: WARNING_TRIANGLE,
  /** Failed, missing. */
  cross: (
    <>
      <path d="m5.5 5.5 13 13" />
      <path d="M18.5 5.5 5.5 18.5" />
    </>
  ),
  /** Went up. A solid triangle, point up. */
  up: <path d="M12 4.5 19.5 17.5h-15z" fill="currentColor" />,
  /** Went down. A solid triangle, point down. */
  down: <path d="M12 19.5 4.5 6.5h15z" fill="currentColor" />,
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
  back: <path d="M5.5 12 18.5 4.5v15z" fill="currentColor" />,
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
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="block"
      >
        {MARKS[name]}
      </svg>
    </span>
  );
}
