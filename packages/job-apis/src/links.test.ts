import { describe, expect, it } from 'vitest';

import { buildIndeedSearchUrl, buildLinkedInSearchUrl } from './links';

describe('buildLinkedInSearchUrl', () => {
  it('builds a search anyone can open with no key and no account', () => {
    expect(buildLinkedInSearchUrl({ keywords: 'credit risk', location: 'London' })).toBe(
      'https://www.linkedin.com/jobs/search/?keywords=credit+risk&location=London',
    );
  });

  it('always emits both parameters, even when one is empty', () => {
    expect(buildLinkedInSearchUrl({ keywords: 'quant', location: '' })).toBe(
      'https://www.linkedin.com/jobs/search/?keywords=quant&location=',
    );
  });
});

describe('buildIndeedSearchUrl', () => {
  it('builds a search on the UK site', () => {
    expect(buildIndeedSearchUrl({ keywords: 'credit risk', location: 'London' })).toBe(
      'https://uk.indeed.com/jobs?q=credit+risk&l=London',
    );
  });
});

describe('browser links — encoding', () => {
  const AWKWARD = { keywords: 'M&A analyst', location: 'Zürich & Genève' };

  it('percent-encodes an ampersand so it cannot start a new parameter', () => {
    // An unencoded `&` here would silently truncate the search and, worse, let
    // whatever the user typed become a query parameter of our choosing.
    for (const url of [buildLinkedInSearchUrl(AWKWARD), buildIndeedSearchUrl(AWKWARD)]) {
      expect(url).toContain('M%26A');
      expect(url.split('?')[1]?.split('&')).toHaveLength(2);
    }
  });

  it('percent-encodes non-ASCII characters as UTF-8', () => {
    for (const url of [buildLinkedInSearchUrl(AWKWARD), buildIndeedSearchUrl(AWKWARD)]) {
      expect(url).toContain('Z%C3%BCrich');
      expect(url).toContain('Gen%C3%A8ve');
      expect(url).not.toContain('ü');
    }
  });

  it('encodes spaces rather than leaving them raw', () => {
    for (const url of [buildLinkedInSearchUrl(AWKWARD), buildIndeedSearchUrl(AWKWARD)]) {
      expect(url).not.toContain(' ');
    }
  });

  it('survives a decode back to what the user typed', () => {
    const url = new URL(buildLinkedInSearchUrl(AWKWARD));
    expect(url.searchParams.get('keywords')).toBe('M&A analyst');
    expect(url.searchParams.get('location')).toBe('Zürich & Genève');
  });

  it('negative: text that looks like a URL cannot change the destination', () => {
    // The host and path are fixed strings in this module. Whatever the user
    // types ends up inside a query VALUE and nowhere else.
    const hostile = {
      keywords: 'https://evil.example.com/?x=',
      location: '#/../../admin',
    };

    for (const url of [buildLinkedInSearchUrl(hostile), buildIndeedSearchUrl(hostile)]) {
      expect(new URL(url).hostname).toMatch(/^(www\.linkedin\.com|uk\.indeed\.com)$/);
      expect(url).not.toContain('evil.example.com/?x=');
      expect(new URL(url).pathname).toMatch(/^\/(jobs\/search\/|jobs)$/);
    }
  });

  it('boundary: an entirely empty search still produces a usable URL', () => {
    // Opening a job board with nothing filled in is a reasonable thing to do -
    // it is their homepage with the search form ready.
    expect(() => new URL(buildLinkedInSearchUrl({ keywords: '', location: '' }))).not.toThrow();
    expect(() => new URL(buildIndeedSearchUrl({ keywords: '', location: '' }))).not.toThrow();
  });

  it('boundary: collapses the whitespace and control characters a paste brings', () => {
    const pasted = { keywords: '  credit\tanalyst\n ', location: ' London ' };
    expect(buildLinkedInSearchUrl(pasted)).toBe(
      'https://www.linkedin.com/jobs/search/?keywords=credit+analyst&location=London',
    );
  });
});
