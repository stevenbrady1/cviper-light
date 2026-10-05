/**
 * L-205 re-review N2 and N3: identifier numbers (certifications, levels, short
 * years) and "years of experience" are never laundered by user-supplied text.
 */
import { describe, expect, it } from 'vitest';

import type { TailoredCv } from '@cviper/core-types';

import { checkFabrication } from './fabrication';

const ORIGINAL = 'Jane Doe. Analyst at Acme Ltd, Jan 2020 - Present. Built dashboards.';

function cv(summary: string): TailoredCv {
  return {
    summary,
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
  };
}

const flagged = (summary: string, user: string) =>
  checkFabrication(ORIGINAL, cv(summary), [user]).flagged.map((f) => f.text);

describe('N2: identifier numbers are not figures', () => {
  it.each([
    ['ISO-27001', 'Led ISO-27001 work.', ['27001']],
    ['Level-3', 'Holds Level-3.', ['3']],
    ['ISO 9001 and 14001', 'Holds ISO 9001 and 14001.', ['9001', '14001']],
    ['Series 7 and 63', 'Passed Series 7 and 63.', ['7', '63']],
    ['NVQ 3, Tier 2, Band 7', 'NVQ 3, Tier 2, Band 7 achieved.', ['3', '2', '7']],
    ['Stage 4 and Year 5', 'Reached Stage 4 and Year 5.', ['4', '5']],
    ["since '19", "Working since '19.", ['19']],
  ])('typed %j is not whitelisted', (typed, summary, expected) => {
    const text = `Did ${typed} and cut costs 41%`;
    expect(flagged(summary, text)).toEqual(expect.arrayContaining(expected));
  });

  it('the real figure in the same line still passes', () => {
    expect(flagged('Cut costs 41%.', 'Did ISO 9001 and 14001 and cut costs 41%')).toEqual([]);
  });
});

describe('N3: "years" next to a number the user did not call years', () => {
  const USER = 'Led a team of 12 and cut costs 41%';

  it('"team of 12" no longer makes "12 years" pass', () => {
    expect(flagged('12 years of experience.', USER)).toEqual(['12']);
    expect(flagged('12 yrs in banking.', USER)).toEqual(['12']);
  });

  it('negative: the same number as a team size still passes', () => {
    expect(flagged('Led a team of 12.', USER)).toEqual([]);
  });

  it('boundary: when the user wrote years themselves, it passes', () => {
    expect(flagged('7 years of risk work.', 'Spent 7 years on risk')).toEqual([]);
  });

  it('boundary: a number that is in the original CV is not touched by this guard', () => {
    const original = `${ORIGINAL} Ran 12 desks.`;
    const report = checkFabrication(original, cv('12 years in banking.'), [USER]);
    expect(report.flagged).toEqual([]);
  });
});
