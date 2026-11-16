/**
 * The country a search is for (L-415).
 *
 * A country is a choice from a closed list. It reaches Rust as one of nineteen
 * codes or not at all; it is never text that could become part of an address.
 */
import { describe, expect, it } from 'vitest';

import { ADZUNA_COUNTRIES } from './countries';
import { buildSearchParams } from './params';

const SENSIBLE = { keywords: 'credit risk analyst', location: 'London' };
const BOTH = ['adzuna', 'reed'] as const;

describe('buildSearchParams — a search that names no country', () => {
  it('carries none, so what crosses to Rust is exactly what crossed before', () => {
    for (const provider of BOTH) {
      for (const input of [SENSIBLE, { ...SENSIBLE, country: null }]) {
        const built = buildSearchParams(provider, input);

        expect(built.ok).toBe(true);
        if (built.ok) {
          expect(Object.keys(built.value).sort()).toEqual([
            'distance',
            'employmentType',
            'keywords',
            'limit',
            'location',
            'salaryMin',
          ]);
        }
      }
    }
  });
});

describe('buildSearchParams — a search that names a country', () => {
  it.each([...ADZUNA_COUNTRIES])('happy: Adzuna may be asked for %s', (country) => {
    const built = buildSearchParams('adzuna', { ...SENSIBLE, country });

    expect(built.ok).toBe(true);
    if (built.ok) expect(built.value.country).toBe(country);
  });

  it('happy: Reed may be asked for the United Kingdom by name', () => {
    const built = buildSearchParams('reed', { ...SENSIBLE, country: 'gb' });

    expect(built.ok).toBe(true);
    if (built.ok) expect(built.value.country).toBe('gb');
  });

  it.each(ADZUNA_COUNTRIES.filter((country) => country !== 'gb'))(
    'negative: Reed is refused for %s, because Reed lists UK jobs only',
    (country) => {
      const built = buildSearchParams('reed', { ...SENSIBLE, country });

      expect(built.ok).toBe(false);
      if (!built.ok) {
        expect(built.error.kind).toBe('bad-request');
        expect(built.error.provider).toBe('reed');
        expect(built.error.message).toBe('Reed lists UK jobs only.');
      }
    },
  );

  it.each([
    'GB',
    'Gb',
    '',
    ' gb',
    'gb ',
    'xx',
    'uk',
    '../',
    '/',
    '%2f',
    'gb/../us',
    'gb?x=1',
    'us&app_key=stolen',
    'constructor',
    '__proto__',
    'x'.repeat(10_000),
  ])('negative: %j is not a country, and nothing is built for either board', (hostile) => {
    for (const provider of BOTH) {
      // A caller that lies to the type checker is exactly the case to refuse.
      const built = buildSearchParams(provider, { ...SENSIBLE, country: hostile as never });

      expect(built.ok).toBe(false);
      if (!built.ok) {
        expect(built.error.kind).toBe('bad-request');
        // The refusal never repeats what was sent.
        if (hostile.length > 3) expect(built.error.message).not.toContain(hostile);
      }
    }
  });

  it('negative: a country that is not text at all is refused too', () => {
    for (const hostile of [42, true, ['gb'], { code: 'gb' }]) {
      for (const provider of BOTH) {
        const built = buildSearchParams(provider, { ...SENSIBLE, country: hostile as never });

        expect(built.ok).toBe(false);
      }
    }
  });

  it('says which board has no list for it, in words already approved', () => {
    const built = buildSearchParams('adzuna', { ...SENSIBLE, country: 'xx' as never });

    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error.message).toBe('Adzuna has no job list for this country.');
  });

  it('an empty search is still the first thing refused, whatever the country', () => {
    const built = buildSearchParams('adzuna', { keywords: ' ', location: '', country: 'us' });

    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.error.message).toBe(
        'Enter a job title, some keywords, or a location before searching.',
      );
    }
  });
});
