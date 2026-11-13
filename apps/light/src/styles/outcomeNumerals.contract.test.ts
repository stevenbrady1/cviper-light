/**
 * Contract: the number that decides something is set apart from the numbers
 * that do not (Northlight, then L-407).
 *
 * CViper Light shows plenty of numbers -- result counts, board counts, a
 * character limit, a version. Exactly one of them changes what the user does
 * next, and it is the match score. Rendering it like the others makes the user
 * do the sorting.
 *
 * How it is set apart turned over on 13 Nov 2026, when the owner dropped the
 * serif from the whole app:
 *
 *   before (Northlight)  the match score IS the display serif, at regular
 *                        weight: "it is the whole signal"
 *   now    (L-407)       the match score is never the serif. It is set apart
 *                        by size and weight, in the app's one typeface
 *
 * FORBID-LIST (LESSON-033). The match score is:
 *
 *   never the serif        the owner's decision
 *   never the mono face    it would read as one more count
 *   never under 48px       size is half of what sets it apart
 *   never regular weight   weight is the other half
 *   never proportional     `tabular-nums`: the user compares it with earlier
 *                          runs and it must not jitter as the digits change
 *   never old-style        `lining-nums`: a 71 and a 100 must sit on one line
 *
 * This reads the SOURCE rather than rendering, because Tailwind class names are
 * the contract here and jsdom resolves no stylesheet: a render-based assertion
 * would pass on a component that had lost every one of these classes. Comments
 * are stripped first, so the comment explaining a rule can neither trip it nor
 * satisfy it. The real engine's answer (Inter, 600, face loaded) is measured in
 * `e2e/contrast-webkit.spec.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BAND_SCALE = path.resolve(HERE, '../features/analysis/BandScale.tsx');

/** Drop comments, so only the real element's classes are ever read. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** The className on the element carrying `data-testid="band-scale-score"`. */
function scoreClasses(source: string): string {
  const shipped = code(source);
  const anchor = shipped.indexOf('data-testid="band-scale-score"');
  if (anchor === -1) throw new Error('band-scale-score is missing from BandScale.tsx');
  const match = shipped.slice(anchor, anchor + 400).match(/className=(?:\{`([^`]+)`\}|"([^"]+)")/);
  const captured = match?.[1] ?? match?.[2];
  if (!captured) throw new Error('could not read the score className from BandScale.tsx');
  return captured;
}

/** A class by its whole name: `font-mono`, never `font-monospace` or `md:font-mono`. */
function names(classes: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)${name}(?=\\s|$)`).test(classes);
}

/** Every rule of the forbid-list the match score's classes break. Empty is a pass. */
function scoreProblems(classes: string): string[] {
  const problems: string[] = [];
  if (names(classes, 'font-display')) problems.push('it is the serif');
  if (names(classes, 'font-mono')) problems.push('it is the mono face');
  // 48px is Tailwind's `text-5xl`; the base size counts, not a breakpoint's.
  if (!names(classes, 'text-[5-9]xl')) problems.push('it is smaller than 48px');
  if (!names(classes, 'font-(?:semibold|bold)')) problems.push('it is not set apart by weight');
  if (!names(classes, 'tabular-nums')) problems.push('its digits are not fixed-width');
  if (!names(classes, 'lining-nums')) problems.push('its digits are not level');
  return problems;
}

const ANALYSIS_RESULT = path.resolve(HERE, '../features/analysis/AnalysisResult.tsx');

/**
 * The className on the element carrying `data-testid="analysis-ats-score-value"`,
 * read with comments stripped first, so a comment can neither trip the check
 * nor stand in for the element.
 */
function keywordNumberClasses(source: string): string {
  const shipped = code(source);
  const anchor = shipped.indexOf('data-testid="analysis-ats-score-value"');
  if (anchor === -1) throw new Error('analysis-ats-score-value is missing from AnalysisResult.tsx');
  const match = shipped.slice(anchor, anchor + 400).match(/className=(?:\{`([^`]+)`\}|"([^"]+)")/);
  const captured = match?.[1] ?? match?.[2];
  if (!captured) throw new Error('could not read the keyword number className');
  return captured;
}

/** The score's element as BandScale writes it, with these classes. */
function scoreElement(classes: string): string {
  return (
    '<span\n  data-testid="band-scale-score"\n  className={`' +
    classes +
    ' ${VERDICT_INK[verdict]}`}\n>'
  );
}

const GOOD = 'text-6xl leading-none font-semibold lining-nums tabular-nums md:text-7xl';

describe('outcome numerals (Northlight, L-407)', () => {
  it('the match score breaks no rule: not the serif, not mono, 48px or more, heavy, level fixed-width digits', () => {
    expect(scoreProblems(scoreClasses(fs.readFileSync(BAND_SCALE, 'utf8')))).toEqual([]);
  });

  it('the check can fail: each broken rule is named', () => {
    expect(scoreProblems(scoreClasses(scoreElement(GOOD)))).toEqual([]);

    // The score as it was before L-407: the serif, at regular weight.
    const before =
      'font-display text-6xl leading-none font-normal lining-nums tabular-nums md:text-7xl';
    expect(scoreProblems(scoreClasses(scoreElement(before)))).toEqual([
      'it is the serif',
      'it is not set apart by weight',
    ]);
    expect(scoreProblems(scoreClasses(scoreElement(`font-mono ${GOOD}`)))).toEqual([
      'it is the mono face',
    ]);
    // A big size at a breakpoint only is still a small number on a phone.
    expect(scoreProblems(scoreClasses(scoreElement(GOOD.replace('text-6xl', 'text-4xl'))))).toEqual(
      ['it is smaller than 48px'],
    );
    expect(scoreProblems(scoreClasses(scoreElement(GOOD.replace(' tabular-nums', ''))))).toEqual([
      'its digits are not fixed-width',
    ]);
    expect(scoreProblems(scoreClasses(scoreElement(GOOD.replace(' lining-nums', ''))))).toEqual([
      'its digits are not level',
    ]);
  });

  it('a comment neither trips the check nor stands in for the element', () => {
    const commented =
      '{/* data-testid="band-scale-score" className="font-display font-normal" */}\n' +
      '// font-display was the old face\n' +
      scoreElement(GOOD);
    expect(scoreProblems(scoreClasses(commented))).toEqual([]);

    const commentedGood =
      `{/* data-testid="band-scale-score" className="${GOOD}" */}\n` +
      '<span data-testid="band-scale-score" className="font-display text-6xl font-normal">';
    expect(scoreProblems(scoreClasses(commentedGood))).toContain('it is the serif');
  });

  it('the keyword number is never in the display serif (L-391)', () => {
    // FORBID-LIST: the first number to leave the serif. Beside the match score
    // in the same face it read as a second score. No number is the serif now
    // (L-407); the whole-app rule is in `heading-ladder.contract.test.ts`.
    const source = fs.readFileSync(ANALYSIS_RESULT, 'utf8');
    expect(keywordNumberClasses(source), 'the keyword number is in the serif').not.toMatch(
      /\bfont-display\b/,
    );
  });

  it('the check can fail: a keyword number in the serif is caught, a comment is not', () => {
    const serif =
      '<span\n  data-testid="analysis-ats-score-value"\n  className={`font-display text-3xl ${tone}`}\n>';
    expect(keywordNumberClasses(serif)).toMatch(/\bfont-display\b/);

    // A comment naming the serif, or a commented-out element, neither trips
    // nor satisfies the check: only the real element's classes are read.
    const commented =
      '{/* data-testid="analysis-ats-score-value" className="font-display" */}\n' +
      '// font-display was the old face\n' +
      '<span data-testid="analysis-ats-score-value" className="font-mono tabular-nums">';
    expect(keywordNumberClasses(commented)).toBe('font-mono tabular-nums');
    const commentedSerif =
      '{/* data-testid="analysis-ats-score-value" className="font-mono" */}\n' +
      '<span data-testid="analysis-ats-score-value" className="font-display">';
    expect(keywordNumberClasses(commentedSerif)).toMatch(/\bfont-display\b/);
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
