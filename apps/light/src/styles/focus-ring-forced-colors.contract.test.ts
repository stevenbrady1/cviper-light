/**
 * The focus ring has to survive Windows High Contrast (forced colours).
 *
 * The ring is drawn with `box-shadow`, and forced-colours mode removes every
 * box-shadow. With `outline: none` beside it, a keyboard user in High
 * Contrast saw no focus at all (WCAG 2.4.7) — on the platform the Store build
 * ships to. A TRANSPARENT outline is invisible normally, and forced-colours
 * mode repaints it in the system highlight colour, so the ring comes back
 * exactly when the shadow goes.
 *
 * This reads theme.css as text because no test engine here can render in
 * forced-colours mode; the rule it holds is small enough to read reliably.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const THEME = join(dirname(fileURLToPath(import.meta.url)), 'theme.css');

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of every top-level rule whose selector is exactly `:focus-visible`. */
function focusRingDeclarations(cssSource: string): Map<string, string>[] {
  const css = stripComments(cssSource);
  const rules: Map<string, string>[] = [];
  const pattern = /(^|[}\s]):focus-visible\s*\{([^}]*)\}/g;
  for (const match of css.matchAll(pattern)) {
    const body = match[2] ?? '';
    const declarations = new Map<string, string>();
    for (const part of body.split(';')) {
      const colon = part.indexOf(':');
      if (colon === -1) continue;
      const name = part.slice(0, colon).trim().toLowerCase();
      const value = part
        .slice(colon + 1)
        .trim()
        .replace(/\s+/g, ' ');
      if (name !== '') declarations.set(name, value);
    }
    rules.push(declarations);
  }
  return rules;
}

/** True when the outline would still paint once forced colours strip shadows. */
function survivesForcedColors(declarations: Map<string, string>): boolean {
  const outline = declarations.get('outline');
  const style = declarations.get('outline-style');
  if (style !== undefined) return !/^(none|hidden)$/i.test(style);
  if (outline === undefined) return false;
  const tokens = outline.toLowerCase().split(' ');
  if (tokens.includes('none') || tokens.includes('hidden') || tokens.includes('0')) return false;
  return tokens.some((t) =>
    ['solid', 'dashed', 'dotted', 'double', 'auto', 'groove', 'ridge'].includes(t),
  );
}

describe('the focus ring survives forced colours', () => {
  it('the global :focus-visible rule keeps a real outline beside its shadow', () => {
    const rules = focusRingDeclarations(readFileSync(THEME, 'utf8'));
    expect(rules).toHaveLength(1);
    const [ring] = rules;
    expect(ring && survivesForcedColors(ring)).toBe(true);
  });

  it('and offsets it, so the outline does not sit on top of the control border', () => {
    const [ring] = focusRingDeclarations(readFileSync(THEME, 'utf8'));
    expect(ring?.get('outline-offset')).toMatch(/^[1-9]\d*px$/);
  });
});

describe('the guard itself', () => {
  it('negative: catches `outline: none`, the shape that shipped', () => {
    const [ring] = focusRingDeclarations(
      ':focus-visible { outline: none; box-shadow: 0 0 0 2px blue; }',
    );
    expect(ring && survivesForcedColors(ring)).toBe(false);
  });

  it('negative: catches a zero-width outline', () => {
    const [ring] = focusRingDeclarations(':focus-visible { outline: 0 solid transparent; }');
    expect(ring && survivesForcedColors(ring)).toBe(false);
  });

  it('negative: catches a missing outline', () => {
    const [ring] = focusRingDeclarations(':focus-visible { box-shadow: 0 0 0 2px blue; }');
    expect(ring && survivesForcedColors(ring)).toBe(false);
  });

  it('boundary: a commented-out ring is not read', () => {
    expect(focusRingDeclarations('/* :focus-visible { outline: 2px solid red; } */')).toEqual([]);
  });

  it('happy: a transparent 2px outline passes', () => {
    const [ring] = focusRingDeclarations(
      ':focus-visible { outline: 2px solid transparent; outline-offset: 2px; }',
    );
    expect(ring && survivesForcedColors(ring)).toBe(true);
  });
});
