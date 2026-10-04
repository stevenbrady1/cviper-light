/**
 * The ATS Score step's before → after comparison (L-198).
 *
 * The four cases the issue names — happy path, no change, empty tailored text,
 * a CV with no sections — plus the two rules it states in words: missing
 * keywords are offered as "only if it's true", never as a list of things to
 * claim, and no AI call is made (this module imports no transport at all).
 */
import { describe, expect, it } from 'vitest';

import { compareAts, STILL_MISSING_MAX } from './atsStep';

const ADVERT = [
  'Senior Data Analyst — Acme Ltd, Leeds',
  'We are looking for a data analyst with strong SQL and Python, experience building',
  'Power BI dashboards, stakeholder management, and data modelling. You will own the',
  'monthly reporting pack, automate manual reconciliations and present insights to',
  'senior leadership. Experience with dbt, Snowflake and A/B testing is a plus.',
].join('\n');

const ORIGINAL = [
  'Jane Doe',
  'jane.doe@example.com',
  '',
  'Experience',
  'Analyst, Northwind Bank, 2020-2024',
  '- Responsible for the monthly reporting pack',
  '- Worked on reconciliations',
  '- Helped the team with queries',
  '',
  'Education',
  'BSc Mathematics, University of Leeds',
  '',
  'Skills',
  'Excel, SQL',
].join('\n');

const TAILORED = [
  'Jane Doe',
  'jane.doe@example.com · 07700 900123',
  '',
  'Professional Summary',
  'Data analyst with SQL and Python, building Power BI dashboards for senior leadership.',
  '',
  'Experience',
  'Analyst, Northwind Bank, 2020-2024',
  '- Automated the monthly reporting pack in Python, saving 10 hours a month',
  '- Reduced manual reconciliations by 60%, enabling same-day close',
  '- Delivered Power BI dashboards to 40 stakeholders, improving decision speed',
  '',
  'Education',
  'BSc Mathematics, University of Leeds',
  '',
  'Skills',
  'SQL, Python, Power BI, data modelling, stakeholder management',
].join('\n');

describe('compareAts — the ATS Score step', () => {
  it('happy path: tailoring that adds the advert words and stronger bullets shows a rise on both', () => {
    const comparison = compareAts({ originalCv: ORIGINAL, tailoredCv: TAILORED, jobText: ADVERT });

    expect(comparison.keyword.before).not.toBeNull();
    expect(comparison.keyword.after).not.toBeNull();
    expect(comparison.keyword.delta).toBeGreaterThan(0);

    expect(comparison.bullets.before).toBe(0);
    expect(comparison.bullets.after).toBe(100);
    expect(comparison.bullets.delta).toBe(100);
    expect(comparison.bullets.totalAfter).toBe(3);

    const contact = comparison.checks.find((check) => check.id === 'contact_info');
    expect(contact?.before).toBe('warn');
    expect(contact?.after).toBe('pass');
  });

  it('no change: the same text before and after shows a delta of exactly 0 everywhere', () => {
    const comparison = compareAts({ originalCv: TAILORED, tailoredCv: TAILORED, jobText: ADVERT });
    expect(comparison.keyword.delta).toBe(0);
    expect(comparison.bullets.delta).toBe(0);
    for (const check of comparison.checks) expect(check.after).toBe(check.before);
  });

  it('empty tailored text: no keyword number is invented, and the reason is said', () => {
    const comparison = compareAts({ originalCv: ORIGINAL, tailoredCv: '', jobText: ADVERT });
    expect(comparison.keyword.before).not.toBeNull();
    expect(comparison.keyword.after).toBeNull();
    expect(comparison.keyword.delta).toBeNull();
    expect(comparison.keyword.afterReason).not.toBeNull();
    expect(comparison.bullets.after).toBe(0);
    expect(comparison.bullets.totalAfter).toBe(0);
    expect(comparison.stillMissing).toEqual([]);
  });

  it('a CV with no sections: the section check fails and names all three', () => {
    const noSections =
      'Jane Doe. I like numbers and I have done a lot of reporting work over the years.';
    const comparison = compareAts({
      originalCv: noSections,
      tailoredCv: noSections,
      jobText: ADVERT,
    });
    const sections = comparison.checks.find((check) => check.id === 'section_headers');
    expect(sections?.after).toBe('fail');
    expect(sections?.afterMessage).toContain('Experience, Education, Skills');
  });

  it('boundary: still-missing keywords are capped, and come from the TAILORED CV', () => {
    const comparison = compareAts({ originalCv: ORIGINAL, tailoredCv: TAILORED, jobText: ADVERT });
    expect(comparison.stillMissing.length).toBeLessThanOrEqual(STILL_MISSING_MAX);
    // Words the tailored CV now uses are not reported as missing.
    expect(comparison.stillMissing.map((word) => word.toLowerCase())).not.toContain('python');
  });

  it('negative: an advert too short to score refuses both numbers rather than reporting zeros', () => {
    const comparison = compareAts({ originalCv: ORIGINAL, tailoredCv: TAILORED, jobText: 'SQL' });
    expect(comparison.keyword.before).toBeNull();
    expect(comparison.keyword.after).toBeNull();
    expect(comparison.keyword.delta).toBeNull();
    expect(comparison.stillMissing).toEqual([]);
  });

  it('checks come in a fixed order the screen can rely on', () => {
    const comparison = compareAts({ originalCv: ORIGINAL, tailoredCv: TAILORED, jobText: ADVERT });
    expect(comparison.checks.map((check) => check.id)).toEqual([
      'section_headers',
      'contact_info',
      'cv_length',
    ]);
  });
});
