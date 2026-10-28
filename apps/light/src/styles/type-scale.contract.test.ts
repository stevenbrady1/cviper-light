/**
 * L-241 — text people can read.
 *
 * The launch audit (9 Oct 2026) measured a 14px body, the small style at 12px
 * on 201 elements, and 10–11px in 21 more — for job seekers who are mostly
 * reading on a laptop at arm's length. The owner chose (28 Oct 2026):
 *
 *   * body text 16px, the web's default and the easiest size to read;
 *   * the small style (`text-xs`) 13px;
 *   * nothing, anywhere, below 11px.
 *
 * Sizes come from two places, and this reads both: the theme (the body rule
 * and any `--text-*` token) and fixed sizes written into a class
 * (`text-[10px]`). A forbid-list (LESSON-033): it does not know the files,
 * it finds every fixed size there is.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, shippedText, walk } from '../lib/repo-scan';

export const FLOOR_PX = 11;
export const BODY_PX = 16;
export const SMALL_PX = 13;

const THEME = readFileSync(join(REPO_ROOT, 'apps/light/src/styles/theme.css'), 'utf8');

/** `text-[10px]`, `text-[0.6rem]` → the size in pixels, one per class. */
export function fixedSizesIn(source: string): number[] {
  return [...source.matchAll(/\btext-\[(\d+(?:\.\d+)?)(px|rem)\]/g)].map((match) =>
    match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1]),
  );
}

/** `--text-xs: 0.8125rem;` → `{ xs: 13 }`. Line-height and other sub-keys are not sizes. */
export function themeSizes(css: string): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const match of css.matchAll(/--text-([a-z0-9]+)\s*:\s*(\d+(?:\.\d+)?)(px|rem)\s*;/g)) {
    sizes[match[1] ?? ''] = match[3] === 'rem' ? Number(match[2]) * 16 : Number(match[2]);
  }
  return sizes;
}

/** The `font-size` on the `body` rule, in pixels, or `null`. */
export function bodySize(css: string): number | null {
  const rule = /(?:^|\n)\s*body\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const size = /font-size\s*:\s*(\d+(?:\.\d+)?)(px|rem)/.exec(rule);
  if (size === null) return null;
  return size[2] === 'rem' ? Number(size[1]) * 16 : Number(size[1]);
}

describe('the type scale (L-241)', () => {
  it(`body text is ${BODY_PX}px`, () => {
    expect(bodySize(THEME)).toBe(BODY_PX);
  });

  it(`the small style, text-xs, is ${SMALL_PX}px`, () => {
    expect(themeSizes(THEME)['xs']).toBe(SMALL_PX);
  });

  it(`no size token in the theme is below ${FLOOR_PX}px`, () => {
    const low = Object.entries(themeSizes(THEME)).filter(([, px]) => px < FLOOR_PX);
    expect(low).toEqual([]);
  });

  it(`no shipped component writes a fixed size below ${FLOOR_PX}px`, () => {
    const files = [join(REPO_ROOT, 'apps/light/src'), join(REPO_ROOT, 'packages/ui/src')].flatMap(
      (directory) => walk(directory, { extensions: ['.tsx'] }),
    );
    expect(files.length).toBeGreaterThan(50);
    const offences = files.flatMap((file) =>
      fixedSizesIn(shippedText(file))
        .filter((px) => px < FLOOR_PX)
        .map((px) => `${displayPath(file)}: ${px}px`),
    );
    expect(offences).toEqual([]);
  });
});

describe('the check can fail', () => {
  it('reads fixed sizes in px and rem; ignores other bracketed classes', () => {
    expect(fixedSizesIn('font-mono text-[10px] tracking-[0.14em]')).toEqual([10]);
    expect(fixedSizesIn('text-[0.625rem] text-[11px]')).toEqual([10, 11]);
    expect(fixedSizesIn('min-h-[23px] text-ink tracking-[0.2em]')).toEqual([]);
  });

  it('reads size tokens but not their line-heights', () => {
    expect(
      themeSizes('--text-xs: 0.8125rem;\n--text-xs--line-height: calc(1.125 / 0.8125);'),
    ).toEqual({ xs: 13 });
    expect(themeSizes('--text-tiny: 9px;')).toEqual({ tiny: 9 });
  });

  it('negative: finds the body size only on the body rule', () => {
    expect(
      bodySize('html { font-size: 20px; }\n  body {\n  margin: 0;\n  font-size: 14px;\n}'),
    ).toBe(14);
    expect(bodySize('h1 { font-size: 30px; }')).toBeNull();
  });
});
