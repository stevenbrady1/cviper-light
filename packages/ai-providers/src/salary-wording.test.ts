import { describe, expect, it } from 'vitest';

import {
  BLANK_VALUE_PATTERNS,
  NON_ANNUAL_PATTERNS,
  blankValueSalaryWording,
  hasMoneyFigure,
  nonAnnualSalaryWording,
  salaryWordingSnippet,
} from './salary-wording';

describe('nonAnnualSalaryWording — pay that is not a yearly figure', () => {
  it('reads a day rate written with a slash', () => {
    expect(nonAnnualSalaryWording('Contract role at £650/day inside IR35.')).toBe('daily');
  });

  it('reads a day rate written out', () => {
    expect(nonAnnualSalaryWording('The rate is £750 per day, outside IR35.')).toBe('daily');
  });

  it('reads "day rate" and "daily rate" as phrases', () => {
    expect(nonAnnualSalaryWording('Day rate: £500.')).toBe('daily');
    expect(nonAnnualSalaryWording('A daily rate of £500 is on offer.')).toBe('daily');
  });

  it('reads an hourly rate in all three of the source’s spellings', () => {
    expect(nonAnnualSalaryWording('£50/hour')).toBe('hourly');
    expect(nonAnnualSalaryWording('£35 per hour')).toBe('hourly');
    expect(nonAnnualSalaryWording('£25/hr')).toBe('hourly');
  });

  it('reads "an hour" and "hourly rate"', () => {
    expect(nonAnnualSalaryWording('Paid £22 an hour.')).toBe('hourly');
    expect(nonAnnualSalaryWording('The hourly rate is under review.')).toBe('hourly');
  });

  it('reads pro rata however it is spelled — THE GAP THE SOURCE HAS NO COVERAGE FOR', () => {
    // Grepped across the whole source repo: `pro rata` appears nowhere in the
    // backend, the frontend or the e2e specs. `normalize_salary("£45,000 pro
    // rata")` reads 45000 as a full annual salary.
    expect(nonAnnualSalaryWording('£45,000 pro rata')).toBe('pro-rata');
    expect(nonAnnualSalaryWording('£45,000 pro-rata')).toBe('pro-rata');
    expect(nonAnnualSalaryWording('£45,000 prorata for 3 days a week')).toBe('pro-rata');
    expect(nonAnnualSalaryWording('£45,000 PRO RATA')).toBe('pro-rata');
  });

  it('says nothing about a plain annual salary', () => {
    expect(nonAnnualSalaryWording('£45,000 - £55,000 per annum plus benefits.')).toBeNull();
    expect(nonAnnualSalaryWording('£45k-£55k')).toBeNull();
  });

  // ── The false positives that would make this rule worse than useless ─────
  // Each of these appears in ordinary London finance adverts, and each would
  // silently null a perfectly good annual salary if the source's whole-string
  // patterns were ported unchanged onto a whole advert.

  it('does not read "daily stand-ups" as a day rate', () => {
    expect(
      nonAnnualSalaryWording('£85,000. The team runs daily stand-ups and weekly planning.'),
    ).toBeNull();
  });

  it('does not read "day-to-day" as a day rate', () => {
    expect(nonAnnualSalaryWording('£90,000. You own the day-to-day risk reporting.')).toBeNull();
  });

  it('does not read "hours" or "flexible hours" as an hourly rate', () => {
    expect(nonAnnualSalaryWording('£70,000 with flexible hours and 25 days leave.')).toBeNull();
    expect(nonAnnualSalaryWording('Core hours are 10am to 4pm.')).toBeNull();
  });

  it('boundary: empty and whitespace-only text says nothing', () => {
    expect(nonAnnualSalaryWording('')).toBeNull();
    expect(nonAnnualSalaryWording('   \n  ')).toBeNull();
  });

  it('reports the FIRST kind it finds, so a mixed advert still clamps', () => {
    // Whichever fires, the outcome is the same: the salary fields go null.
    expect(
      nonAnnualSalaryWording('£500 per day, or £45,000 pro rata if permanent.'),
    ).not.toBeNull();
  });
});

describe('blankValueSalaryWording — money described in words, not numbers', () => {
  it('reads every pattern the source app lists', () => {
    // salary_utils.py line 140: competitive, negotiable, DOE, depending,
    // not specified, TBD, market rate.
    expect(blankValueSalaryWording('Competitive salary and bonus.')).not.toBeNull();
    expect(blankValueSalaryWording('Salary negotiable.')).not.toBeNull();
    expect(blankValueSalaryWording('Salary: DOE')).not.toBeNull();
    expect(blankValueSalaryWording('Salary depending on experience.')).not.toBeNull();
    expect(blankValueSalaryWording('Salary not specified.')).not.toBeNull();
    expect(blankValueSalaryWording('Salary: TBD')).not.toBeNull();
    expect(blankValueSalaryWording('We pay the market rate.')).not.toBeNull();
  });

  it('reads "excellent"/"attractive" only when they describe the money', () => {
    expect(blankValueSalaryWording('An excellent package awaits.')).not.toBeNull();
    expect(blankValueSalaryWording('An attractive salary is on offer.')).not.toBeNull();
  });

  it('does NOT read "excellent communication skills" as a salary', () => {
    // The source anchors these with `^excellent`, which is safe on a five-word
    // salary field and catastrophic on a whole advert: nearly every London
    // finance advert asks for excellent communication skills.
    expect(
      blankValueSalaryWording('£95,000. Excellent communication skills are essential.'),
    ).toBeNull();
  });

  it('does NOT read a surname as DOE', () => {
    // `\bdoe\b` case-insensitively matches "John Doe" in a signature block.
    expect(blankValueSalaryWording('Best regards, John Doe, Principal Consultant.')).toBeNull();
  });

  it('says nothing about an advert that quotes a figure', () => {
    expect(blankValueSalaryWording('£45,000 - £55,000 per annum.')).toBeNull();
  });

  it('boundary: empty text says nothing', () => {
    expect(blankValueSalaryWording('')).toBeNull();
  });
});

describe('hasMoneyFigure — is there a number that could be pay at all', () => {
  it('finds currency-anchored figures', () => {
    expect(hasMoneyFigure('£650 per day')).toBe(true);
    expect(hasMoneyFigure('$80,000')).toBe(true);
    expect(hasMoneyFigure('€60,000')).toBe(true);
    expect(hasMoneyFigure('GBP 95000')).toBe(true);
  });

  it('finds k-suffixed and comma-grouped figures', () => {
    expect(hasMoneyFigure('pays 45k to 55k')).toBe(true);
    expect(hasMoneyFigure('Salary 45,000')).toBe(true);
  });

  it('does not treat a bare small number as money', () => {
    expect(hasMoneyFigure('5 years of experience, 3 days on site')).toBe(false);
  });

  it('boundary: empty text has no figure', () => {
    expect(hasMoneyFigure('')).toBe(false);
  });
});

describe('salaryWordingSnippet — the raw wording, kept for the user to read', () => {
  it('returns the sentence a day rate lives in', () => {
    const snippet = salaryWordingSnippet(
      'Great role. The rate is £750 per day, outside IR35. Apply now.',
    );
    expect(snippet).toContain('£750 per day');
    expect(snippet).not.toContain('Apply now');
  });

  it('returns the line a pro-rata figure lives in', () => {
    const snippet = salaryWordingSnippet('Part time.\nSalary £45,000 pro rata\nCity of London');
    expect(snippet).toBe('Salary £45,000 pro rata');
  });

  it('returns the blank-value wording when there is no figure at all', () => {
    const snippet = salaryWordingSnippet('Competitive salary, DOE.');
    expect(snippet).toContain('Competitive salary');
  });

  it('returns null when nothing awkward was said about pay', () => {
    expect(salaryWordingSnippet('£45,000 - £55,000 per annum.')).toBeNull();
  });

  it('boundary: caps a runaway "sentence" rather than pasting an advert into a field', () => {
    const long = `${'x'.repeat(500)} £650 per day ${'y'.repeat(500)}`;
    const snippet = salaryWordingSnippet(long) ?? '';
    expect(snippet.length).toBeLessThanOrEqual(200);
    expect(snippet).toContain('£650 per day');
  });

  it('boundary: empty text has no snippet', () => {
    expect(salaryWordingSnippet('')).toBeNull();
  });
});

describe('the pattern lists are documented, not anonymous', () => {
  it('every pattern says what it is for', () => {
    for (const entry of [...BLANK_VALUE_PATTERNS, ...NON_ANNUAL_PATTERNS]) {
      expect(entry.matches.length).toBeGreaterThan(0);
    }
  });

  it('no pattern is stateful — a `g` flag here would poison the next caller', () => {
    // `.test()` on a `g` regex moves `lastIndex`, so a shared module-level
    // pattern would answer differently on alternate calls. These are read with
    // `.test()`, so none of them may carry `g`.
    for (const entry of [...BLANK_VALUE_PATTERNS, ...NON_ANNUAL_PATTERNS]) {
      expect(entry.pattern.global, `${entry.pattern.source} must not be global`).toBe(false);
    }
  });

  it('calling twice gives the same answer', () => {
    const text = '£650 per day';
    expect(nonAnnualSalaryWording(text)).toBe(nonAnnualSalaryWording(text));
    expect(hasMoneyFigure(text)).toBe(hasMoneyFigure(text));
  });
});
