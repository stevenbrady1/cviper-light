/**
 * L-205: a number the candidate typed and approved is a user-supplied fact,
 * not an invention — but ONLY for metrics. An employer, year or certification
 * is still checked against the CV alone, so typing one cannot launder it.
 */
import { describe, expect, it } from 'vitest';

import type { TailoredCv } from '@cviper/core-types';

import { checkFabrication, checkLetterClaims } from './fabrication';

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
    const flagged = checkFabrication(ORIGINAL, forged, [
      'Worked at Goldman Sachs 2015 - 2017 and passed CFA Level III',
    ]).flagged;
    expect(flagged).toEqual(
      expect.arrayContaining([
        { kind: 'employer', text: 'Goldman Sachs' },
        { kind: 'date', text: '2015' },
        { kind: 'date', text: '2017' },
        { kind: 'certification', text: 'CFA Level III' },
      ]),
    );
  });

  it('boundary: an empty list or empty strings change nothing', () => {
    expect(checkFabrication(ORIGINAL, withMetric, []).clean).toBe(false);
    expect(checkFabrication(ORIGINAL, withMetric, ['', '  ']).clean).toBe(false);
  });

  describe('C2: only FIGURES are whitelisted, never years or certification numbers', () => {
    const USER = 'Cut cloud costs 37% at Google in 2019 as ISO 27001 lead, team of 12';

    it('a year and an ISO number the user typed are still flagged in the summary', () => {
      const flagged = checkFabrication(
        ORIGINAL,
        cv({ summary: 'Engineer who led ISO 27001 in 2019.' }),
        [USER],
      ).flagged;
      expect(flagged).toEqual([
        { kind: 'metric', text: '27001' },
        { kind: 'metric', text: '2019' },
      ]);
    });

    it('a typed year is still flagged in an education line', () => {
      const flagged = checkFabrication(ORIGINAL, cv({ education: ['BSc, 2019'] }), [USER]).flagged;
      expect(flagged).toEqual([{ kind: 'metric', text: '2019' }]);
    });

    it('the figure the user really gave still passes', () => {
      expect(
        checkFabrication(ORIGINAL, cv({ summary: 'Cut cloud costs 37%.' }), [USER]).clean,
      ).toBe(true);
    });

    it('a number typed after Series/Level is not whitelisted', () => {
      const flagged = checkFabrication(ORIGINAL, cv({ summary: 'Holds Series 7 and Level 3.' }), [
        'Passed Series 7 and Level 3 exams',
      ]).flagged;
      expect(flagged.map((f) => f.text)).toEqual(['7', '3']);
    });

    it('"team of 12" no longer whitelists "12 years" (see N3)', () => {
      const report = checkFabrication(ORIGINAL, cv({ summary: '12 years of experience.' }), [USER]);
      expect(report.flagged).toEqual([{ kind: 'metric', text: '12' }]);
    });

    it('KNOWN LIMIT: otherwise it is a bag of numbers - "12" as a team size passes as 12 clients', () => {
      // Documented, not endorsed: matching a figure to its context needs a
      // language model. The prompt tells the model to use a line as given.
      const report = checkFabrication(ORIGINAL, cv({ summary: 'Advised 12 clients.' }), [USER]);
      expect(report.clean).toBe(true);
    });

    it('checkLetterClaims accepts the same figures and still rejects the year', () => {
      const letter = {
        greeting: 'Dear Hiring Manager,',
        paragraphs: ['I cut cloud costs 37% in 2019.'],
        sign_off: 'Yours sincerely,',
      };
      expect(checkLetterClaims(ORIGINAL, letter, [USER])).toEqual([
        { kind: 'metric', text: '2019' },
      ]);
      expect(checkLetterClaims(ORIGINAL, letter)).toHaveLength(2);
    });
  });
});
