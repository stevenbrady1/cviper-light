/**
 * Contract: the numbers that decide something are set apart from the numbers
 * that do not (Northlight).
 *
 * CViper Light shows plenty of numbers -- result counts, board counts, a
 * character limit, a version. Exactly one of them changes what the user does
 * next, and it is the match score. Rendering it like the others makes the user
 * do the sorting; rendering it in the display serif does that sorting for them.
 *
 * Three properties are pinned, and all three are load-bearing rather than
 * decorative:
 *
 *   font-display   the serif. It is the whole signal.
 *   lining-nums    this serif defaults to OLD-STYLE figures, which sit above
 *                  and below the baseline. Without this a 71 and a 100 rock
 *                  against each other and the number reads as unstable.
 *   tabular-nums   inherited from the Plex Mono version this replaced, and
 *                  kept for the same reason: the figure must not jitter
 *                  between runs as the digits change.
 *
 * FORBID-LIST (LESSON-033). The negative test encodes "the score is not set in
 * the body or mono face", not "the score has class X", so restyling around it
 * cannot turn this red -- only losing the serif can.
 *
 * This reads the SOURCE rather than rendering, because Tailwind class names are
 * the contract here and jsdom resolves no stylesheet: a render-based assertion
 * would pass on a component that had lost every one of these classes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BAND_SCALE = path.resolve(HERE, '../features/analysis/BandScale.tsx');

/** The className string on the element carrying `data-testid="band-scale-score"`. */
function scoreClasses(): string {
  const source = fs.readFileSync(BAND_SCALE, 'utf8');
  const anchor = source.indexOf('data-testid="band-scale-score"');
  expect(anchor, 'band-scale-score is missing from BandScale.tsx').toBeGreaterThan(-1);
  const after = source.slice(anchor, anchor + 400);
  const match = after.match(/className=\{`([^`]+)`\}/);
  expect(match, 'could not read the score className').not.toBeNull();
  return match![1];
}

describe('outcome numerals (Northlight)', () => {
  it('the match score is set in the display serif', () => {
    expect(scoreClasses()).toContain('font-display');
  });

  it('the match score uses lining figures', () => {
    // Old-style figures are this serif's default. They descend below the
    // baseline on 3, 4, 5, 7 and 9, so a two-digit score visibly rocks.
    expect(scoreClasses()).toContain('lining-nums');
  });

  it('the match score keeps tabular figures', () => {
    // Carried over from the Plex Mono version deliberately: the user compares
    // this number against previous runs and it must not jitter.
    expect(scoreClasses()).toContain('tabular-nums');
  });

  it('the match score is NOT set in the body or mono face', () => {
    const classes = scoreClasses();
    expect(classes, 'the score fell back to a non-display face').not.toMatch(/\bfont-mono\b/);
    expect(classes, 'the score fell back to a non-display face').not.toMatch(/\bfont-sans\b/);
  });

  it('the display face ships exactly one weight, so the score cannot ask for another', () => {
    // Newsreader is self-hosted at 400 only. `font-medium` or heavier would be
    // synthesised by the browser -- a smeared, faux-bold serif.
    const classes = scoreClasses();
    expect(classes).not.toMatch(/\bfont-(medium|semibold|bold|extrabold|black)\b/);
  });

  it('--font-display is defined in the theme, so the utility class resolves', () => {
    // Tailwind 4 generates `font-display` FROM this token. Without it the class
    // is inert and every assertion above passes while the serif never renders.
    const theme = fs.readFileSync(path.resolve(HERE, './theme.css'), 'utf8');
    expect(theme).toMatch(/--font-display:\s*'Newsreader'/);
  });

  it('Newsreader is self-hosted, not fetched from a CDN', () => {
    // This app promises that nothing leaves the machine unless the user asks.
    // A <link> to a font CDN would break that on the first paint of the first
    // launch, invisibly.
    const fonts = fs.readFileSync(path.resolve(HERE, './fonts.css'), 'utf8');
    expect(fonts).toMatch(/font-family:\s*'Newsreader'/);
    expect(fonts).toMatch(/url\('\/fonts\/newsreader-400-latin\.woff2'\)/);
    expect(fonts, 'a remote font URL appeared in fonts.css').not.toMatch(/https?:\/\//);
  });
});
