import { describe, expect, it } from 'vitest';

import { TRUNCATION_MARKER, normalizeWhitespace, truncateForPrompt } from './text';

// Every exotic character in this file is written as a `\u` escape on purpose.
// An invisible character pasted into a test is indistinguishable from a plain
// space in review, and a test that ends up asserting `' ' === ' '` passes while
// proving nothing at all.
const NBSP = '\u00a0';
const NARROW_NBSP = '\u202f';
const IDEOGRAPHIC_SPACE = '\u3000';
const EN_QUAD = '\u2000';
const SOFT_HYPHEN = '\u00ad';
const ZERO_WIDTH_SPACE = '\u200b';
const ZERO_WIDTH_JOINER = '\u200d';
const ZERO_WIDTH_NON_JOINER = '\u200c';
const WORD_JOINER = '\u2060';
const BOM = '\ufeff';

describe('normalizeWhitespace', () => {
  // ── Happy path ────────────────────────────────────────────────────────────
  it('leaves already-clean text untouched', () => {
    const clean = 'Senior Credit Risk Analyst\n\nBarclays, London\nIFRS 9 staging logic';
    expect(normalizeWhitespace(clean)).toBe(clean);
  });

  it('collapses runs of spaces and tabs into one space', () => {
    expect(normalizeWhitespace('Credit    Risk\tAnalyst')).toBe('Credit Risk Analyst');
  });

  it('normalises CRLF and lone CR to LF', () => {
    expect(normalizeWhitespace('one\r\ntwo\rthree')).toBe('one\ntwo\nthree');
  });

  it('collapses three or more blank lines to a single blank line', () => {
    expect(normalizeWhitespace('Experience\n\n\n\n\nBarclays')).toBe('Experience\n\nBarclays');
  });

  it('strips trailing spaces from every line', () => {
    expect(normalizeWhitespace('Barclays   \nHSBC\t\n')).toBe('Barclays\nHSBC');
  });

  // ── Edge: the characters PDF extraction actually emits ─────────────────────
  it('turns every kind of exotic space into an ordinary space', () => {
    // pdf.js emits U+00A0 wherever the PDF used a non-breaking space. Leaving
    // it in means a keyword search for "50 %" silently never matches.
    expect(normalizeWhitespace(`50${NBSP}% coverage`)).toBe('50 % coverage');
    expect(normalizeWhitespace(`narrow${NARROW_NBSP}space`)).toBe('narrow space');
    expect(normalizeWhitespace(`ideographic${IDEOGRAPHIC_SPACE}space`)).toBe('ideographic space');
    expect(normalizeWhitespace(`en${EN_QUAD}quad`)).toBe('en quad');
  });

  it('removes zero-width characters and soft hyphens', () => {
    // A soft hyphen inside "Analyst" makes the word unfindable by any matcher.
    expect(normalizeWhitespace(`Ana${SOFT_HYPHEN}lyst`)).toBe('Analyst');
    expect(normalizeWhitespace(`Risk${ZERO_WIDTH_SPACE}Analyst`)).toBe('RiskAnalyst');
    expect(normalizeWhitespace(`${WORD_JOINER}Risk`)).toBe('Risk');
    expect(normalizeWhitespace(`${BOM}Senior`)).toBe('Senior');
  });

  it('KEEPS the zero-width joiner and non-joiner, which are not noise', () => {
    // U+200D holds an emoji sequence together and U+200C is a real
    // orthographic character in Persian, Arabic and several Indic scripts.
    // Stripping either silently rewrites a candidate's name or their emoji.
    expect(normalizeWhitespace(`Risk${ZERO_WIDTH_JOINER}Analyst`)).toBe(
      `Risk${ZERO_WIDTH_JOINER}Analyst`,
    );
    expect(normalizeWhitespace(`Risk${ZERO_WIDTH_NON_JOINER}Analyst`)).toBe(
      `Risk${ZERO_WIDTH_NON_JOINER}Analyst`,
    );
    const technologist = '\u{1f468}\u200d\u{1f4bb}';
    expect(normalizeWhitespace(technologist)).toBe(technologist);
  });

  it('preserves currency, accents, CJK, em dashes and bullets verbatim', () => {
    const text = ['SENIOR ANALYST — £85,000', 'Basé à Paris; 日本語', '• IFRS 9'].join('\n');
    expect(normalizeWhitespace(text)).toBe(text);
  });

  // ── Negative / boundary ───────────────────────────────────────────────────
  it('returns an empty string for empty or whitespace-only input', () => {
    expect(normalizeWhitespace('')).toBe('');
    expect(normalizeWhitespace('   \n\n\t  \r\n ')).toBe('');
    expect(normalizeWhitespace(`${NBSP}${ZERO_WIDTH_SPACE}${SOFT_HYPHEN}`)).toBe('');
  });

  it('is idempotent — normalising twice changes nothing', () => {
    const messy = ` Credit  Risk \r\n\r\n\r\n\r\n  Analyst${ZERO_WIDTH_SPACE}  `;
    const once = normalizeWhitespace(messy);
    expect(normalizeWhitespace(once)).toBe(once);
  });
});

describe('truncateForPrompt', () => {
  const LONG = 'word '.repeat(400).trim(); // 1999 characters

  // ── Happy path ────────────────────────────────────────────────────────────
  it('returns short text unchanged and adds no marker', () => {
    expect(truncateForPrompt('Senior Credit Risk Analyst', 500)).toBe('Senior Credit Risk Analyst');
  });

  it('truncates long text and says so', () => {
    const out = truncateForPrompt(LONG, 100);
    expect(out.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(out.startsWith('word word')).toBe(true);
  });

  // ── Boundary: the length guarantee a prompt budget depends on ─────────────
  it('never exceeds the budget, for any budget', () => {
    for (let budget = 1; budget <= 200; budget += 1) {
      const out = truncateForPrompt(LONG, budget);
      expect(out.length).toBeLessThanOrEqual(budget);
    }
  });

  it('returns text of exactly the budget length unchanged', () => {
    const exact = 'x'.repeat(64);
    expect(truncateForPrompt(exact, 64)).toBe(exact);
    expect(truncateForPrompt(`${exact}y`, 64).length).toBeLessThanOrEqual(64);
  });

  it('drops the marker when the budget is too small to carry it', () => {
    const out = truncateForPrompt(LONG, 8);
    expect(out.length).toBeLessThanOrEqual(8);
    expect(out).not.toContain('truncated');
  });

  // ── Negative ──────────────────────────────────────────────────────────────
  it('returns an empty string for a zero or negative budget', () => {
    expect(truncateForPrompt(LONG, 0)).toBe('');
    expect(truncateForPrompt(LONG, -10)).toBe('');
  });

  it('returns an empty string for empty input whatever the budget', () => {
    expect(truncateForPrompt('', 100)).toBe('');
  });

  it('floors a fractional budget rather than producing a fractional cut', () => {
    expect(truncateForPrompt(LONG, 40.9).length).toBeLessThanOrEqual(40);
  });

  // ── Edge: UTF-16 ──────────────────────────────────────────────────────────
  it('never leaves a lone high surrogate at the end', () => {
    // A lone surrogate is not valid text and corrupts anything downstream that
    // re-encodes it. Emoji reach CVs more often than anyone expects.
    const emoji = '\u{1f4c8}'.repeat(50); // each is 2 UTF-16 code units
    for (let budget = 1; budget <= 60; budget += 1) {
      const out = truncateForPrompt(emoji, budget);
      const last = out.charCodeAt(out.length - 1);
      const isLoneHighSurrogate = last >= 0xd800 && last <= 0xdbff;
      expect(isLoneHighSurrogate).toBe(false);
    }
  });

  it('prefers a word boundary when one is close to the cut', () => {
    const text = `${'a'.repeat(80)} boundary ${'b'.repeat(80)}`;
    const out = truncateForPrompt(text, 105);
    expect(out.replace(TRUNCATION_MARKER, '').endsWith('boundary')).toBe(true);
  });
});
