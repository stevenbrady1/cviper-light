/**
 * `advertForModel` - the one door an advert goes through on its way to a model
 * (L-208).
 */
import { describe, expect, it } from 'vitest';

import { stripJobBoilerplate } from '@cviper/keyword-scoring';

import { advertForModel } from './advertForModel';
import { ADVERT_BODY, ADVERT_WITH_BOILERPLATE, COOKIE_BANNER, EO_FOOTER } from './advertFixtures';

describe('advertForModel', () => {
  it('drops the cookie banner and the equal-opportunities footer, keeps the job', () => {
    const out = advertForModel(ADVERT_WITH_BOILERPLATE);
    expect(out).not.toContain(COOKIE_BANNER);
    expect(out).not.toContain('equal opportunities employer');
    expect(out).toContain('IFRS 9 impairment');
    expect(out).toContain('£75,000 - £90,000');
  });

  it('is the L-205 filter, not a second opinion on it', () => {
    expect(advertForModel(ADVERT_WITH_BOILERPLATE)).toBe(
      stripJobBoilerplate(ADVERT_WITH_BOILERPLATE),
    );
  });

  it('boundary: an advert with no boilerplate comes back byte-for-byte', () => {
    expect(advertForModel(ADVERT_BODY)).toBe(ADVERT_BODY);
  });

  it('negative: empty and whitespace-only input never throw and stay empty', () => {
    expect(advertForModel('')).toBe('');
    expect(advertForModel('   \n ').trim()).toBe('');
  });

  it('negative: an advert that is only a notice is not emptied', () => {
    expect(advertForModel(EO_FOOTER).length).toBeGreaterThan(0);
  });
});
