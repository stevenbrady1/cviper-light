/**
 * Every currency a country search can stamp on a salary (L-415).
 *
 * Before L-415 every advert from a search was pounds. A search can now carry a
 * country, and its adverts carry that country's money, so the salary line has
 * to read correctly for each one — and must never show a bare "$" for a dollar
 * that is not the US one.
 */
import { describe, expect, it } from 'vitest';

import { ADZUNA_COUNTRIES, currencyFor } from '@cviper/job-apis';

import { describeSalary, formatSalary, type SalaryFields } from './salary';

function salary(fields: Partial<SalaryFields>): SalaryFields {
  return {
    salary_min: null,
    salary_max: null,
    salary_currency: 'GBP',
    salary_period: null,
    ...fields,
  };
}

const CURRENCIES = [...new Set(ADZUNA_COUNTRIES.map((country) => currencyFor(country)))];

/** The three with a symbol worth using; every other keeps its ISO code. */
const SYMBOL: Readonly<Record<string, string>> = { GBP: '£', EUR: '€', USD: '$' };

describe('the currencies a country search can stamp', () => {
  it('are these thirteen, typed out so a change to the table is seen here', () => {
    expect([...CURRENCIES].sort()).toEqual([
      'AUD',
      'BRL',
      'CAD',
      'CHF',
      'EUR',
      'GBP',
      'INR',
      'MXN',
      'NZD',
      'PLN',
      'SGD',
      'USD',
      'ZAR',
    ]);
  });

  it.each(CURRENCIES)('%s reads as a figure with its money beside it, seen and spoken', (code) => {
    const currency = code ?? '';
    const job = salary({
      salary_min: 65000,
      salary_max: 85000,
      salary_currency: currency,
      salary_period: 'year',
    });
    const mark = SYMBOL[currency] ?? `${currency} `;

    expect(formatSalary(job)).toBe(`${mark}65,000–${mark}85,000 per year`);
    expect(describeSalary(job)).toBe(`${mark}65,000 to ${mark}85,000 per year`);
  });

  it('only the US dollar is a bare "$": every other dollar says whose it is', () => {
    for (const currency of ['AUD', 'CAD', 'NZD', 'SGD', 'MXN']) {
      const line = formatSalary(salary({ salary_min: 90000, salary_currency: currency }));

      expect(line).toBe(`${currency} 90,000`);
      expect(line).not.toContain('$');
    }
  });

  it('boundary: a figure with no currency is shown bare, never as pounds', () => {
    const job = salary({ salary_min: 90000, salary_currency: null });

    expect(formatSalary(job)).toBe('90,000');
    expect(describeSalary(job)).toBe('90,000');
  });
});
