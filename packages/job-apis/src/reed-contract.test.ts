import { describe, expect, it } from 'vitest';

import { REED_CONTRACT_SIGNALS, classifyReedContractType } from './reed-contract';

describe('classifyReedContractType — tier 1, Reed says so', () => {
  it('takes Reed at its word when it names a contract', () => {
    expect(classifyReedContractType({ contractType: 'Contract' })).toBe('Contract');
  });

  it('reads temp and interim as contract too', () => {
    expect(classifyReedContractType({ contractType: 'Temporary' })).toBe('Contract');
    expect(classifyReedContractType({ contractType: 'Interim' })).toBe('Contract');
  });

  it('reads permanent as permanent', () => {
    expect(classifyReedContractType({ contractType: 'Permanent' })).toBe('Permanent');
  });

  it('repeats anything else Reed states verbatim rather than guessing', () => {
    expect(classifyReedContractType({ contractType: 'Apprenticeship' })).toBe('Apprenticeship');
  });

  it('tier 1 wins over every later signal', () => {
    // Reed's structured field is better evidence than advert prose.
    expect(
      classifyReedContractType({
        contractType: 'Permanent',
        jobTitle: 'Developer, outside IR35',
        maximumSalary: 600,
      }),
    ).toBe('Permanent');
  });
});

describe('classifyReedContractType — tier 2, signals in the advert text', () => {
  it('finds every listed signal', () => {
    for (const signal of REED_CONTRACT_SIGNALS) {
      expect(classifyReedContractType({ jobDescription: `Role offers ${signal} terms` })).toBe(
        'Contract',
      );
    }
  });

  it('reads the title as well as the description', () => {
    expect(classifyReedContractType({ jobTitle: 'Java Developer (Outside IR35)' })).toBe(
      'Contract',
    );
  });

  it('is case-insensitive, because advert prose is not consistent', () => {
    expect(classifyReedContractType({ jobDescription: 'DAY RATE negotiable' })).toBe('Contract');
  });
});

describe('classifyReedContractType — the deliberate omission', () => {
  it('REGRESSION: a "permanent contract" advert is Permanent, not Contract', () => {
    // The bare word "contract" is absent from the signal list ON PURPOSE.
    // Permanent adverts routinely say "permanent contract" / "employment
    // contract", and adding it turns every one of them into a day-rate role.
    expect(
      classifyReedContractType({
        jobTitle: 'Credit Risk Analyst',
        jobDescription: 'A permanent contract with a leading investment bank. Salary to 85,000.',
        maximumSalary: 85_000,
      }),
    ).toBe('Permanent');
  });

  it('an "employment contract" advert is Permanent too', () => {
    expect(
      classifyReedContractType({
        jobDescription: 'You will be offered a full employment contract from day one.',
        maximumSalary: 70_000,
      }),
    ).toBe('Permanent');
  });

  it('the bare word "contract" is not in the signal list', () => {
    // Asserted directly, so someone "tidying" the list has to delete a test
    // that explains why rather than silently reintroducing the bug.
    expect(REED_CONTRACT_SIGNALS).not.toContain('contract');
    expect(REED_CONTRACT_SIGNALS).toContain('contractor');
  });
});

describe('classifyReedContractType — tier 3, salary magnitude', () => {
  it('a maximum under the ceiling with no other evidence is a contract', () => {
    expect(classifyReedContractType({ maximumSalary: 550 })).toBe('Contract');
  });

  it('boundary: 1999 is a contract, 2000 is not', () => {
    expect(classifyReedContractType({ maximumSalary: 1999 })).toBe('Contract');
    expect(classifyReedContractType({ maximumSalary: 2000 })).toBe('Permanent');
  });

  it('boundary: zero and negative maxima fall through to Permanent', () => {
    expect(classifyReedContractType({ maximumSalary: 0 })).toBe('Permanent');
    expect(classifyReedContractType({ maximumSalary: -50 })).toBe('Permanent');
  });

  it('consults ONLY the maximum, unlike the period classifier', () => {
    // Source line 192 reads `maximumSalary` alone. A low minimum next to an
    // annual maximum is an annual advert.
    expect(classifyReedContractType({ minimumSalary: 500, maximumSalary: 90_000 })).toBe(
      'Permanent',
    );
  });
});

describe('classifyReedContractType — negative cases', () => {
  it('an empty job object is Permanent, the documented default', () => {
    expect(classifyReedContractType({})).toBe('Permanent');
  });

  it('treats a whitespace-only contractType as absent', () => {
    expect(classifyReedContractType({ contractType: '   ', maximumSalary: 600 })).toBe('Contract');
  });

  it('survives nulls in every field without throwing', () => {
    expect(
      classifyReedContractType({
        contractType: null,
        jobTitle: null,
        jobDescription: null,
        minimumSalary: null,
        maximumSalary: null,
      }),
    ).toBe('Permanent');
  });

  it('survives a maximum that is not a number', () => {
    expect(classifyReedContractType({ maximumSalary: 'lots' as unknown as number })).toBe(
      'Permanent',
    );
    expect(classifyReedContractType({ maximumSalary: '550' as unknown as number })).toBe(
      'Contract',
    );
  });
});
