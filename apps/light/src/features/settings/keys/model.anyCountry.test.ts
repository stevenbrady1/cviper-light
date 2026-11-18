/**
 * What the two job-board keys say they unlock, for someone in any country (L-423).
 */
import { describe, expect, it } from 'vitest';

import { ADZUNA_COUNTRIES } from '@cviper/job-apis';

import { KEY_PROVIDERS } from './model';

const unlocks = (id: string): string =>
  KEY_PROVIDERS.find((provider) => provider.id === id)?.unlocks ?? '';

describe('the job-board key text (L-423)', () => {
  it('Adzuna: the owner-approved words, with no country named', () => {
    expect(unlocks('adzuna')).toContain(
      'Searches Adzuna, which gathers adverts from hundreds of job boards and company career ' +
        'pages, in 19 countries, into one feed.',
    );
    expect(unlocks('adzuna')).not.toMatch(/\bUK\b|Britain|British/);
  });

  it('boundary: the number of countries is the number the app can search', () => {
    // Read from the sentence and compared with the list, so adding a country
    // without changing the words fails here.
    const said = /in (\d+) countries/.exec(unlocks('adzuna'))?.[1];
    expect(Number(said)).toBe(ADZUNA_COUNTRIES.length);
  });

  it('negative: Reed still says it is a UK board, because it is', () => {
    expect(unlocks('reed')).toContain('one of the largest UK job boards');
  });
});
