/**
 * More money signs than the UK's four (L-418).
 *
 * The clamp repairs what a model wrote. Until this slice it knew `£ $ € ¥` and
 * nothing else, so an Australian advert's `A$` reached validation as rubbish
 * and cost the user the one retry. The signs added are the ones the nineteen
 * searchable countries use that cannot be mistaken for another currency.
 *
 * TWO RULES THESE TESTS HOLD:
 *   1. A bare `$` is USD, as it always was. Nothing in this package knows which
 *      country the user searches in, and the advert's own text does not move it.
 *   2. South Africa's `R` is NOT a sign here. One letter is too easy to misread,
 *      so a rand figure is left exactly as the model wrote it.
 */
import { describe, expect, it } from 'vitest';

import { JobExtractionSchema } from '@cviper/core-types';

import { clampExtraction } from './extraction-clamp';
import { hasMoneyFigure } from './salary-wording';

function reply(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    title: 'Risk Analyst',
    company: 'Example Bank',
    agency: null,
    location: 'Sydney',
    url: 'https://example.invalid/1',
    description: 'Second-line credit risk.',
    posted_date: '2026-08-18',
    salary_currency: null,
    salary_min: 90000,
    salary_max: 110000,
    salary_period: 'year',
    ...overrides,
  };
}

function clamped(
  raw: unknown,
  source: string,
): { value: Record<string, unknown>; applied: readonly string[] } {
  const result = clampExtraction(raw, source);
  return { value: result.value as Record<string, unknown>, applied: result.applied };
}

/** Every sign this slice adds, and the code it means. */
const NEW_SIGNS = [
  ['A$', 'AUD'],
  ['C$', 'CAD'],
  ['NZ$', 'NZD'],
  ['S$', 'SGD'],
  ['R$', 'BRL'],
  ['MX$', 'MXN'],
  ['₹', 'INR'],
  ['zł', 'PLN'],
] as const;

/** The four that were already read. They must not move. */
const OLD_SIGNS = [
  ['£', 'GBP'],
  ['$', 'USD'],
  ['€', 'EUR'],
  ['¥', 'JPY'],
] as const;

describe('a money sign the model wrote in place of a currency code', () => {
  it('happy path: A$90,000 is AUD, and the repaired reply is a valid extraction', () => {
    const { value, applied } = clamped(
      reply({ salary_currency: 'A$', salary_min: 'A$90,000', salary_max: 'A$110,000' }),
      'Salary A$90,000 to A$110,000 a year.',
    );

    expect(value['salary_currency']).toBe('AUD');
    expect(value['salary_min']).toBe(90000);
    expect(value['salary_max']).toBe(110000);
    expect(applied).toContain('salary_currency:symbol-to-code');
    expect(JobExtractionSchema.safeParse(value).success).toBe(true);
  });

  it.each(NEW_SIGNS)('%s is %s', (sign, code) => {
    const { value, applied } = clamped(reply({ salary_currency: sign }), 'Salary 90,000 a year.');
    expect(value['salary_currency']).toBe(code);
    expect(applied).toContain('salary_currency:symbol-to-code');
  });

  it.each(OLD_SIGNS)('regression: %s is still %s', (sign, code) => {
    const { value } = clamped(reply({ salary_currency: sign }), 'Salary 90,000 a year.');
    expect(value['salary_currency']).toBe(code);
  });

  it('negative: a bare $ is still USD, never guessed from the country', () => {
    // The advert is plainly Australian. The sign is still a bare dollar, and a
    // bare dollar is USD: guessing AUD here is how a US advert read by a user
    // in Sydney would come out wrong.
    const { value } = clamped(
      reply({ salary_currency: '$', salary_min: '$90,000' }),
      'Risk analyst, Sydney NSW, Australia. Salary $90,000 to $110,000.',
    );
    expect(value['salary_currency']).toBe('USD');
    expect(value['salary_min']).toBe(90000);
  });

  it('boundary: the longest sign wins — NZ$ is NZD and R$ is BRL, not a dollar', () => {
    const nz = clamped(reply({ salary_currency: 'NZ$', salary_min: 'NZ$90,000' }), 'NZ$90,000');
    expect(nz.value['salary_currency']).toBe('NZD');
    expect(nz.value['salary_min']).toBe(90000);

    const br = clamped(reply({ salary_currency: 'R$', salary_min: 'R$ 8,000' }), 'R$ 8,000');
    expect(br.value['salary_currency']).toBe('BRL');
    expect(br.value['salary_min']).toBe(8000);
  });

  it('edge: the letters of a sign are read in either case, as a code is', () => {
    expect(clamped(reply({ salary_currency: 'nz$' }), 'x 90,000').value['salary_currency']).toBe(
      'NZD',
    );
    expect(clamped(reply({ salary_currency: 'ZŁ' }), 'x 90,000').value['salary_currency']).toBe(
      'PLN',
    );
  });

  it('CHF was already a code: it stays CHF and is not reported as a repaired sign', () => {
    const { value, applied } = clamped(reply({ salary_currency: 'CHF' }), 'CHF 120,000');
    expect(value['salary_currency']).toBe('CHF');
    expect(applied).not.toContain('salary_currency:symbol-to-code');
  });

  it('negative: R 500,000 stays as written — one letter is not a sign', () => {
    const { value, applied } = clamped(
      reply({ salary_currency: 'R', salary_min: 'R 500,000', salary_max: 600000 }),
      'Salary R 500,000 to R 600,000 a year.',
    );

    // The figure is left exactly as it came, so validation refuses it and the
    // caller spends its retry: the same as any sign this app does not know.
    expect(value['salary_min']).toBe('R 500,000');
    expect(applied).not.toContain('salary_min:string-to-number');
    expect(value['salary_currency']).toBeNull();
    expect(applied).toContain('salary_currency:unrecognised-to-null');
    // Never quietly another currency.
    expect(value['salary_currency']).not.toBe('BRL');
  });
});

describe('a salary the model wrote as text with its sign in front', () => {
  it.each([...NEW_SIGNS.map(([sign]) => sign), 'CHF'])('reads %s90,000 as 90000', (sign) => {
    const tight = clamped(reply({ salary_min: `${sign}90,000` }), 'Salary 90,000');
    expect(tight.value['salary_min']).toBe(90000);
    expect(tight.applied).toContain('salary_min:string-to-number');

    const spaced = clamped(reply({ salary_min: `${sign} 90,000` }), 'Salary 90,000');
    expect(spaced.value['salary_min']).toBe(90000);
  });

  it.each(OLD_SIGNS.map(([sign]) => sign))('regression: still reads %s45,000', (sign) => {
    expect(clamped(reply({ salary_min: `${sign}45,000` }), 'x').value['salary_min']).toBe(45000);
  });

  it('negative: a sign is only read at the front — "90,000 A$" is left as it came', () => {
    // The same rule the four old signs follow: a partial match is a guess.
    expect(clamped(reply({ salary_min: '90,000 A$' }), 'x').value['salary_min']).toBe('90,000 A$');
    expect(clamped(reply({ salary_min: 'about A$90,000' }), 'x').value['salary_min']).toBe(
      'about A$90,000',
    );
  });
});

describe('hasMoneyFigure — a figure in one of the new currencies is still a figure', () => {
  it.each([
    '₹1500000 per annum',
    '₹ 1500000',
    'CHF 120000',
    '15000 zł',
    'SGD 90000',
    'BRL 96000',
    'MXN 400000',
    'INR 1500000',
    'PLN 180000',
    'ZAR 500000',
  ])('finds %s', (text) => {
    expect(hasMoneyFigure(text)).toBe(true);
  });

  it('negative: a small number beside ordinary words is still not money', () => {
    expect(hasMoneyFigure('5 years of experience, 3 days on site')).toBe(false);
    // "R" alone is not a sign, here either.
    expect(hasMoneyFigure('Grade R 5 teaching post')).toBe(false);
  });

  it('a "competitive" advert that also quotes rupees keeps its number', () => {
    // Without the figure being seen, the blank-value rule would overrule the
    // model and null a salary the advert plainly states.
    const { value } = clamped(
      reply({ salary_currency: '₹', salary_min: 1500000, salary_max: 1500000 }),
      'A competitive salary of ₹1500000 per annum.',
    );
    expect(value['salary_min']).toBe(1500000);
    expect(value['salary_currency']).toBe('INR');
  });
});
