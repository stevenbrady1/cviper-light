/**
 * Recall and last false positives for the boilerplate filter (L-205): the common
 * shapes of equal-opportunity, agency and cookie text that must go, and duties
 * that merely sound like them, which must stay.
 */
import { describe, expect, it } from 'vitest';

import { stripJobBoilerplate } from './boilerplate';

const HEADER = 'Senior Credit Risk Analyst\nBarclays - London, Canary Wharf\n£75,000 - £90,000';

const BODY = [
  'About the role\nYou will own the quarterly IFRS 9 impairment model for the UK corporate book and present results to the CRO.',
  'Requirements\n- Five years of credit risk experience in a UK bank\n- Strong SQL and Python\n- Basel III and stress testing knowledge',
  'Benefits\n25 days holiday, discretionary bonus, private medical cover and a pension at 10 percent.',
  'Team\nA team of ten analysts sitting with the wider risk function.',
  'How to apply\nSend your CV and a short covering note to the hiring manager.',
];

/** Seven blocks: header, five real blocks, then the line (footer position). */
function footerAdvert(line: string): string {
  return [HEADER, ...BODY, line].join('\n\n');
}

/** Seven blocks: the line first (header position), then six real blocks. */
function headerAdvert(line: string): string {
  return [line, HEADER, ...BODY].join('\n\n');
}

describe('stripJobBoilerplate - common boilerplate shapes are removed', () => {
  it.each([
    'We are an equal opportunity employer. All qualified applicants will receive consideration for employment without regard to race, colour, religion, sex, sexual orientation, gender identity, national origin, disability or veteran status.',
    'We are an equal opportunities employer and welcome applications from all suitably qualified persons regardless of their race, sex, disability, religion/belief, sexual orientation or age.',
    'We are an equal opportunities employer and do not discriminate. We particularly encourage applicants with a disability to apply.',
    'We are committed to equality, diversity and inclusion and welcome applications from people of all backgrounds.',
    'Due to the high volume of applications we are unable to respond to everyone. If you have not heard back within 14 days, please assume you have been unsuccessful.',
  ])('removes the footer: %s', (line) => {
    const out = stripJobBoilerplate(footerAdvert(line));
    expect(out).toBe([HEADER, ...BODY].join('\n\n'));
  });

  it.each([
    'We use essential cookies to make our site work. Accept all cookies or Reject all.',
    'This website uses cookies to improve your experience of our website. Accept all cookies or Reject all.',
  ])('removes the cookie notice at the top: %s', (line) => {
    const out = stripJobBoilerplate(headerAdvert(line));
    expect(out).toBe([HEADER, ...BODY].join('\n\n'));
  });
});

describe('stripJobBoilerplate - duties that sound like boilerplate are kept', () => {
  it.each([
    'Build the Accept all cookies banner for our web shop.',
    'Our product uses cookies to personalise pricing and you would maintain that tracking.',
    'Champion our diversity and inclusion statement and ensure we do not discriminate on the basis of any protected characteristic.',
    'Own the equal opportunities policy and make sure line managers do not discriminate.',
  ])('keeps: %s', (line) => {
    const footer = footerAdvert(line);
    const header = headerAdvert(line);
    expect(stripJobBoilerplate(footer)).toBe(footer);
    expect(stripJobBoilerplate(header)).toBe(header);
  });

  it('keeps a CIPP-qualified requirement even with a second equal-opportunities signal', () => {
    const line =
      'We are an equal opportunities employer; we welcome applications from CIPP-qualified candidates.';
    const text = footerAdvert(line);
    expect(stripJobBoilerplate(text)).toBe(text);
  });
});
