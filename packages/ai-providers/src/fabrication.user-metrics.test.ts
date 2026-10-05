/**
 * L-205: a number the candidate typed and approved is a user-supplied fact,
 * not an invention — but ONLY for metrics. An employer, year or certification
 * is still checked against the CV alone, so typing one cannot launder it.
 */
import { describe, expect, it } from 'vitest';

import type { TailoredCv } from '@cviper/core-types';

import { checkFabrication } from './fabrication';

const ORIGINAL = 'Jane Doe. Analyst at Acme Ltd, Jan 2020 - Present. Built dashboards.';

function cv(overrides: Partial<TailoredCv>): TailoredCv {
  return {
    summary: 'Analyst.',
    key_skills: ['Python'],
    experience: [
      {
        title: 'Analyst',
        company: 'Acme Ltd',
        location: '',
        dates: 'Jan 2020 - Present',
        bullets: ['Built dashboards.'],
      },
    ],
    education: [],
    certifications: [],
    ...overrides,
  };
}

describe('checkFabrication with user-supplied facts (L-205)', () => {
  const withMetric = cv({ summary: 'Cut reporting time by 40%.' });

  it('without the user fact the number is flagged (guard unchanged)', () => {
    expect(checkFabrication(ORIGINAL, withMetric).flagged).toEqual([
      { kind: 'metric', text: '40%' },
    ]);
  });

  it('happy: a number the user typed is not flagged', () => {
    expect(checkFabrication(ORIGINAL, withMetric, ['Cut reporting time by 40%']).clean).toBe(true);
  });

  it('negative: a different number is still flagged', () => {
    const report = checkFabrication(ORIGINAL, cv({ summary: 'Cut time by 90%.' }), [
      'Cut reporting time by 40%',
    ]);
    expect(report.flagged).toEqual([{ kind: 'metric', text: '90%' }]);
  });

  it('negative: typing an employer, year or certification does not legitimise it', () => {
    const forged = cv({
      experience: [
        {
          title: 'Analyst',
          company: 'Goldman Sachs',
          location: '',
          dates: '2015 - 2017',
          bullets: [],
        },
      ],
      certifications: ['CFA Level III'],
    });
    const kinds = checkFabrication(ORIGINAL, forged, [
      'Worked at Goldman Sachs 2015 - 2017 and passed CFA Level III',
    ]).flagged.map((flag) => flag.kind);
    expect(kinds).toEqual(expect.arrayContaining(['employer', 'date', 'certification']));
  });

  it('boundary: an empty list or empty strings change nothing', () => {
    expect(checkFabrication(ORIGINAL, withMetric, []).clean).toBe(false);
    expect(checkFabrication(ORIGINAL, withMetric, ['', '  ']).clean).toBe(false);
  });
});
