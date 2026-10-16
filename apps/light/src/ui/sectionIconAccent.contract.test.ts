/**
 * The Settings section icons' accent (L-256): its own token, declared once,
 * and at least 3:1 (WCAG 1.4.11) against every tile it is drawn on.
 *
 * The icons sit in `SectionHeading`'s small tile: `bg-navy/10` (or
 * `bg-danger/10` for Delete everything) over the page canvas or a card. The
 * accent is the one stroke the text-contrast check cannot see, so it is
 * measured here against each of those composited backgrounds. The owner's
 * first choice, #17a2b8, measured 2.35-2.62:1; on 2026-10-16 the owner chose
 * #148da0, the same hue darkened to clear 3:1 on all four.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const THEME = readFileSync(fileURLToPath(new URL('../styles/theme.css', import.meta.url)), 'utf8');

function tokens(name: string): string[] {
  return [
    ...THEME.matchAll(new RegExp(String.raw`--color-${name}:\s*(#[0-9a-fA-F]{6});`, 'g')),
  ].map((match) => (match[1] ?? '').toLowerCase());
}

function token(name: string): string {
  const all = tokens(name);
  expect(all, `--color-${name}`).toHaveLength(1);
  return all[0] ?? '';
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

/** `top` at `alpha` over `under`, as Tailwind's `bg-x/10` composites. */
export function over(top: string, alpha: number, under: string): string {
  const [a, b] = [channels(top), channels(under)];
  return `#${a
    .map((value, i) =>
      Math.round(value * alpha + (b[i] ?? 0) * (1 - alpha))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function luminance(hex: string): number {
  return channels(hex)
    .map((value) => value / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((sum, value, i) => sum + value * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe('the Settings section icon accent', () => {
  it('is declared once, separately from the nav icons’ accent', () => {
    expect(token('section-icon-accent')).toMatch(/^#[0-9a-f]{6}$/);
    expect(tokens('nav-accent')).toHaveLength(1);
  });

  it('clears 3:1 (WCAG 1.4.11) on every tile it is drawn on', () => {
    const accent = token('section-icon-accent');
    const canvas = token('canvas');
    const card = token('card');
    const tiles = {
      'navy/10 on canvas': over(token('navy'), 0.1, canvas),
      'navy/10 on card': over(token('navy'), 0.1, card),
      'danger/10 on canvas': over(token('danger'), 0.1, canvas),
      'danger/10 on card': over(token('danger'), 0.1, card),
    };
    const report = Object.entries(tiles).map(
      ([name, background]) => `${name} ${background}: ${contrast(accent, background).toFixed(2)}:1`,
    );
    console.info(`section icon accent ${accent} — ${report.join('; ')}`);
    for (const [name, background] of Object.entries(tiles)) {
      // WCAG 1.4.11: a meaningful mark needs 3:1 against what is behind it.
      expect(contrast(accent, background), name).toBeGreaterThanOrEqual(3);
    }
  });

  it('the tiles are the real ones', () => {
    const canvas = token('canvas');
    const card = token('card');
    expect([
      over(token('navy'), 0.1, canvas),
      over(token('navy'), 0.1, card),
      over(token('danger'), 0.1, canvas),
      over(token('danger'), 0.1, card),
    ]).toEqual(['#e0e2e8', '#e7e9ec', '#f0e4e5', '#f8ebea']);
  });

  it('the maths is right (black on white 21:1; 10% navy over white)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(over('#0f2044', 0.1, '#ffffff')).toBe('#e7e9ec');
  });
});
