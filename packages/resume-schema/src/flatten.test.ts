import { describe, expect, it } from 'vitest';

import { flattenJsonResume } from './flatten';
import { parseJsonResume } from './parse';
import { FULL_RESUME, FULL_RESUME_TEXT } from './test/fixtures';

function flatten(text: string): string {
  const result = parseJsonResume(text);
  if (!result.ok) throw new Error(result.error.message);
  return flattenJsonResume(result.value);
}

describe('flattenJsonResume', () => {
  it('renders the full résumé in a fixed, readable order', () => {
    // Pinned in full. A change here is a change to every imported CV, so it
    // must be a deliberate one.
    expect(flatten(FULL_RESUME_TEXT)).toBe(
      [
        'Jane Smith',
        'Senior Credit Risk Analyst',
        'jane@example.com · +44 7700 900123 · https://janesmith.example.com · London, England, EC2A 1AA, GB',
        'LinkedIn: janesmith https://linkedin.example.com/in/janesmith',
        'GitHub: jsmith',
        '',
        'Summary',
        'Ten years modelling credit risk for UK retail banks. Python, SQL and a calm head.',
        '',
        'Experience',
        'Senior Credit Risk Analyst, Acme Bank (2019-03 – Present)',
        'Own the IFRS 9 impairment models for the unsecured lending book.',
        '- Cut model run time by 40 % by moving the pipeline from SAS to Python.',
        '- Led the 2023 model validation with no material findings.',
        '',
        'Credit Risk Analyst, Beta Building Society (2014-09 – 2019-02)',
        'Scorecard development and monitoring.',
        '',
        'Volunteering',
        'Volunteer tutor, Code Club (2020 – Present)',
        'Weekly Python sessions for 9–11 year olds.',
        '- Wrote the club’s first data-science workbook.',
        '',
        'Education',
        'BSc Mathematics, University of Example (2011 – 2014)',
        'Grade: First',
        'Courses: Statistics, Numerical Methods',
        '',
        'Projects',
        'Open scorecard toolkit, Personal (2021-01 – Present)',
        'Role: Maintainer',
        'application',
        'An open-source scorecard builder.',
        '- 400 GitHub stars',
        'Keywords: Python, open source',
        '',
        'Skills',
        'Credit risk modelling (Expert): IFRS 9, scorecards, PD/LGD/EAD',
        'Python (Advanced): pandas, scikit-learn',
        'SQL',
        '',
        'Languages',
        'English (Native)',
        'French (Professional working)',
        '',
        'Certificates',
        'CFA Level II, CFA Institute (2018-06)',
        '',
        'AWS Cloud Practitioner, Amazon',
        '',
        'Awards',
        'Analyst of the Year, Acme Bank (2022-11)',
        'For the SAS-to-Python migration.',
        '',
        'Publications',
        'Practical IFRS 9 staging, Risk Quarterly (2021-04)',
        'A field guide to significant increase in credit risk.',
        '',
        'Interests',
        'Cycling: audax, touring',
        '',
        'References',
        'A. Manager: Available on request.',
      ].join('\n'),
    );
  });

  it('is deterministic', () => {
    expect(flatten(FULL_RESUME_TEXT)).toBe(flatten(FULL_RESUME_TEXT));
  });

  it('never prints a heading for a section with nothing in it', () => {
    const text = flatten('{"basics":{"name":"Jane"},"work":[],"skills":[{"keywords":[]}]}');
    expect(text).toBe('Jane');
  });

  it('prints an entry with only dates rather than dropping the job', () => {
    expect(flatten('{"work":[{"startDate":"2019","endDate":"2020"}]}')).toBe(
      'Experience\n2019 – 2020',
    );
  });

  it('prints an end date with no start date as just the end date', () => {
    expect(flatten('{"work":[{"name":"Acme","endDate":"2020"}]}')).toBe('Experience\nAcme (2020)');
  });

  it('drops blank and whitespace-only strings instead of printing empty lines', () => {
    const text = flatten(
      '{"basics":{"name":"Jane","label":"  ","summary":"\\n"},"skills":[{"name":"Python","keywords":["", " ", "pandas"]}]}',
    );
    expect(text).toBe('Jane\n\nSkills\nPython: pandas');
  });

  it('never produces a run of more than one blank line, or a trailing newline', () => {
    const text = flatten(FULL_RESUME_TEXT);
    expect(text).not.toMatch(/\n{3}/);
    expect(text.endsWith('\n')).toBe(false);
    expect(text.startsWith('\n')).toBe(false);
  });

  it('keeps every word of the résumé', () => {
    // Nothing in a highlight or a keyword may be lost on the way to text.
    const text = flatten(FULL_RESUME_TEXT);
    for (const entry of FULL_RESUME.work) {
      for (const highlight of entry.highlights) expect(text).toContain(highlight);
    }
    for (const skill of FULL_RESUME.skills) {
      for (const keyword of 'keywords' in skill ? skill.keywords : []) {
        expect(text).toContain(keyword);
      }
    }
  });

  it('returns an empty string for a résumé with nothing in it', () => {
    expect(flattenJsonResume({})).toBe('');
    expect(flattenJsonResume({ basics: {}, work: [{}], skills: [] })).toBe('');
  });

  it('passes non-Latin text and symbols through unchanged', () => {
    expect(
      flatten('{"basics":{"name":"李小龙"},"skills":[{"name":"C++ / C#","keywords":["≥ 5 yrs"]}]}'),
    ).toBe('李小龙\n\nSkills\nC++ / C#: ≥ 5 yrs');
  });
});
