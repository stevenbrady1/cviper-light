/**
 * The boilerplate filter (L-205): what it removes, and - more important - what
 * it must never touch.
 *
 * Deleting a real requirement is worse than leaving a cookie banner in, so half
 * of this file is about text that merely MENTIONS "equal" or "cookies".
 */
import { describe, expect, it } from 'vitest';

import { stripJobBoilerplate } from './boilerplate';

const COOKIE_BANNER =
  'We use cookies to improve your experience on this site. Accept all cookies or manage your cookie settings.';

const HEADER = 'Senior Credit Risk Analyst\nBarclays - London, Canary Wharf\n£75,000 - £90,000';

const REAL_BODY = [
  'About the role\nYou will own the quarterly IFRS 9 impairment model for the UK corporate book and present results to the CRO.',
  'Requirements\n- Five years of credit risk experience in a UK bank\n- Strong SQL and Python\n- Basel III and stress testing knowledge',
  'Benefits\n25 days holiday, discretionary bonus, private medical cover and a pension at 10 percent.',
].join('\n\n');

const EO_FOOTER =
  'We are an equal opportunities employer and welcome applications from all suitable candidates regardless of age, gender, race, religion, disability or sexual orientation. We are committed to a diverse and inclusive workplace.';

const AGENCY_FOOTER =
  'Acorn Search Ltd is acting as an employment agency in relation to this vacancy. By applying you agree to our privacy policy. Registered in England No. 01234567. Due to the high volume of applications we are unable to respond to all candidates.';

describe('stripJobBoilerplate - removes boilerplate when it is detected', () => {
  it('removes a cookie notice at the top', () => {
    const out = stripJobBoilerplate(`${COOKIE_BANNER}\n\n${HEADER}\n\n${REAL_BODY}`);
    expect(out).not.toContain('cookie');
    expect(out).toContain('Senior Credit Risk Analyst');
    expect(out).toContain('IFRS 9 impairment');
  });

  it('removes an equal-opportunities statement at the bottom, with its heading', () => {
    const out = stripJobBoilerplate(
      `${HEADER}\n\n${REAL_BODY}\n\nEqual Opportunities\n\n${EO_FOOTER}`,
    );
    expect(out).not.toContain('equal opportunities employer');
    expect(out).not.toContain('Equal Opportunities');
    expect(out).toContain('Basel III and stress testing');
  });

  it('removes a recruitment-agency footer', () => {
    const out = stripJobBoilerplate(`${HEADER}\n\n${REAL_BODY}\n\n${AGENCY_FOOTER}`);
    expect(out).not.toContain('employment agency');
    expect(out).not.toContain('Registered in England');
    expect(out).toContain('private medical cover');
  });

  it('removes several categories in one advert', () => {
    const out = stripJobBoilerplate(
      `${COOKIE_BANNER}\n\n${HEADER}\n\n${REAL_BODY}\n\n${EO_FOOTER}\n\n${AGENCY_FOOTER}`,
    );
    expect(out).not.toMatch(/cookie|equal opportunities|employment agency/i);
    expect(out).toContain('£75,000 - £90,000');
    expect(out).toContain('25 days holiday');
  });

  it('removes boilerplate from a pasted advert with no blank lines (line by line)', () => {
    const lines = [
      'Skip to main content',
      'This website uses cookies. Accept all cookies.',
      'Credit Risk Analyst, London',
      'You will build IFRS 9 models and report to the CRO.',
      'Essential: SQL, Python, Basel III, stress testing, five years in a UK bank.',
      'Salary £70,000 to £85,000 plus bonus.',
      'We are an equal opportunity employer and do not discriminate on the basis of any protected characteristic.',
    ].join('\n');
    const out = stripJobBoilerplate(lines);
    expect(out).not.toMatch(/cookie|equal opportunity|Skip to main/i);
    expect(out).toContain('Essential: SQL, Python');
    expect(out).toContain('£70,000');
  });

  it('copes with Windows line endings and curly apostrophes', () => {
    const text = `${HEADER}\r\n\r\n${REAL_BODY}\r\n\r\nWe’re an equal opportunities employer and we welcome applications from everyone regardless of age or gender.`;
    const out = stripJobBoilerplate(text);
    expect(out).not.toContain('equal opportunities');
    expect(out).toContain('Strong SQL and Python');
  });
});

describe('stripJobBoilerplate - never deletes real content (negative)', () => {
  it('keeps a requirement that mentions cookies', () => {
    const text = `${HEADER}\n\n${REAL_BODY}\n\nExperience analysing first-party cookies, consent data and attribution models is a plus.`;
    expect(stripJobBoilerplate(text)).toBe(text);
  });

  it('keeps a requirement that mentions "equal" in its own right', () => {
    const text = `${HEADER}\n\n${REAL_BODY}\n\nYou will build equal-weighted and risk-parity portfolio models and hold equal responsibility for sign-off.`;
    expect(stripJobBoilerplate(text)).toBe(text);
  });

  it('keeps a requirement that mentions cookies in the header position', () => {
    const text = `Digital Analyst\n\nYou will manage cookie consent and cookie settings for our banking website.\n\n${REAL_BODY}`;
    expect(stripJobBoilerplate(text)).toBe(text);
  });

  it('keeps a footer paragraph that carries salary or requirements, even if it also says equal opportunities', () => {
    const text = `${HEADER}\n\n${REAL_BODY}\n\nSalary £80,000. Requirements: CFA. We are an equal opportunities employer.`;
    expect(stripJobBoilerplate(text)).toBe(text);
  });

  it('keeps boilerplate-looking text in the middle of a long advert', () => {
    const middle =
      'We are an equal opportunities employer and welcome applications from all suitable candidates regardless of age.';
    const text = [
      HEADER,
      REAL_BODY,
      'Team\nA team of ten.',
      'Tools\nExcel, SQL, Python and VBA.',
      middle,
      'Location\nLondon, hybrid three days.',
      'How to apply\nSend your CV and a covering note.',
      'Closing date\nFriday the 14th.',
      'Contact\nTalk to the hiring manager.',
      'Start date\nAs soon as possible.',
      'Notes\nNo agencies please.',
    ].join('\n\n');
    expect(stripJobBoilerplate(text)).toBe(text);
  });
});

describe('stripJobBoilerplate - boundaries', () => {
  it('returns an advert without boilerplate unchanged, byte for byte', () => {
    const text = `${HEADER}\n\n${REAL_BODY}`;
    expect(stripJobBoilerplate(text)).toBe(text);
  });

  it.each(['', '   ', '\n\n\t\n'])('returns empty or whitespace input as it came (%j)', (input) => {
    expect(stripJobBoilerplate(input)).toBe(input);
  });

  it('never returns empty for boilerplate-only input', () => {
    const only = `${COOKIE_BANNER}\n\n${AGENCY_FOOTER}`;
    expect(stripJobBoilerplate(only)).toBe(only);
  });

  it('three boilerplate-only blocks are never emptied: the middle one survives', () => {
    const only = `${COOKIE_BANNER}\n\n${EO_FOOTER}\n\n${AGENCY_FOOTER}`;
    const out = stripJobBoilerplate(only);
    expect(out).not.toBe('');
    // Cookie (first) and agency (last) go; the middle block is never a
    // candidate in a short advert, and it is long enough to be kept.
    expect(out).toBe(EO_FOOTER);
  });

  it('returns the original when stripping would leave almost nothing', () => {
    const text = [
      COOKIE_BANNER,
      'This website uses cookies. Accept all cookies.',
      'Analyst wanted.',
      EO_FOOTER,
      AGENCY_FOOTER,
      EO_FOOTER,
    ].join('\n\n');
    expect(stripJobBoilerplate(text)).toBe(text);
  });

  it('handles a single-line advert', () => {
    const text = 'Credit risk analyst needed for IFRS 9 modelling in London.';
    expect(stripJobBoilerplate(text)).toBe(text);
  });

  it('is deterministic and idempotent', () => {
    const text = `${COOKIE_BANNER}\n\n${HEADER}\n\n${REAL_BODY}\n\n${EO_FOOTER}`;
    const once = stripJobBoilerplate(text);
    expect(stripJobBoilerplate(text)).toBe(once);
    expect(stripJobBoilerplate(once)).toBe(once);
  });

  it('finishes quickly on a very large advert', () => {
    const rows = Array.from(
      { length: 40_000 },
      (_, i) => `Responsibility ${i}: own the model and report on it.`,
    );
    const big = `${COOKIE_BANNER}\n\n${rows.join('\n\n')}\n\n${EO_FOOTER}`;
    const start = performance.now();
    const out = stripJobBoilerplate(big);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(out).not.toContain('cookie');
    expect(out).not.toContain('equal opportunities');
  });

  it('finishes quickly on adversarial input with one huge line', () => {
    const hostile = 'cookie '.repeat(300_000) + ' '.repeat(100_000) + 'equal '.repeat(100_000);
    const start = performance.now();
    stripJobBoilerplate(hostile);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
