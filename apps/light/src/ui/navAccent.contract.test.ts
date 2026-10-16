/**
 * The navigation icons' accent (L-254): one token, the owner's colour, and
 * enough contrast where the icons are drawn.
 *
 * The icons draw their primary strokes in `currentColor`, which the text
 * contrast check already covers. The accent is the one stroke that is NOT the
 * text colour, so `contrast.contract.test.ts` cannot see it; this does. The nav
 * icons are drawn only on the navy rail and the navy phone bar.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const THEME = readFileSync(fileURLToPath(new URL('../styles/theme.css', import.meta.url)), 'utf8');

function token(name: string): string {
  const all = [
    ...THEME.matchAll(new RegExp(String.raw`--color-${name}:\s*(#[0-9a-fA-F]{6});`, 'g')),
  ];
  expect(all, `--color-${name}`).toHaveLength(1);
  return (all[0]?.[1] ?? '').toLowerCase();
}

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe('the nav icon accent', () => {
  it('is the owner’s colour, declared once', () => {
    expect(token('nav-accent')).toBe('#17a2b8');
  });

  it('clears 3:1 (WCAG 1.4.11, non-text) on the navy rail and phone bar', () => {
    expect(contrast(token('nav-accent'), token('navy'))).toBeGreaterThanOrEqual(3);
  });

  it('the contrast maths is right (black on white is 21:1)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
});
