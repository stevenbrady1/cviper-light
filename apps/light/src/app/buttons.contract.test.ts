/**
 * A disabled button must LOOK disabled (L-315).
 *
 * `SECONDARY_BUTTON` used to change only its text colour and cursor when
 * disabled, keeping the white background and the border. So "Remove saved key"
 * with no key saved looked like something you could press. The grey of the text
 * alone is not enough to tell: it is two steps along the same ink scale.
 *
 * The test reads every export of `buttons.ts`, so a fifth style cannot arrive
 * without a disabled background.
 */
import { describe, expect, it } from 'vitest';

import * as buttons from './buttons';
import {
  DESTRUCTIVE_BUTTON,
  PRIMARY_BUTTON,
  QUIET_BUTTON,
  QUIET_DESTRUCTIVE_BUTTON,
  SECONDARY_BUTTON,
} from './buttons';
import { lightColours, type Rgb } from '../styles/themeTokens';

function classesOf(style: string): string[] {
  return style.split(/\s+/).filter((name) => name !== '');
}

/** The classes that apply in a state, such as `disabled` or `aria-disabled`. */
function inState(style: string, state: string): string[] {
  return classesOf(style).filter((name) => name.startsWith(`${state}:`));
}

/** The look a person sees on a button they can press, states aside. */
function enabledLook(style: string): string[] {
  return classesOf(style).filter(
    (name) => !name.startsWith('disabled:') && !name.startsWith('aria-disabled:'),
  );
}

/**
 * The problem with a style's disabled look, or null. A named token only:
 * `disabled:bg-transparent` declares a background and still paints nothing.
 */
function disabledBackgroundProblem(style: string): string | null {
  const backgrounds = inState(style, 'disabled').filter((name) => name.startsWith('disabled:bg-'));
  if (backgrounds.length === 0) return 'declares no disabled background';
  if (backgrounds.includes('disabled:bg-transparent')) return 'its disabled background is clear';
  return null;
}

const STYLES = Object.entries(buttons);

describe('every button style looks different when disabled (L-315)', () => {
  it('finds all five styles, so this contract cannot pass by reading nothing', () => {
    expect(STYLES.map(([name]) => name).sort()).toEqual([
      'DESTRUCTIVE_BUTTON',
      'PRIMARY_BUTTON',
      'QUIET_BUTTON',
      'QUIET_DESTRUCTIVE_BUTTON',
      'SECONDARY_BUTTON',
    ]);
  });

  it.each(STYLES)('%s declares a disabled background, not just a text colour', (_name, style) => {
    expect(disabledBackgroundProblem(style)).toBeNull();
  });

  it('negative: the check itself refuses a style that only greys its text', () => {
    expect(disabledBackgroundProblem('border bg-card disabled:text-ink-faint')).toBe(
      'declares no disabled background',
    );
    expect(disabledBackgroundProblem('hover:bg-sunken disabled:text-ink-faint')).toBe(
      'declares no disabled background',
    );
    expect(disabledBackgroundProblem('disabled:bg-transparent disabled:text-ink-faint')).toBe(
      'its disabled background is clear',
    );
  });

  it('a disabled secondary button changes both its background and its border', () => {
    expect(inState(SECONDARY_BUTTON, 'disabled')).toEqual(
      expect.arrayContaining(['disabled:bg-line', 'disabled:border-transparent']),
    );
  });

  it('all five styles use the same grey, so disabled means one thing in the app', () => {
    for (const [, style] of STYLES) {
      expect(inState(style, 'disabled')).toEqual(
        expect.arrayContaining(['disabled:bg-line', 'disabled:text-ink-faint']),
      );
    }
  });

  // Two screens switch a button off with `aria-disabled` rather than `disabled`,
  // so that it can keep the keyboard focus: "Add to rewrite" on Tailor, and the
  // rows of the interview stage editor while a save is running.
  it.each([
    ['SECONDARY_BUTTON', SECONDARY_BUTTON],
    ['QUIET_BUTTON', QUIET_BUTTON],
    ['QUIET_DESTRUCTIVE_BUTTON', QUIET_DESTRUCTIVE_BUTTON],
  ])('%s looks the same switched off with aria-disabled', (_name, style) => {
    expect(inState(style, 'aria-disabled')).toEqual(
      expect.arrayContaining(['aria-disabled:bg-line']),
    );
  });
});

describe('what L-315 must leave alone', () => {
  it('boundary: disabled PRIMARY_BUTTON is unchanged', () => {
    expect(inState(PRIMARY_BUTTON, 'disabled')).toEqual([
      'disabled:cursor-not-allowed',
      'disabled:bg-line',
      'disabled:text-ink-faint',
    ]);
    expect(inState(PRIMARY_BUTTON, 'aria-disabled')).toEqual([]);
  });

  it('boundary: disabled DESTRUCTIVE_BUTTON is unchanged', () => {
    expect(inState(DESTRUCTIVE_BUTTON, 'disabled')).toEqual([
      'disabled:cursor-not-allowed',
      'disabled:bg-line',
      'disabled:text-ink-faint',
    ]);
  });

  it('negative: the enabled secondary button keeps its current look', () => {
    expect(enabledLook(SECONDARY_BUTTON)).toEqual([
      'inline-flex',
      'items-center',
      'justify-center',
      'gap-1.5',
      'rounded-control',
      'px-3',
      'py-1.5',
      'font-medium',
      'min-h-11',
      'md:min-h-0',
      'border',
      'border-line',
      'bg-card',
      'text-ink',
      'hover:bg-sunken',
    ]);
  });

  it('negative: the enabled quiet button stays text-only, with no background at rest', () => {
    expect(enabledLook(QUIET_BUTTON).filter((name) => name.startsWith('bg-'))).toEqual([]);
    expect(enabledLook(QUIET_BUTTON).filter((name) => name.startsWith('border'))).toEqual([]);
  });
});

// --- Quiet buttons look pressable (L-458) ------------------------------------

const QUIET_STYLES = [
  ['QUIET_BUTTON', QUIET_BUTTON, 'text-blue'],
  ['QUIET_DESTRUCTIVE_BUTTON', QUIET_DESTRUCTIVE_BUTTON, 'text-danger'],
] as const;

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The words' contrast on a surface; 0 when the style names no resting `text-<token>`. */
function wordsContrast(style: string, surface: string): number {
  const words = classesOf(style).find((name) => /^text-[a-z-]+$/.test(name) && name !== 'text-xs');
  const colours = lightColours();
  const ink = words ? colours.get(words.slice('text-'.length)) : undefined;
  const behind = colours.get(surface);
  return ink && behind ? contrast(ink.rgb, behind.rgb) : 0;
}

describe('quiet buttons look pressable (L-458)', () => {
  it.each(QUIET_STYLES)(
    '%s has its words in %s, a hover patch and a pressed patch',
    (_n, style, words) => {
      expect(enabledLook(style)).toContain(words);
      expect(enabledLook(style)).toContain('hover:bg-sunken');
      expect(enabledLook(style)).toContain('active:bg-line');
    },
  );

  it('Delete is red words and Rename is blue words, never the other way round', () => {
    expect(classesOf(QUIET_DESTRUCTIVE_BUTTON)).not.toContain('text-blue');
    expect(classesOf(QUIET_BUTTON)).not.toContain('text-danger');
  });

  it.each(QUIET_STYLES)(
    'negative: %s never gains a fill, a border or data-primary',
    (_n, style) => {
      const blueFill = classesOf(style).filter((name) => /(^|:)(bg|border)-blue/.test(name));
      expect(blueFill).toEqual([]);
      expect(enabledLook(style).filter((name) => /^(bg|border)(-|$)/.test(name))).toEqual([]);
      expect(style).not.toContain('data-primary');
    },
  );

  it.each(QUIET_STYLES)('boundary: %s still looks disabled, not blue or red', (_n, style) => {
    expect(inState(style, 'disabled')).toEqual(
      expect.arrayContaining(['disabled:bg-line', 'disabled:text-ink-faint']),
    );
  });

  it.each(QUIET_STYLES)(
    'boundary: the words of %s clear AA (4.5:1) on every surface',
    (_n, style) => {
      for (const surface of ['card', 'canvas', 'sunken']) {
        expect(wordsContrast(style, surface)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('negative: the contrast check can fail (faint ink on sunken, and no words at all)', () => {
    expect(wordsContrast('text-ink-faint', 'sunken')).toBeLessThan(4.8);
    expect(wordsContrast('text-teal', 'sunken')).toBeLessThan(4.5);
    expect(wordsContrast('px-3', 'card')).toBe(0);
  });
});
