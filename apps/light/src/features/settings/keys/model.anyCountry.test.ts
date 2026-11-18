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

describe('the Adzuna key text does not lean on Reed (L-424)', () => {
  // Reed lists UK jobs only, so "alongside Reed’s" was untrue for someone
  // searching Germany: there is no Reed result for theirs to sit beside.
  it('the whole sentence, in the owner-approved words', () => {
    expect(unlocks('adzuna')).toBe(
      'Searches Adzuna, which gathers adverts from hundreds of job boards and company career ' +
        'pages, in 19 countries, into one feed. Results are marked with where they came from.',
    );
  });

  it('negative: the Adzuna text does not mention Reed', () => {
    expect(unlocks('adzuna')).not.toMatch(/Reed/i);
  });

  it('boundary: Reed’s own text is untouched', () => {
    expect(unlocks('reed')).toBe(
      'Searches Reed directly — one of the largest UK job boards, and the stronger of the two ' +
        'for contract and day-rate roles.',
    );
  });
});
