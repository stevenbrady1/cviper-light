/**
 * The salary line — and the half of the ported Reed bug that shows on screen.
 *
 * The failure being guarded against is not a crash. It is a good contract role
 * rendered as a terrible permanent one: `£457` read as an annual salary,
 * inflated by a looks-like-thousands guard to £457,000, and re-divided into
 * £1,987 a day. Nothing errors. The number is simply wrong, and it is wrong in
 * the direction that makes a user skip the job.
 *
 * `search.dayRate.test.tsx` drives the same fact through the whole screen.
 */
import { describe, expect, it } from 'vitest';

import { type Job } from '@cviper/core-types';

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

describe('a Reed day rate', () => {
  it('renders as a day rate, and never as an annual figure', () => {
    // The exact figures from the source comment in `reed-salary.ts`.
    const line = formatSalary(salary({ salary_min: 457, salary_max: 550, salary_period: 'day' }));

    expect(line).toBe('£457–£550 per day');
    expect(line).not.toContain('per year');
    // The inflated forms the original produced. If any of these ever appears,
    // the period has been dropped somewhere between the parser and the screen.
    expect(line).not.toContain('457,000');
    expect(line).not.toContain('1,987');
  });

  it('renders a single day rate without inventing a range', () => {
    expect(formatSalary(salary({ salary_min: 500, salary_max: null, salary_period: 'day' }))).toBe(
      '£500 per day',
    );
  });

  it('boundary: a range whose ends are equal is one figure, not a range', () => {
    // Reed sends this constantly, and "£500–£500 per day" reads as a bug.
    expect(formatSalary(salary({ salary_min: 500, salary_max: 500, salary_period: 'day' }))).toBe(
      '£500 per day',
    );
  });

  it('boundary: a figure at the day-rate ceiling is still whatever the data says', () => {
    // `DAY_RATE_CEILING` is 2000 and the classification happens upstream. This
    // module states what it is given; it never re-decides the unit.
    expect(formatSalary(salary({ salary_min: 1999, salary_period: 'day' }))).toBe('£1,999 per day');
    expect(formatSalary(salary({ salary_min: 2000, salary_period: 'year' }))).toBe(
      '£2,000 per year',
    );
  });
});

describe('an annual salary', () => {
  it('groups the digits so two figures can be compared down a column', () => {
    expect(
      formatSalary(salary({ salary_min: 65000, salary_max: 80000, salary_period: 'year' })),
    ).toBe('£65,000–£80,000 per year');
  });

  it('boundary: groups at exactly four digits and not at three', () => {
    expect(formatSalary(salary({ salary_min: 1000, salary_period: 'year' }))).toBe(
      '£1,000 per year',
    );
    expect(formatSalary(salary({ salary_min: 999, salary_period: 'day' }))).toBe('£999 per day');
  });

  it('boundary: groups a seven-figure number correctly', () => {
    expect(formatSalary(salary({ salary_min: 1234567, salary_period: 'year' }))).toBe(
      '£1,234,567 per year',
    );
  });
});

describe('what is not said', () => {
  it('states no period when the source did not give one', () => {
    // Adding "per year" here because most salaries are annual is exactly the
    // assumption that produced the Reed bug.
    const line = formatSalary(salary({ salary_min: 45000, salary_period: null }));

    expect(line).toBe('£45,000');
    expect(line).not.toContain('per');
  });

  it('negative: reports nothing at all when there are no figures', () => {
    expect(formatSalary(salary({}))).toBeNull();
    expect(formatSalary(salary({ salary_period: 'day', salary_currency: 'GBP' }))).toBeNull();
  });

  it('negative: a zero or a negative is not a salary', () => {
    expect(formatSalary(salary({ salary_min: 0, salary_max: 0 }))).toBeNull();
    expect(formatSalary(salary({ salary_min: -5, salary_period: 'day' }))).toBeNull();
  });

  it('negative: a figure that will not read is treated as absent', () => {
    // The column is REAL in SQLite and a hand-edited backup can put anything in
    // it. `NaN` would otherwise render as "£NaN".
    expect(formatSalary(salary({ salary_min: Number.NaN }))).toBeNull();
    expect(formatSalary(salary({ salary_min: Number.POSITIVE_INFINITY }))).toBeNull();
  });

  it('uses only the readable half when one end of the range is unusable', () => {
    expect(formatSalary(salary({ salary_min: 0, salary_max: 550, salary_period: 'day' }))).toBe(
      '£550 per day',
    );
  });
});

describe('currency', () => {
  it('uses a symbol where there is one worth using', () => {
    expect(formatSalary(salary({ salary_min: 50000, salary_currency: 'USD' }))).toBe('$50,000');
    expect(formatSalary(salary({ salary_min: 50000, salary_currency: 'EUR' }))).toBe('€50,000');
  });

  it('keeps the ISO code for a currency with no symbol of its own', () => {
    // Never silently render an Australian figure with a pound sign.
    expect(formatSalary(salary({ salary_min: 90000, salary_currency: 'AUD' }))).toBe('AUD 90,000');
  });

  it('boundary: a missing currency shows the bare figure rather than guessing', () => {
    expect(formatSalary(salary({ salary_min: 90000, salary_currency: null }))).toBe('90,000');
  });
});

describe('the spoken form', () => {
  it('says "to" rather than a dash, which several screen readers skip entirely', () => {
    // "£457–£550 per day" read aloud as "457 550 per day" is a different and
    // much worse claim than the one on screen.
    expect(describeSalary(salary({ salary_min: 457, salary_max: 550, salary_period: 'day' }))).toBe(
      '£457 to £550 per day',
    );
  });

  it('says so out loud when there is no salary', () => {
    expect(describeSalary(salary({}))).toBe('Salary not stated');
  });
});

describe('every period the data model allows', () => {
  it('has words of its own', () => {
    // Keyed by the union, so a period added to `SalaryPeriod` upstream is a
    // compile error here rather than a figure that silently loses its unit.
    const periods: readonly NonNullable<Job['salary_period']>[] = ['year', 'day', 'hour'];

    for (const period of periods) {
      const line = formatSalary(salary({ salary_min: 100, salary_period: period })) ?? '';
      expect(line).toContain(period);
    }
  });
});
