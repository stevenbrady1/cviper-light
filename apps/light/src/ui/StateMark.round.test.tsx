// @vitest-environment jsdom
/**
 * L-464 — the empty ring is one size bigger.
 *
 * In a 12px Profile pill the ring (r 6, line 2.5) covered 60% of its 1em box,
 * about the size of a lower-case "o", so "○ About you" read as "o About you".
 * The owner chose to grow the ring only: r 7, about 69% of the box, between an
 * "o" and a capital. The filled dot and the struck-through ring keep their
 * size. The box stays 1em, so no row grows; `StateMark.size.test.tsx` still
 * holds every mark inside the 60–76% band.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { StateMark, type StateMarkName } from './StateMark';

afterEach(() => {
  cleanup();
});

const BOX = 24;

/** Inter's x-height, as a share of 1em: the height of a lower-case "o". */
const INTER_X_HEIGHT = 0.546;

function circleOf(name: StateMarkName): SVGCircleElement {
  cleanup();
  const { container } = render(<StateMark name={name} />);
  const circle = container.querySelector('circle');
  if (circle === null) throw new Error(`${name}: no circle`);
  return circle;
}

/** The ring's ink, top to bottom: its edge widened by half the line. */
function ringInk(): { share: number; top: number; bottom: number } {
  const circle = circleOf('ring');
  const half = Number(circle.ownerSVGElement?.getAttribute('stroke-width')) / 2;
  const r = Number(circle.getAttribute('r')) + half;
  const cy = Number(circle.getAttribute('cy'));
  return { share: (2 * r) / BOX, top: cy - r, bottom: cy + r };
}

describe('the empty ring is one size bigger (L-464)', () => {
  it('happy: the ring covers at least 65% of its box', () => {
    expect(ringInk().share).toBeGreaterThanOrEqual(0.65);
  });

  it('boundary: the ring stays at or under 76% of its box, and inside it', () => {
    const ink = ringInk();
    expect(ink.share).toBeLessThanOrEqual(0.76);
    expect(ink.top).toBeGreaterThanOrEqual(0);
    expect(ink.bottom).toBeLessThanOrEqual(BOX);
  });

  it('negative: the ring is clearly taller than a lower-case "o"', () => {
    expect(ringInk().share).toBeGreaterThan(INTER_X_HEIGHT + 0.1);
  });

  it('only the ring grows: the dot and the struck-through ring keep radius 6', () => {
    expect(circleOf('dot').getAttribute('r')).toBe('6');
    expect(circleOf('skipped').getAttribute('r')).toBe('6');
    expect(circleOf('ring').getAttribute('r')).toBe('7');
  });
});
