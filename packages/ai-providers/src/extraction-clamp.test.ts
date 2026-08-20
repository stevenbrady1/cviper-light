import { describe, expect, it } from 'vitest';

import { JobExtractionSchema } from '@cviper/core-types';

import { clampExtraction } from './extraction-clamp';

/** A model reply with every field present and sane. */
function goodReply(): Record<string, unknown> {
  return {
    title: 'Credit Risk Analyst',
    company: 'Lloyds Banking Group',
    location: 'City of London',
    url: 'https://example.invalid/1',
    description: 'Second-line credit risk.',
    posted_date: '2026-08-18',
    salary_currency: 'GBP',
    salary_min: 45000,
    salary_max: 55000,
  };
}

/** Clamp, then read the value as a record. */
function clamped(
  raw: unknown,
  source: string,
): { value: Record<string, unknown>; applied: readonly string[] } {
  const result = clampExtraction(raw, source);
  return { value: result.value as Record<string, unknown>, applied: result.applied };
}

describe('clampExtraction — filling in what a small model left out', () => {
  it('turns an absent field into null so the review form has one state', () => {
    const { value, applied } = clamped({ title: 'Analyst' }, 'Analyst wanted.');
    expect(value['company']).toBeNull();
    expect(value['posted_date']).toBeNull();
    expect(applied).toContain('company:absent-to-null');
  });

  it('collapses an empty string into null — the source’s _normalise_email_fields rule', () => {
    const { value, applied } = clamped({ ...goodReply(), title: '', location: '   ' }, 'x');
    expect(value['title']).toBeNull();
    expect(value['location']).toBeNull();
    expect(applied).toContain('title:blank-to-null');
  });

  it('trims a field the model padded', () => {
    const { value } = clamped({ ...goodReply(), title: '  Analyst  ' }, 'x');
    expect(value['title']).toBe('Analyst');
  });

  it('produces something the schema accepts, from almost nothing', () => {
    const { value } = clamped({}, '');
    expect(JobExtractionSchema.safeParse(value).success).toBe(true);
  });

  it('never mutates the caller’s object', () => {
    const raw = { title: '  Analyst  ' };
    clampExtraction(raw, 'x');
    expect(raw.title).toBe('  Analyst  ');
  });

  it('leaves a non-object alone so validation fails and buys the retry', () => {
    expect(clampExtraction('not an object', 'x').value).toBe('not an object');
    expect(clampExtraction(null, 'x').applied).toEqual([]);
  });
});

describe('clampExtraction — salary near-misses', () => {
  it('reads a numeric string as a number', () => {
    const { value, applied } = clamped({ ...goodReply(), salary_min: '45000' }, 'Salary £45,000');
    expect(value['salary_min']).toBe(45000);
    expect(applied).toContain('salary_min:string-to-number');
  });

  it('reads a comma-grouped and currency-prefixed string', () => {
    const { value } = clamped({ ...goodReply(), salary_min: '£45,000' }, 'Salary £45,000');
    expect(value['salary_min']).toBe(45000);
  });

  it('rounds a fractional salary rather than refusing it', () => {
    const { value, applied } = clamped({ ...goodReply(), salary_max: 55000.4 }, 'Salary £55,000');
    expect(value['salary_max']).toBe(55000);
    expect(applied).toContain('salary_max:rounded');
  });

  it('drops a negative salary — nobody is paid minus forty thousand', () => {
    const { value, applied } = clamped({ ...goodReply(), salary_min: -45000 }, 'Salary £45,000');
    expect(value['salary_min']).toBeNull();
    expect(applied).toContain('salary_min:negative-to-null');
  });

  it('maps a currency symbol to its ISO code', () => {
    const { value, applied } = clamped({ ...goodReply(), salary_currency: '£' }, 'Salary £45,000');
    expect(value['salary_currency']).toBe('GBP');
    expect(applied).toContain('salary_currency:symbol-to-code');
  });

  it('upper-cases a lowercase code', () => {
    const { value } = clamped({ ...goodReply(), salary_currency: 'gbp' }, 'Salary £45,000');
    expect(value['salary_currency']).toBe('GBP');
  });

  it('drops a currency it cannot recognise rather than storing rubbish', () => {
    const { value, applied } = clamped(
      { ...goodReply(), salary_currency: 'pounds sterling' },
      'Salary £45,000',
    );
    expect(value['salary_currency']).toBeNull();
    expect(applied).toContain('salary_currency:unrecognised-to-null');
  });

  it('drops a currency that has no figure to label', () => {
    const { value, applied } = clamped(
      { ...goodReply(), salary_min: null, salary_max: null },
      'No pay stated.',
    );
    expect(value['salary_currency']).toBeNull();
    expect(applied).toContain('salary_currency:no-figure-to-null');
  });

  it('leaves an unreadable salary alone so validation fails and buys the retry', () => {
    const { value } = clamped(
      { ...goodReply(), salary_min: 'about forty grand' },
      'Salary £45,000',
    );
    expect(value['salary_min']).toBe('about forty grand');
    expect(JobExtractionSchema.safeParse(value).success).toBe(false);
  });

  it('boundary: a zero salary is a real answer and survives', () => {
    const { value } = clamped({ ...goodReply(), salary_min: 0, salary_max: 0 }, 'Salary £0');
    expect(value['salary_min']).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE THREE BUILT GAPS. Each of these is behaviour the source app does NOT have.
// ─────────────────────────────────────────────────────────────────────────────

describe('GAP 1 — pro rata: salary fields null, raw wording preserved', () => {
  const ADVERT = 'Part-time Analyst.\nSalary £45,000 pro rata for 3 days a week.\nCity of London';

  it('nulls every salary field even though the model read a number', () => {
    // The source's `normalize_salary("£45,000 pro rata")` returns 45000 and
    // calls it a full annual salary. That is the bug this test exists for.
    const { value } = clamped({ ...goodReply(), salary_min: 45000, salary_max: 45000 }, ADVERT);
    expect(value['salary_min']).toBeNull();
    expect(value['salary_max']).toBeNull();
    expect(value['salary_currency']).toBeNull();
  });

  it('names the clamp so the reason is never a mystery', () => {
    const { applied } = clamped(goodReply(), ADVERT);
    expect(applied).toContain('salary:pro-rata-to-null');
  });

  it('preserves the raw wording in the description', () => {
    const { value } = clamped({ ...goodReply(), description: 'Second-line credit risk.' }, ADVERT);
    expect(String(value['description'])).toContain('£45,000 pro rata');
  });

  it('does not repeat wording the model already copied across', () => {
    const { value } = clamped(
      { ...goodReply(), description: 'Pays £45,000 pro rata for 3 days a week.' },
      ADVERT,
    );
    const description = String(value['description']);
    expect(description.match(/pro rata/gi) ?? []).toHaveLength(1);
  });

  it('writes the wording into an empty description rather than leaving it blank', () => {
    const { value } = clamped({ ...goodReply(), description: null }, ADVERT);
    expect(String(value['description'])).toContain('pro rata');
  });
});

describe('GAP 2 — day rates: salary fields null, raw wording preserved', () => {
  const ADVERT = 'Contract role. The rate is £750 per day, outside IR35. Canary Wharf.';

  it('nulls the salary rather than multiplying a day rate into a year', () => {
    // The source multiplies by 230 working days. `SalaryPeriod` in
    // `entities.ts` exists because this project already shipped that bug once.
    const { value, applied } = clamped(
      { ...goodReply(), salary_min: 750, salary_max: 750 },
      ADVERT,
    );
    expect(value['salary_min']).toBeNull();
    expect(value['salary_max']).toBeNull();
    expect(value['salary_currency']).toBeNull();
    expect(applied).toContain('salary:daily-to-null');
  });

  it('never produces 172,500 — the annualised figure the source would store', () => {
    const { value } = clamped({ ...goodReply(), salary_min: 172500, salary_max: 172500 }, ADVERT);
    expect(value['salary_min']).not.toBe(172500);
    expect(value['salary_min']).toBeNull();
  });

  it('preserves the raw wording in the description', () => {
    const { value } = clamped({ ...goodReply(), description: 'Contract risk role.' }, ADVERT);
    expect(String(value['description'])).toContain('£750 per day');
  });
});

describe('hourly rates — the same rule, ported rather than built', () => {
  it('nulls the salary and keeps the wording', () => {
    const advert = 'Temporary cover at £50/hour for six weeks.';
    const { value, applied } = clamped({ ...goodReply(), salary_min: 50 }, advert);
    expect(value['salary_min']).toBeNull();
    expect(applied).toContain('salary:hourly-to-null');
    expect(String(value['description'])).toContain('£50/hour');
  });
});

describe('the blank-value clamp — overruling a model that invented a number', () => {
  it('nulls a figure the advert never contained', () => {
    // The prompt tells the model to answer null. This is what happens when it
    // does not: a deterministic correction, not a hope.
    const advert = 'Credit Risk Analyst, City of London. Competitive salary and bonus.';
    const { value, applied } = clamped(
      { ...goodReply(), salary_min: 65000, salary_max: 75000 },
      advert,
    );
    expect(value['salary_min']).toBeNull();
    expect(value['salary_max']).toBeNull();
    expect(value['salary_currency']).toBeNull();
    expect(applied).toContain('salary:blank-value-to-null');
  });

  it('nulls an invented figure behind DOE', () => {
    const { value } = clamped({ ...goodReply(), salary_min: 60000 }, 'Analyst wanted. Salary: DOE');
    expect(value['salary_min']).toBeNull();
  });

  it('does NOT fire when the advert quotes a real figure alongside the word', () => {
    // "Competitive salary of £95,000" is competitive AND a number. Nulling it
    // would throw away the one fact the user wanted.
    const advert = 'A competitive salary of £95,000 plus bonus.';
    const { value } = clamped({ ...goodReply(), salary_min: 95000, salary_max: 95000 }, advert);
    expect(value['salary_min']).toBe(95000);
  });

  it('does NOT fire on an ordinary advert with a range', () => {
    const advert = 'Credit Risk Analyst. £45k-£55k depending on the desk.';
    const { value } = clamped({ ...goodReply(), salary_min: 45000, salary_max: 55000 }, advert);
    expect(value['salary_min']).toBe(45000);
    expect(value['salary_max']).toBe(55000);
    expect(value['salary_currency']).toBe('GBP');
  });

  it('preserves the blank-value wording so the empty box explains itself', () => {
    const advert = 'Credit Risk Analyst. Competitive salary, DOE.';
    const { value } = clamped({ ...goodReply(), description: 'Risk role.' }, advert);
    expect(String(value['description'])).toContain('Competitive');
  });
});

describe('GAP 3 — hybrid and remote wording stays in `location`, verbatim', () => {
  it('does not touch a location carrying work-mode wording', () => {
    // The source extracts "City of London (hybrid, 3 days on site)" down to
    // "City of London" and has no work-mode field at all, so the fact is lost.
    // Here the clamp is a no-op on `location` by design: whatever the model
    // copied across survives, and the PROMPT is what asks for it verbatim.
    const advert = 'Based in City of London (hybrid, 3 days on site).';
    const { value } = clamped(
      { ...goodReply(), location: 'City of London (hybrid, 3 days on site)' },
      advert,
    );
    expect(value['location']).toBe('City of London (hybrid, 3 days on site)');
  });

  it('keeps "Fully remote (UK)" exactly as written', () => {
    const { value } = clamped(
      { ...goodReply(), location: 'Fully remote (UK)' },
      'Fully remote (UK)',
    );
    expect(value['location']).toBe('Fully remote (UK)');
  });

  it('applies no location clamp of any kind', () => {
    const { applied } = clamped(
      { ...goodReply(), location: 'London (hybrid, 2 days on site)' },
      'London (hybrid, 2 days on site)',
    );
    expect(applied.filter((name) => name.startsWith('location:'))).toEqual([]);
  });
});
