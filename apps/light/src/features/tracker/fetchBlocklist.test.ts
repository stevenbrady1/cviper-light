/**
 * The shipped fetch blocklist.
 *
 * ============================================================================
 * THIS IS NOT A SECURITY CONTROL, AND SAYING SO IS THE POINT
 * ============================================================================
 * Everything that stops this app reaching somewhere it should not is in
 * `src-tauri/src/fetch_page.rs`, is enforced in Rust before every connection,
 * and does not consult this file. What this list does is save the user a
 * pointless fifteen-second wait against sites that answer a fetcher with a
 * login wall — so a blocked domain skips the network ENTIRELY and gets the
 * guided message immediately, which is the same message it would have got a
 * quarter of a minute later anyway.
 *
 * The assertions here are bound to the real `fetch-blocklist.json`, not to a
 * copy of it, so a malformed or reordered file fails the build rather than the
 * user's afternoon.
 */
import { describe, expect, it } from 'vitest';

import {
  SHIPPED_BLOCKLIST,
  SHIPPED_BLOCKLIST_PROBLEM,
  isBlockedHost,
  isBlockedUrl,
  type BlockedSite,
} from './fetchBlocklist';

describe('the shipped file', () => {
  it('parses — a broken file is caught here, not by a user', () => {
    expect(SHIPPED_BLOCKLIST_PROBLEM).toBeNull();
    expect(SHIPPED_BLOCKLIST.length).toBeGreaterThan(0);
  });

  it('ships the two sites that always answer a fetcher with a wall', () => {
    const domains = SHIPPED_BLOCKLIST.map((site) => site.domain);

    expect(domains).toContain('linkedin.com');
    expect(domains).toContain('indeed.com');
  });

  it('every entry says why, so nobody has to guess before removing one', () => {
    for (const site of SHIPPED_BLOCKLIST) {
      expect(site.domain).not.toBe('');
      expect(site.domain).toBe(site.domain.toLowerCase());
      expect(site.why.length).toBeGreaterThan(10);
    }
  });
});

describe('matching a host', () => {
  const list: readonly BlockedSite[] = [
    { domain: 'linkedin.com', why: 'test fixture' },
    { domain: 'indeed.com', why: 'test fixture' },
  ];

  it('matches the registrable domain itself', () => {
    expect(isBlockedHost('linkedin.com', list)).toBe(true);
    expect(isBlockedHost('indeed.com', list)).toBe(true);
  });

  it('matches every subdomain — this is the whole reason it is not string equality', () => {
    for (const host of [
      'www.linkedin.com',
      'uk.indeed.com',
      'www.indeed.com',
      'gb.linkedin.com',
      'careers.uk.indeed.com',
    ]) {
      expect(isBlockedHost(host, list)).toBe(true);
    }
  });

  it('is case-insensitive and survives a trailing dot', () => {
    expect(isBlockedHost('WWW.LinkedIn.COM', list)).toBe(true);
    expect(isBlockedHost('uk.indeed.com.', list)).toBe(true);
  });

  it('negative: a domain that merely CONTAINS a blocked one is not blocked', () => {
    // The bug a naive `includes` would ship. Both of these are other people's
    // websites and neither is LinkedIn.
    for (const host of [
      'notlinkedin.com',
      'mylinkedin.com',
      'linkedin.com.phishing.test',
      'indeed.com.example.org',
      'indeedly.com',
    ]) {
      expect(isBlockedHost(host, list)).toBe(false);
    }
  });

  it('negative: an ordinary job site is not blocked', () => {
    for (const host of ['www.reed.co.uk', 'jobs.example.com', 'efinancialcareers.co.uk']) {
      expect(isBlockedHost(host, list)).toBe(false);
    }
  });

  it('negative: an empty list blocks nothing', () => {
    expect(isBlockedHost('www.linkedin.com', [])).toBe(false);
  });
});

describe('matching a whole address', () => {
  it('reads the host out of a URL', () => {
    expect(isBlockedUrl('https://uk.indeed.com/viewjob?jk=abc123')).toBe(true);
    expect(isBlockedUrl('https://www.linkedin.com/jobs/view/4012345678/')).toBe(true);
    expect(isBlockedUrl('https://www.reed.co.uk/jobs/analyst/12345')).toBe(false);
  });

  it('negative: something that is not a URL is not "blocked" — it is just not a URL', () => {
    // The distinction matters because the caller acts on it: an unparseable
    // address still goes to Rust, which owns the real verdict on what is
    // fetchable. Answering `true` here would hide a real refusal behind a
    // guess made in the browser.
    for (const raw of ['', '   ', 'linkedin', 'not a url at all', 'http://']) {
      expect(isBlockedUrl(raw)).toBe(false);
    }
  });

  it('boundary: a bare host with no scheme is not treated as blocked', () => {
    // `new URL('uk.indeed.com')` throws — there is no scheme. It reaches Rust,
    // which refuses it properly.
    expect(isBlockedUrl('uk.indeed.com')).toBe(false);
  });
});
