/**
 * The title ladder: three sizes, never in the serif (L-382, then L-405).
 *
 *   page title     24px   PAGE_TITLE, every screen's header and the crash screens
 *   section title  20px   SECTION_TITLE, `SectionHeading`
 *   welcome title  30px, 36px from `md:`   HERO_TITLE
 *
 * The owner chose the sizes on 12 Nov 2026 (L-382), set in the display serif.
 * On 13 Nov 2026 the owner dropped the serif from the whole app (L-405 is the
 * titles). So the rule on titles
 * turned over:
 *
 *   before (L-382)  the three titles ARE the serif, at regular weight
 *   now    (L-405)  no title names the serif, and no heading tag does either
 *
 * The sizes did not change: page title > section title > body, or the ladder
 * is not a ladder.
 *
 * The score numbers left the serif next (L-407), so the rule for the whole app
 * turned over too:
 *
 *   before (L-382)  serif text is allowed, at regular weight only, because
 *                   Newsreader ships ONE weight and a browser fakes the rest
 *   now    (L-407)  NOTHING that ships names the serif class. Not a title, not
 *                   a number, not anything
 *
 * That zero is what makes it safe to take the font file out later: no class
 * list can be left pointing at a face that is gone. Until it is taken out,
 * fonts.css still declares no Newsreader face other than 400.
 *
 * FORBID-LIST (LESSON-033): the scans find every class list and every heading
 * tag that names the serif, wherever it is. They read source with comments
 * stripped, so the comment explaining the rule can neither trip it nor
 * satisfy it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, shippedText, stripComments, walk } from '../lib/repo-scan';
import { HERO_TITLE, PAGE_TITLE, SECTION_TITLE } from '../ui/PageHeader';

const THEME = readFileSync(join(REPO_ROOT, 'apps/light/src/styles/theme.css'), 'utf8');
const FONTS = readFileSync(join(REPO_ROOT, 'apps/light/src/styles/fonts.css'), 'utf8');

const SERIF = /(?<![\w-])font-display(?![\w-])/;

/**
 * Every run of class text that names the serif. Class strings hold no quote
 * marks, so the run between the quotes around `font-display` is its class list
 * — in a '…', "…" or `…` literal alike.
 */
export function serifClassLists(source: string): string[] {
  return [...stripComments(source).matchAll(/[^'"`]*(?<![\w-])font-display(?![\w-])[^'"`]*/g)].map(
    (match) => match[0].trim(),
  );
}

/** The names of the title styles that name the serif. Titles are never the serif (L-405). */
export function serifTitles(titles: Readonly<Record<string, string>>): string[] {
  return Object.entries(titles)
    .filter(([, classes]) => SERIF.test(classes))
    .map(([name]) => name);
}

/**
 * Every heading tag whose own attributes name the serif: a title that went
 * round the three shared styles.
 * shortcut: stops at the first `>`, so a serif class after an arrow function in
 * the same tag is missed; parse the JSX if a heading ever carries a handler.
 */
export function serifHeadings(source: string): string[] {
  return [
    ...stripComments(source).matchAll(/<h[1-6]\b[^>]*?(?<![\w-])font-display(?![\w-])[^>]*>/g),
  ].map((match) => match[0].replaceAll(/\s+/g, ' '));
}

/** The weight of every Newsreader face in a stylesheet that is not 400. */
export function extraSerifWeights(css: string): string[] {
  return [...stripComments(css).matchAll(/@font-face\s*\{([^}]*)\}/g)]
    .map((match) => match[1] ?? '')
    .filter((block) => /font-family:\s*['"]?Newsreader\b/.test(block))
    .map((block) => /font-weight:\s*([^;]+);/.exec(block)?.[1]?.trim() ?? '(no weight)')
    .filter((weight) => weight !== '400' && weight !== 'normal');
}

/** Tailwind's sizes, with the theme's own 13px `text-xs` (L-241). */
const SIZE_PX: Readonly<Record<string, number>> = {
  xs: 13,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
};

/** The base (unprefixed) text size in a class list, in px, or `null` when it inherits. */
export function sizePx(classes: string): number | null {
  const name = /(?:^|\s)text-(xs|sm|base|lg|xl|2xl|3xl|4xl)(?=\s|$)/.exec(classes)?.[1];
  return name === undefined ? null : (SIZE_PX[name] ?? null);
}

/** The `font-size` on the theme's `body` rule, in px. */
function bodyPx(css: string): number {
  const rule = /(?:^|\n)\s*body\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const size = /font-size\s*:\s*(\d+(?:\.\d+)?)(px|rem)/.exec(rule);
  if (size === null) throw new Error('theme.css has no body font-size');
  return size[2] === 'rem' ? Number(size[1]) * 16 : Number(size[1]);
}

/** Every shipped source file the two scans read. */
function sourceFiles(): string[] {
  const files = [join(REPO_ROOT, 'apps/light/src'), join(REPO_ROOT, 'packages/ui/src')].flatMap(
    (directory) => walk(directory, { extensions: ['.ts', '.tsx'] }),
  );
  expect(files.length).toBeGreaterThan(50);
  return files;
}

describe('the title ladder (L-382, L-405)', () => {
  it('no title style names the serif', () => {
    expect(serifTitles({ PAGE_TITLE, SECTION_TITLE, HERO_TITLE })).toEqual([]);
  });

  it('no heading tag anywhere names the serif', () => {
    const files = sourceFiles();
    // Proof the scan read real headings: every screen has some.
    expect(files.filter((file) => /<h[1-6]\b/.test(shippedText(file))).length).toBeGreaterThan(10);
    const offences = files.flatMap((file) =>
      serifHeadings(shippedText(file)).map((tag) => `${displayPath(file)}: ${tag}`),
    );
    expect(offences).toEqual([]);
  });

  it('nothing that ships names the serif class (L-407)', () => {
    const files = sourceFiles();
    // Proof the scan read the two files that held the last serif text: the
    // match score and the welcome card's example score. The count of serif
    // class lists was 6; 5 after L-391; 2 after L-405; none now.
    for (const last of ['features/analysis/BandScale.tsx', 'features/onboarding/Welcome.tsx']) {
      expect(files.map(displayPath).filter((file) => file.endsWith(last))).toHaveLength(1);
    }
    const offences = files.flatMap((file) =>
      serifClassLists(shippedText(file)).map((classes) => `${displayPath(file)}: "${classes}"`),
    );
    expect(offences).toEqual([]);
  });

  it('no Newsreader face other than 400 is declared in fonts.css', () => {
    expect(FONTS).toMatch(/font-family:\s*'Newsreader'/);
    expect(extraSerifWeights(FONTS)).toEqual([]);
  });

  it('page title is larger than section title is larger than body', () => {
    const body = bodyPx(THEME);
    const page = sizePx(String(PAGE_TITLE)) ?? body;
    const section = sizePx(String(SECTION_TITLE)) ?? body;
    expect(page).toBeGreaterThan(section);
    expect(section).toBeGreaterThan(body);
  });
});

describe('the check can fail', () => {
  it('a title style that names the serif is reported by name', () => {
    expect(
      serifTitles({
        PAGE_TITLE: 'font-display text-2xl font-normal text-ink lining-nums',
        SECTION_TITLE: 'text-xl font-semibold text-ink',
      }),
    ).toEqual(['PAGE_TITLE']);
  });

  it('a heading tag that names the serif is reported, on one line or several', () => {
    expect(serifHeadings('<h1 className="font-display text-2xl font-normal">Tracker</h1>')).toEqual(
      ['<h1 className="font-display text-2xl font-normal">'],
    );
    expect(serifHeadings('<h3\n  id="a"\n  className={`font-display ${tone}`}\n>')).toHaveLength(1);
  });

  it('negative: a sans heading, serif text that is no heading, and a comment are not reported', () => {
    expect(serifHeadings('<h2 className="text-xl font-semibold text-ink">Skills</h2>')).toEqual([]);
    expect(serifHeadings('<p className="font-display text-6xl font-normal">72</p>')).toEqual([]);
    expect(serifHeadings('<header className="font-display">')).toEqual([]);
    expect(serifHeadings('{/* <h1 className="font-display"> was the old title */}')).toEqual([]);
  });

  it('a class list that names the serif is reported, whatever quotes it sits in', () => {
    // The two that were left before L-407, as they were written.
    expect(
      serifClassLists('<span className={`font-display text-6xl font-normal ${INK[verdict]}`}>'),
    ).toEqual(['font-display text-6xl font-normal ${INK[verdict]}']);
    expect(serifClassLists('<span className="font-display text-3xl font-normal">')).toEqual([
      'font-display text-3xl font-normal',
    ]);
    expect(serifClassLists("const SCORE = 'text-6xl font-display';")).toEqual([
      'text-6xl font-display',
    ]);
  });

  it('negative: sans text, a longer class name, and a comment are not reported', () => {
    expect(serifClassLists('<p className="text-6xl font-semibold tabular-nums">72</p>')).toEqual(
      [],
    );
    expect(serifClassLists('<p className="font-display-2 my-font-display">')).toEqual([]);
    expect(serifClassLists('// never write font-display again\nconst a = 1;')).toEqual([]);
    expect(serifClassLists('/* font-display font-normal */ const a = 1;')).toEqual([]);
  });

  it('a second Newsreader weight is reported; other families are not', () => {
    const css = `
      @font-face { font-family: 'Newsreader'; font-weight: 400; src: url('/a.woff2'); }
      @font-face { font-family: 'Newsreader'; font-weight: 700; src: url('/b.woff2'); }
      @font-face { font-family: 'Inter'; font-weight: 300 700; src: url('/c.woff2'); }`;
    expect(extraSerifWeights(css)).toEqual(['700']);
  });

  it('reads the base size, not a breakpoint size', () => {
    expect(sizePx('font-display text-lg')).toBe(18);
    expect(sizePx('md:text-4xl text-3xl')).toBe(30);
    expect(sizePx('font-semibold text-ink')).toBeNull();
  });
});
