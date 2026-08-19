import { describe, expect, it } from 'vitest';

import { PROVIDER_RESULT_CAP, buildSearchParams } from './params';

const SENSIBLE = { keywords: 'credit risk analyst', location: 'London' };

describe('buildSearchParams — happy paths', () => {
  it('passes a normal search through with the fields trimmed', () => {
    const built = buildSearchParams('reed', { keywords: '  java  ', location: ' London ' });

    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.keywords).toBe('java');
      expect(built.value.location).toBe('London');
    }
  });

  it('accepts keywords with no location, and a location with no keywords', () => {
    expect(buildSearchParams('adzuna', { keywords: 'quant', location: '' }).ok).toBe(true);
    expect(buildSearchParams('adzuna', { keywords: '', location: 'Leeds' }).ok).toBe(true);
  });

  it('defaults the optional filters to null rather than inventing a value', () => {
    const built = buildSearchParams('reed', SENSIBLE);

    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.salaryMin).toBeNull();
      expect(built.value.distanceMiles).toBeNull();
      expect(built.value.employmentType).toBeNull();
    }
  });
});

describe('buildSearchParams — the per-provider result cap', () => {
  it('the caps are the ones each API documents', () => {
    expect(PROVIDER_RESULT_CAP.adzuna).toBe(50);
    expect(PROVIDER_RESULT_CAP.reed).toBe(100);
  });

  it('boundary: a limit exactly at the cap survives, one past it is clamped', () => {
    for (const provider of ['adzuna', 'reed'] as const) {
      const cap = PROVIDER_RESULT_CAP[provider];

      const atCap = buildSearchParams(provider, { ...SENSIBLE, limit: cap });
      expect(atCap.ok && atCap.value.limit).toBe(cap);

      const overCap = buildSearchParams(provider, { ...SENSIBLE, limit: cap + 1 });
      // Clamped, NOT rejected: asking for more than the API will give is not a
      // mistake the user can see, and refusing the search would be a worse
      // answer than quietly returning the most the API allows.
      expect(overCap.ok && overCap.value.limit).toBe(cap);
    }
  });

  it('boundary: a limit below one is clamped up to one', () => {
    for (const limit of [0, -5, 0.4]) {
      const built = buildSearchParams('reed', { ...SENSIBLE, limit });
      expect(built.ok && built.value.limit).toBe(1);
    }
  });

  it('rounds a fractional limit down to a whole number of results', () => {
    const built = buildSearchParams('reed', { ...SENSIBLE, limit: 20.7 });
    expect(built.ok && built.value.limit).toBe(20);
  });
});

describe('buildSearchParams — negative cases', () => {
  it('refuses a search with nothing to search for', () => {
    const built = buildSearchParams('reed', { keywords: '   ', location: '' });

    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.error.kind).toBe('bad-request');
      expect(built.error.message).toMatch(/job title|keyword|location/i);
    }
  });

  it('refuses text long enough to be a paste accident', () => {
    const built = buildSearchParams('reed', { ...SENSIBLE, keywords: 'x'.repeat(201) });

    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.error.kind).toBe('bad-request');
      // The message must not echo the pasted text back at the user.
      expect(built.error.message).not.toContain('xxxxx');
    }
  });

  it('boundary: 200 characters of keywords is accepted, 201 is not', () => {
    expect(buildSearchParams('reed', { ...SENSIBLE, keywords: 'x'.repeat(200) }).ok).toBe(true);
    expect(buildSearchParams('reed', { ...SENSIBLE, keywords: 'x'.repeat(201) }).ok).toBe(false);
  });

  it('drops a salary or distance filter it cannot read rather than sending nonsense', () => {
    const built = buildSearchParams('reed', {
      ...SENSIBLE,
      salaryMin: Number.NaN,
      distanceMiles: -10,
    });

    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.salaryMin).toBeNull();
      expect(built.value.distanceMiles).toBeNull();
    }
  });

  it('strips control characters that would corrupt a query string', () => {
    const built = buildSearchParams('reed', { keywords: 'java\u0000\ndev', location: 'London' });

    expect(built.ok).toBe(true);
    if (built.ok) expect(built.value.keywords).toBe('java dev');
  });
});
