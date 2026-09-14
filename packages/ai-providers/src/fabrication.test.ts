/**
 * The fabrication check is the guarantee behind `NO_FABRICATION`, so every
 * kind of invention it can name is proved here both ways: flagged when new,
 * silent when the original supports it.
 */
import { describe, expect, it } from 'vitest';

import { type CoverLetter, type TailoredCv } from '@cviper/core-types';

import { METRIC_PATTERN, checkFabrication, checkLetterClaims } from './fabrication';

const ORIGINAL = `Steve Brady
Senior Credit Risk Analyst, Lloyds Banking Group, London, Jan 2020 – Present
- Built IFRS 9 impairment models in Python, cutting run time by 40%.
- Reported to the CRO across a £2bn book.
Analyst, Barclays, 2016 – 2019
- Ran stress tests for 12 portfolios.
BSc Mathematics, University of Leeds, 2016
FRM (Financial Risk Manager), GARP, 2021`;

function faithful(): TailoredCv {
  return {
    summary: 'Credit risk analyst who cut model run time by 40% on a £2bn book.',
    key_skills: ['Python', 'IFRS 9', 'Stress testing'],
    experience: [
      {
        title: 'Senior Credit Risk Analyst',
        company: 'Lloyds Banking Group',
        location: 'London',
        dates: 'Jan 2020 – Present',
        bullets: ['Built IFRS 9 impairment models in Python, cutting run time by 40%.'],
      },
      {
        title: 'Analyst',
        company: 'Barclays',
        location: '',
        dates: '2016 – 2019',
        bullets: ['Ran stress tests for 12 portfolios.'],
      },
    ],
    education: ['BSc Mathematics, University of Leeds, 2016'],
    certifications: ['FRM (Financial Risk Manager), GARP, 2021'],
  };
}

describe('checkFabrication — happy path', () => {
  it('passes a CV that only says what the original said', () => {
    const report = checkFabrication(ORIGINAL, faithful());
    expect(report.clean).toBe(true);
    expect(report.flagged).toEqual([]);
  });

  it('boundary: a company present in the original under different casing and spacing is not flagged', () => {
    const cv = faithful();
    cv.experience[0]!.company = 'LLOYDS   Banking\nGroup';
    const report = checkFabrication(ORIGINAL, cv);
    expect(report.flagged.filter((flag) => flag.kind === 'employer')).toEqual([]);
  });

  it('boundary: a "2019 – Present" dates string flags nothing when both years are in the original', () => {
    const cv = faithful();
    cv.experience[1]!.dates = '2019 – Present';
    expect(checkFabrication(ORIGINAL, cv).flagged.filter((f) => f.kind === 'date')).toEqual([]);
  });
});

describe('checkFabrication — negative paths', () => {
  it('flags an employer the original never mentions', () => {
    const cv = faithful();
    cv.experience.push({
      title: 'Consultant',
      company: 'Goldman Sachs',
      location: 'London',
      dates: '2014 – 2016',
      bullets: [],
    });
    const report = checkFabrication(ORIGINAL, cv);
    expect(report.clean).toBe(false);
    expect(report.flagged).toContainEqual({ kind: 'employer', text: 'Goldman Sachs' });
    // 2014 is a new year too, and it is reported once as a date, not again as a metric.
    expect(report.flagged).toContainEqual({ kind: 'date', text: '2014' });
    expect(report.flagged.filter((flag) => flag.text === '2014')).toHaveLength(1);
  });

  it('flags a four-digit year in a dates string that the original does not have', () => {
    const cv = faithful();
    cv.experience[1]!.dates = '2015 – 2019';
    expect(checkFabrication(ORIGINAL, cv).flagged).toContainEqual({ kind: 'date', text: '2015' });
  });

  it('flags a certification whose first three words are not in the original', () => {
    const cv = faithful();
    cv.certifications.push('AWS Certified Solutions Architect, 2021');
    expect(checkFabrication(ORIGINAL, cv).flagged).toContainEqual({
      kind: 'certification',
      text: 'AWS Certified Solutions Architect, 2021',
    });
  });

  it('flags a metric that is new ("60%") and not one that is present ("40%")', () => {
    const cv = faithful();
    cv.experience[0]!.bullets.push('Improved forecast accuracy by 60%.');
    const report = checkFabrication(ORIGINAL, cv);
    expect(report.flagged).toContainEqual({ kind: 'metric', text: '60%' });
    expect(report.flagged.some((flag) => flag.text === '40%')).toBe(false);
  });

  it('reports a repeated new metric once', () => {
    const cv = faithful();
    cv.summary = 'Saved £3m. Then saved £3m again.';
    const flagged = checkFabrication(ORIGINAL, cv).flagged.filter((f) => f.kind === 'metric');
    expect(flagged.map((flag) => flag.text)).toEqual(['3m']);
  });

  it('boundary: an empty original flags every employer, year, certification and metric', () => {
    const report = checkFabrication('', faithful());
    expect(report.clean).toBe(false);
    const kinds = new Set(report.flagged.map((flag) => flag.kind));
    expect(kinds).toEqual(new Set(['employer', 'date', 'certification', 'metric']));
  });

  it('boundary: a blank company or certification is skipped rather than flagged as an invention', () => {
    const cv = faithful();
    cv.experience[1]!.company = '   ';
    cv.certifications.push('');
    const report = checkFabrication(ORIGINAL, cv);
    expect(
      report.flagged.filter((f) => f.kind === 'employer' || f.kind === 'certification'),
    ).toEqual([]);
  });
});

describe('METRIC_PATTERN', () => {
  it('keeps the unit on the token, which the source pattern could not', () => {
    const tokens = [
      ...'cut run time by 40%, 50k rows, 3+ years, $12 each'.matchAll(METRIC_PATTERN),
    ].map((m) => m[0]);
    expect(tokens).toEqual(['40%', '50k', '3+', '12']);
  });

  it('does not split a number embedded in a word or a longer number', () => {
    const tokens = [...'IFRS9 and v2 and 1,000,000 users'.matchAll(METRIC_PATTERN)].map(
      (m) => m[0],
    );
    expect(tokens).toEqual(['1,000,000']);
  });
});

describe('checkLetterClaims', () => {
  const letter: CoverLetter = {
    greeting: 'Dear Hiring Manager,',
    paragraphs: ['I cut model run time by 40% at Lloyds.', 'I also grew the team by 200%.'],
    sign_off: 'Yours sincerely,',
  };

  it('flags only the figures the original CV never gave', () => {
    expect(checkLetterClaims(ORIGINAL, letter)).toEqual([{ kind: 'metric', text: '200%' }]);
  });

  it('boundary: a letter with no figures is clean', () => {
    expect(checkLetterClaims(ORIGINAL, { ...letter, paragraphs: ['No numbers here.'] })).toEqual(
      [],
    );
  });
});
