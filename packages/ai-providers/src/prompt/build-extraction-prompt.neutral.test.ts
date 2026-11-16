/**
 * The advert reader's instructions name no country (L-420).
 *
 * CViper Light is for anyone in any country (owner decision, 13 Nov 2026), so
 * what the model is told must not say the adverts are British. Every check
 * here reads the BUILT prompt — the text a model actually receives — never the
 * source file, so a comment can neither satisfy nor break it.
 */
import { describe, expect, it } from 'vitest';

import { buildExtractionPrompt } from './build-extraction-prompt';

/** Names no place, so only the instructions themselves can trip the guard. */
const NEUTRAL_ADVERT = 'Credit Risk Analyst\nA retail bank\nHybrid, 3 days on site\n45000 a year';

const { system, user } = buildExtractionPrompt({ text: NEUTRAL_ADVERT });
const WHOLE_PROMPT = `${system}\n${user}`;
const userLines = user.split('\n');

/** Whole words only: "bulk", "duke" and "ukulele" are not the UK. */
const NAMES_BRITAIN = /\b(?:UK|U\.K\.?|United Kingdom|London|Britain|British)(?![A-Za-z])/i;

describe('the guard itself', () => {
  it.each([
    'for UK contract roles',
    'the U.K. market',
    'United Kingdom',
    'London banking',
    'a british bank',
    'Great Britain',
  ])('catches %j', (text) => {
    expect(text).toMatch(NAMES_BRITAIN);
  });

  it.each(['in bulk', 'the duke', 'a ukulele', '"£45k-£55k" is 45000', 'currency GBP'])(
    'leaves %j alone',
    (text) => {
      expect(text).not.toMatch(NAMES_BRITAIN);
    },
  );
});

describe('buildExtractionPrompt — names no country (L-420)', () => {
  it('does not name the UK, London or Britain anywhere in what the model is sent', () => {
    expect(WHOLE_PROMPT).not.toMatch(NAMES_BRITAIN);
  });

  it('opens with the same role, without a place', () => {
    expect(system).toContain(
      'You are a meticulous job-advert parser for contract and permanent roles, ' +
        'with particular fluency in banking and finance conventions, including ' +
        'day rates and part-time pro rata pay.',
    );
  });

  it('keeps the location rule whole, with examples that fit any country', () => {
    expect(userLines).toContain(
      '- location: where the role is based, WORD FOR WORD. Keep any hybrid, remote, on-site or days-per-week wording exactly as written — "City centre (hybrid, 3 days on site)" stays whole, and "Fully remote (anywhere in the country)" stays whole. Do not reduce it to a city. null if the advert does not say.',
    );
  });
});

describe('buildExtractionPrompt — the money examples (L-420)', () => {
  // Copied from main before the change: a UK advert must be told what it
  // always was.
  it.each([
    '  * "£45k-£55k" is 45000 and 55000, currency GBP, period year.',
    '  * "£95,000" alone is 95000 for both, period year.',
    '  * A day rate ("£650 per day", "£650/day") is 650 for both, period day. Do NOT multiply it up to a yearly figure.',
    '  * An hourly rate ("£50 per hour", "£25/hr") is 50 for both, period hour.',
    '  * Pro rata pay ("£45,000 pro rata") is null for both amounts and period — the real pay is not stated.',
  ])('still carries the pound rule %j', (line) => {
    expect(userLines).toContain(line);
  });

  it('carries exactly one euro example and one dollar example', () => {
    expect(userLines.filter((line) => line.includes('€'))).toEqual([
      '  * "€60,000" alone is 60000 for both, currency EUR, period year.',
    ]);
    expect(userLines.filter((line) => line.includes('$'))).toEqual([
      '  * "$120,000" alone is 120000 for both, currency USD, period year.',
    ]);
  });

  it('puts them with the yearly examples, before the day rate', () => {
    const at = (text: string): number => userLines.findIndex((line) => line.includes(text));
    expect(at('"£95,000" alone')).toBeLessThan(at('"€60,000" alone'));
    expect(at('"€60,000" alone')).toBeLessThan(at('"$120,000" alone'));
    expect(at('"$120,000" alone')).toBeLessThan(at('A day rate ('));
  });
});
