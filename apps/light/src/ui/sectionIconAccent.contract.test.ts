/**
 * The Settings section icons' accent (L-256): its own token, declared once,
 * and its contrast against the tiles it is drawn on — REPORTED, because the
 * owner's colour (#17a2b8) is below 3:1 on those light tiles and the owner
 * chooses whether to darken it.
 *
 * The icons sit in `SectionHeading`'s small tile: `bg-navy/10` (or
 * `bg-danger/10` for Delete everything) over the page canvas or a card. The
 * accent is the one stroke the text-contrast check cannot see, so it is
 * measured here against each of those composited backgrounds.
 *
 * What fails: the token removed, or declared twice. What does NOT fail yet:
 * the ratio itself, which is printed for the owner. Darker shades of the same
 * hue that clear the bars on every tile: #148da0 (3:1), #106f7e (4.5:1).
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

  it('reports its contrast on every tile it is drawn on (owner to decide on darkening)', () => {
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
    for (const background of Object.values(tiles)) {
      // A real number, not NaN: the guard read real colours.
      expect(contrast(accent, background)).toBeGreaterThan(1);
    }
  });

  it('the maths is right (black on white 21:1; 10% navy over white)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(over('#0f2044', 0.1, '#ffffff')).toBe('#e7e9ec');
  });
});
