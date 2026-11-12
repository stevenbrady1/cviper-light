// @vitest-environment jsdom
/**
 * L-370 — a drawn mark is big enough to read beside its words.
 *
 * The marks replaced typed characters (L-354, L-360, L-362), and the first
 * drawings filled too little of their 1em box: the tick was 48% of it tall,
 * the cross 50%, the arrows 52%. Beside 13px text in the ATS table that is a
 * 6px cross — the typed one had been about 11px. The owner chose (11 Nov 2026)
 * shapes redrawn to fill more of the box, with a slightly heavier line.
 *
 * jsdom draws nothing, so the size is worked out from the drawing's own
 * numbers: every point a path visits and every circle's edge, widened by half
 * the line width (the caps and joins are round, so the line reaches exactly
 * that far past a point). The rendered check — a row is no taller with a mark
 * than without — is in `e2e/contrast-webkit.spec.ts`.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { STATE_MARK_NAMES, StateMark, type StateMarkName } from './StateMark';

afterEach(() => {
  cleanup();
});

/** The grid every mark is drawn on. */
const BOX = 24;

/** The least share of the box a mark's drawing must cover, top to bottom. */
const MIN_HEIGHT_SHARE = 0.6;

/**
 * The most: about the height of a capital letter (Inter's is 0.727em). The
 * warning is exempt — it is the `alert` icon's triangle, shared by design, and
 * was already the right size.
 */
const MAX_HEIGHT_SHARE = 0.76;

/** The line width the owner chose with the drawings. */
const STROKE_WIDTH = '2.5';

interface Bounds {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** Every point an SVG path visits. Handles the commands the marks use: M L H V Z, either case. */
export function pathPoints(d: string): [number, number][] {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const points: [number, number][] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let command = '';
  let index = 0;
  const next = (): number => {
    const token = tokens[index];
    index += 1;
    const value = Number(token);
    if (token === undefined || Number.isNaN(value)) throw new Error(`bad path: ${d}`);
    return value;
  };
  while (index < tokens.length) {
    const token = tokens[index] ?? '';
    if (/[A-Za-z]/.test(token)) {
      command = token;
      index += 1;
      if (command === 'Z' || command === 'z') {
        x = startX;
        y = startY;
        continue;
      }
    }
    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case 'M':
      case 'L': {
        const nx = next();
        const ny = next();
        x = relative ? x + nx : nx;
        y = relative ? y + ny : ny;
        if (command.toUpperCase() === 'M') {
          startX = x;
          startY = y;
          // Pairs after a moveto are linetos, in the same case.
          command = relative ? 'l' : 'L';
        }
        break;
      }
      case 'H': {
        const nx = next();
        x = relative ? x + nx : nx;
        break;
      }
      case 'V': {
        const ny = next();
        y = relative ? y + ny : ny;
        break;
      }
      default:
        throw new Error(`path command ${command} is not handled: ${d}`);
    }
    points.push([x, y]);
  }
  return points;
}

/** The ink a mark puts down, in grid units: its shapes widened by half the line width. */
function inkBounds(svg: SVGSVGElement): Bounds {
  const half = Number(svg.getAttribute('stroke-width')) / 2;
  const boxes: Bounds[] = [];
  for (const shape of svg.querySelectorAll('path, circle')) {
    const pad = shape.getAttribute('stroke') === 'none' ? 0 : half;
    if (shape.tagName.toLowerCase() === 'circle') {
      const cx = Number(shape.getAttribute('cx'));
      const cy = Number(shape.getAttribute('cy'));
      const r = Number(shape.getAttribute('r')) + pad;
      boxes.push({ top: cy - r, bottom: cy + r, left: cx - r, right: cx + r });
    } else {
      const points = pathPoints(shape.getAttribute('d') ?? '');
      const xs = points.map(([px]) => px);
      const ys = points.map(([, py]) => py);
      boxes.push({
        top: Math.min(...ys) - pad,
        bottom: Math.max(...ys) + pad,
        left: Math.min(...xs) - pad,
        right: Math.max(...xs) + pad,
      });
    }
  }
  if (boxes.length === 0) throw new Error('a mark with no shape');
  return {
    top: Math.min(...boxes.map((b) => b.top)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
    left: Math.min(...boxes.map((b) => b.left)),
    right: Math.max(...boxes.map((b) => b.right)),
  };
}

function svgOf(name: StateMarkName): SVGSVGElement {
  cleanup();
  const { container } = render(<StateMark name={name} />);
  const svg = container.querySelector('svg');
  if (svg === null) throw new Error(`${name}: no svg`);
  return svg;
}

/** The share of the box the mark's ink covers, top to bottom, to 3 places. */
function heightShare(name: StateMarkName): number {
  const ink = inkBounds(svgOf(name));
  return Math.round(((ink.bottom - ink.top) / BOX) * 1000) / 1000;
}

describe('a drawn mark is big enough to read beside its words (L-370)', () => {
  it(`every mark covers at least ${String(MIN_HEIGHT_SHARE * 100)}% of its box, top to bottom`, () => {
    const small = STATE_MARK_NAMES.map((name) => [name, heightShare(name)] as const).filter(
      ([, share]) => share < MIN_HEIGHT_SHARE,
    );
    expect(small).toEqual([]);
  });

  it(`no mark but the shared warning triangle is taller than ${String(MAX_HEIGHT_SHARE * 100)}% of its box`, () => {
    const tall = STATE_MARK_NAMES.filter((name) => name !== 'warning')
      .map((name) => [name, heightShare(name)] as const)
      .filter(([, share]) => share > MAX_HEIGHT_SHARE);
    expect(tall).toEqual([]);
  });

  it('every mark stays inside its box, so nothing is cut off', () => {
    const outside = STATE_MARK_NAMES.filter((name) => {
      const ink = inkBounds(svgOf(name));
      return ink.top < 0 || ink.left < 0 || ink.bottom > BOX || ink.right > BOX;
    });
    expect(outside).toEqual([]);
  });

  it(`every mark is drawn with the ${STROKE_WIDTH} line, on the 24-unit grid`, () => {
    for (const name of STATE_MARK_NAMES) {
      const svg = svgOf(name);
      expect(svg.getAttribute('stroke-width'), name).toBe(STROKE_WIDTH);
      expect(svg.getAttribute('viewBox'), name).toBe(`0 0 ${String(BOX)} ${String(BOX)}`);
    }
  });

  // The measuring itself, on drawings whose size is known.
  describe('the measure', () => {
    it('happy: an absolute path visits each point it names', () => {
      expect(pathPoints('M5 12.5 9.5 17 19 7.5')).toEqual([
        [5, 12.5],
        [9.5, 17],
        [19, 7.5],
      ]);
    });

    it('relative moves, H, V and a closing z are followed', () => {
      expect(pathPoints('m4 4 2 2h3v-1z')).toEqual([
        [4, 4],
        [6, 6],
        [9, 6],
        [9, 5],
      ]);
    });

    it('boundary: numbers run together with a sign or a leading dot', () => {
      expect(pathPoints('M12 17h.01')).toEqual([
        [12, 17],
        [12.01, 17],
      ]);
      expect(pathPoints('m4.5 13.5 5 5 10-13')).toEqual([
        [4.5, 13.5],
        [9.5, 18.5],
        [19.5, 5.5],
      ]);
    });

    it('negative: a curve is refused rather than measured wrongly', () => {
      expect(() => pathPoints('M2 2c1 1 2 2 3 3')).toThrow(/not handled/);
    });
  });
});
