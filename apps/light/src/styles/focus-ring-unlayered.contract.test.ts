/**
 * The focus ring cannot be painted over by a utility class (L-235, #244).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * The global `:focus-visible` ring is a `box-shadow`. It sat inside
 * `@layer base`, and Tailwind 4 emits utilities such as `shadow-raised` in
 * `@layer utilities`, which always beats `base` whatever the specificity. So
 * a focusable element with its own shadow lost the ring entirely — and the
 * tracker card, on the app's default view, is exactly that (WCAG 2.4.7,
 * 2.4.11). The launch audit (9 Oct 2026) found it.
 *
 * jsdom applies no cascade layers and no Tailwind, so a computed-style test
 * would pass whatever the CSS said. The cascade rule itself is the fact to
 * hold: an UNLAYERED rule beats every layered one. So the ring must stay
 * outside every `@layer` block, and there must be exactly one of it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const THEME = join(dirname(fileURLToPath(import.meta.url)), 'theme.css');

/** The innermost enclosing `@layer`, or `null` when none encloses it. */
function nearestLayer(stack: readonly (string | null)[]): string | null {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const entry = stack.at(i);
    if (entry !== null && entry !== undefined) return entry;
  }
  return null;
}

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The `@layer` each `:focus-visible` rule sits in, or `null` when unlayered. */
function focusRingLayers(cssSource: string): (string | null)[] {
  const css = stripComments(cssSource);
  const found: (string | null)[] = [];
  const stack: (string | null)[] = [];
  let pendingLayer: string | null | undefined;
  let token = '';
  for (let i = 0; i < css.length; i += 1) {
    const ch = css.charAt(i);
    if (ch === '{') {
      const prelude = token.trim();
      const layer = /^@layer\s+([\w-]+)/.exec(prelude);
      pendingLayer = layer ? (layer[1] ?? null) : undefined;
      if (/(^|,|\s):focus-visible\s*$/.test(prelude) && !prelude.startsWith('@')) {
        found.push(nearestLayer(stack));
      }
      stack.push(pendingLayer === undefined ? null : pendingLayer);
      token = '';
    } else if (ch === '}') {
      stack.pop();
      token = '';
    } else if (ch === ';') {
      token = '';
    } else {
      token += ch;
    }
  }
  return found;
}

describe('the focus ring is unlayered, so no utility can paint over it', () => {
  it('theme.css has exactly one :focus-visible rule, outside every @layer', () => {
    expect(focusRingLayers(readFileSync(THEME, 'utf8'))).toEqual([null]);
  });
});

describe('the guard itself', () => {
  it('negative: catches the ring inside @layer base, the shape that shipped', () => {
    const shipped = '@layer base { :focus-visible { box-shadow: 0 0 0 2px blue; } }';
    expect(focusRingLayers(shipped)).toEqual(['base']);
  });

  it('negative: catches it nested deeper inside a layer', () => {
    const nested = '@layer base { @media (min-width: 1px) { :focus-visible { outline: none; } } }';
    expect(focusRingLayers(nested)).toEqual(['base']);
  });

  it('boundary: a commented-out ring neither trips nor satisfies the guard', () => {
    expect(focusRingLayers('/* :focus-visible { outline: none; } */')).toEqual([]);
  });

  it('happy: an unlayered ring after a layer reads as unlayered', () => {
    const fixed = '@layer base { body { margin: 0; } } :focus-visible { outline: none; }';
    expect(focusRingLayers(fixed)).toEqual([null]);
  });
});
