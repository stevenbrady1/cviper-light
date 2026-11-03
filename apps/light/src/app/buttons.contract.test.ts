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
import { DESTRUCTIVE_BUTTON, PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON } from './buttons';

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
  it('finds all four styles, so this contract cannot pass by reading nothing', () => {
    expect(STYLES.map(([name]) => name).sort()).toEqual([
      'DESTRUCTIVE_BUTTON',
      'PRIMARY_BUTTON',
      'QUIET_BUTTON',
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

  it('all four styles use the same grey, so disabled means one thing in the app', () => {
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
