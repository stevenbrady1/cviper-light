/**
 * The privacy policy carries the sections UK data-protection law expects of
 * it (L-231, issue #240).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * The launch audit (9 October 2026) found that the generated policy named
 * every address the app can reach, but said nothing about WHO is responsible,
 * on what lawful basis, what your rights are, where to complain, whether data
 * leaves the UK or how long anything is kept — and that its only contact was
 * a public issue tracker, where a personal question would be published to the
 * world. It also named no-one for the cviper.uk redirect (Cloudflare) and used
 * a US age threshold ("under 13").
 *
 * The owner's decision: the controller is Steven Brady, a sole trader in the
 * UK, reachable privately at privacy@cviper.ai; the audience is 16 and over.
 *
 * `policyDocument.test.ts` keeps `docs/app-store/privacy-policy.md` byte-equal
 * to the render, and the website's daily drift check carries that file to
 * https://cviper.ai/privacy/ — so asserting the RENDER is asserting the page.
 */
import { describe, expect, it } from 'vitest';

import {
  POLICY_LAST_UPDATED,
  PRIVACY_CONTACT_EMAIL,
  currentPrivacyPolicy,
  formatPolicyDate,
} from './policyDocument';

const text = currentPrivacyPolicy();

/** The body of one `## heading` section, up to the next `## ` heading. */
function section(heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  expect(start, `missing section "## ${heading}"`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + heading.length + 5);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

describe('the privacy policy names who is responsible and how to reach them privately', () => {
  it('names the controller, a sole trader in the UK', () => {
    const who = section('Who is responsible');
    expect(who).toContain('Steven Brady');
    expect(who).toMatch(/sole trader/);
    expect(who).toMatch(/United Kingdom/);
    expect(who).toMatch(/controller/);
  });

  it('gives a private email address for privacy questions', () => {
    expect(PRIVACY_CONTACT_EMAIL).toBe('privacy@cviper.ai');
    expect(section('Who is responsible')).toContain(PRIVACY_CONTACT_EMAIL);
    expect(section('Questions')).toContain(PRIVACY_CONTACT_EMAIL);
  });

  it('warns that the public issue tracker is public', () => {
    expect(section('Questions')).toMatch(/public/);
    expect(section('Questions')).toMatch(/personal/);
  });
});

describe('the privacy policy carries every section UK GDPR expects', () => {
  it('states a lawful basis', () => {
    const basis = section('Our lawful basis');
    expect(basis).toMatch(/legitimate interests?/);
    expect(basis).toMatch(/UK GDPR/);
  });

  it('lists your rights and the ICO complaint route', () => {
    const rights = section('Your rights');
    for (const right of ['access', 'correct', 'delete', 'object', 'restrict']) {
      expect(rights, right).toMatch(new RegExp(`\\b${right}`));
    }
    expect(rights).toMatch(/Information Commissioner’s Office/);
    expect(rights).toContain('ico.org.uk');
  });

  it('covers international transfers', () => {
    const transfers = section('International transfers');
    expect(transfers).toMatch(/outside the UK/);
    expect(transfers).toMatch(/you choose/);
  });

  it('covers retention, on your device and in our inbox', () => {
    const retention = section('How long things are kept');
    expect(retention).toContain('Settings → Delete everything');
    expect(retention).toContain(PRIVACY_CONTACT_EMAIL);
  });

  it('names Cloudflare for the cviper.uk redirect and GitHub Pages for the site', () => {
    const site = section('Our website');
    expect(site).toContain('Cloudflare');
    expect(site).toContain('cviper.uk');
    expect(site).toContain('GitHub Pages');
  });

  it('is for people aged 16 and over', () => {
    expect(section('Age')).toMatch(/16 and over/);
  });

  it('carries a "Last updated" date', () => {
    expect(text).toContain(`Last updated: ${formatPolicyDate(POLICY_LAST_UPDATED)}`);
  });
});

describe('negative: the old wording is gone', () => {
  it('no longer uses the US under-13 threshold', () => {
    expect(text).not.toMatch(/under[ -]13/i);
    expect(text).not.toContain('not directed at children');
  });

  it('does not claim the app never reaches the website: it opens its pages in your browser', () => {
    // Settings → Privacy and About hand cviper.ai addresses to the browser,
    // so only "the app itself" can be said never to contact the site.
    expect(section('Our website')).not.toMatch(/the app never contacts/i);
  });

  it('does not claim the site has no analytics at all: the host can count traffic', () => {
    // True claim: the pages load no analytics script. The hosts may still
    // count requests (Cloudflare's dashboard does by default).
    expect(section('Our website')).not.toMatch(/runs no analytics/i);
    expect(section('Our website')).toMatch(/no analytics script/i);
  });

  it('no longer makes the public tracker the only contact', () => {
    expect(text).not.toContain('Ask on the public issue tracker:');
  });
});

describe('boundary: the last-updated date', () => {
  it('is a real ISO calendar date, not in the future', () => {
    expect(POLICY_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const parsed = new Date(`${POLICY_LAST_UPDATED}T00:00:00Z`);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    // Round-trips, so 2026-02-30 (which Date silently rolls to 2 March) fails.
    expect(parsed.toISOString().slice(0, 10)).toBe(POLICY_LAST_UPDATED);
    expect(parsed.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('renders as a UK long date, with no leading zero on the day', () => {
    expect(formatPolicyDate('2026-10-16')).toBe('16 October 2026');
    expect(formatPolicyDate('2027-01-01')).toBe('1 January 2027');
    expect(formatPolicyDate('2026-12-31')).toBe('31 December 2026');
  });

  it('refuses a date that is not a real day', () => {
    expect(() => formatPolicyDate('2026-02-30')).toThrow();
    expect(() => formatPolicyDate('16/10/2026')).toThrow();
  });
});
