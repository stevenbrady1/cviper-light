/**
 * Review regressions for the boilerplate filter (L-205): real requirements that
 * an earlier version deleted. Every line below is job content. None may go.
 */
import { describe, expect, it } from 'vitest';

import { stripJobBoilerplate } from './boilerplate';

const HEADER = 'Senior Credit Risk Analyst\nBarclays - London, Canary Wharf\n£75,000 - £90,000';

const REAL_BODY = [
  'About the role\nYou will own the quarterly IFRS 9 impairment model for the UK corporate book and present results to the CRO.',
  'Requirements\n- Five years of credit risk experience in a UK bank\n- Strong SQL and Python\n- Basel III and stress testing knowledge',
  'Benefits\n25 days holiday, discretionary bonus, private medical cover and a pension at 10 percent.',
].join('\n\n');

const MORE_BODY = [
  'Team\nA team of ten.',
  'Tools\nExcel, SQL and VBA.',
  'How to apply\nSend your CV.',
].join('\n\n');

const COOKIE_BANNER =
  'We use cookies to improve your experience on this site. Accept all cookies or manage your cookie settings.';
const EO_FOOTER =
  'We are an equal opportunities employer and welcome applications from all suitable candidates regardless of age, gender, race, religion, disability or sexual orientation.';
const AGENCY_FOOTER =
  'Acorn Search Ltd is acting as an employment agency in relation to this vacancy. By applying you agree to our privacy policy. Registered in England No. 01234567.';

describe('stripJobBoilerplate - real lines that look like boilerplate', () => {
  it.each([
    'We welcome applications from graduates with a 2:1 in Mathematics, Physics or Engineering.',
    'Based at our registered office in Leeds (LS1), hybrid two days a week.',
    'Must be registered in England with Social Work England.',
    'Screen a high volume of applications each week using Workday and LinkedIn Recruiter.',
    'Lead hiring audits so that we do not discriminate against neurodivergent candidates.',
    'Own our cookie policy and consent banner (OneTrust), keeping it compliant with PECR and GDPR.',
    'Maintain the cookie settings page and tag manager for marketing.',
  ])('keeps the line in the footer: %s', (line) => {
    const short = `${HEADER}\n\n${REAL_BODY}\n\n${line}`;
    const long = `${HEADER}\n\n${REAL_BODY}\n\n${MORE_BODY}\n\n${line}`;
    expect(stripJobBoilerplate(short)).toBe(short);
    expect(stripJobBoilerplate(long)).toBe(long);
  });

  it('keeps a title paragraph that mentions a cookie policy', () => {
    const text = `Privacy Engineer - Cookie Policy & Consent\nLondon, hybrid\n\n${REAL_BODY}\n\n${MORE_BODY}`;
    expect(stripJobBoilerplate(text)).toBe(text);
  });

  it('a single equal-opportunities sentence alone is not enough to delete a block', () => {
    const text = `${HEADER}\n\n${REAL_BODY}\n\nWe are an equal opportunities employer.`;
    expect(stripJobBoilerplate(text)).toBe(text);
  });
});

describe('stripJobBoilerplate - short adverts', () => {
  it('never touches the middle of a four-paragraph advert', () => {
    const text = [
      'Payroll Manager\nLondon\nPermanent',
      'We welcome applications from CIPP-qualified candidates or those part-way through the CIPP Foundation Degree.',
      'You will run a monthly payroll for 800 staff, own RTI submissions and manage pension auto-enrolment.',
      'Strong Excel and Sage skills, plus Payroll Manager experience at a UK financial services firm.',
    ].join('\n\n');
    expect(stripJobBoilerplate(text)).toBe(text);
  });
});

describe('stripJobBoilerplate - invisible characters', () => {
  it('treats a zero-width-space-only line as a blank line', () => {
    const zw = '​';
    const text = [COOKIE_BANNER, HEADER, REAL_BODY, EO_FOOTER, AGENCY_FOOTER].join(`\n${zw}\n`);
    const out = stripJobBoilerplate(text);
    expect(out).not.toMatch(/cookie|equal opportunities|employment agency/i);
    expect(out).toContain('Strong SQL and Python');
  });
});
