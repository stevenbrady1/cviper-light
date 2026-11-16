/**
 * L-417: the app remembers the country you search in (`cviper.light.country`).
 * The privacy policy's list of what is kept in the app's browser storage says
 * so, in the words the owner approved on 13 November 2026, and the allowed-sites
 * list says the country travels with an Adzuna search.
 */
import { describe, expect, it } from 'vitest';

import { OUTBOUND_HOSTS } from '../../../lib/outbound-hosts';
import { COUNTRY_STORAGE_KEY } from '../../search/country';
import { LOCAL_STORAGE_PREFIX } from '../erase/port';

import { DATA_LOCATIONS } from './dataLocations';

const BROWSER_STORAGE = DATA_LOCATIONS.find((location) =>
  location.where.includes('browser storage'),
);

describe('the country in the privacy policy (L-417)', () => {
  it('is named among the small conveniences, between the saved searches and the feed ticks', () => {
    expect(BROWSER_STORAGE?.what).toContain(
      'your saved searches, the country you search in, which free job feeds you ticked,',
    );
  });

  it('and it is erased by "Delete everything" like the rest', () => {
    expect(COUNTRY_STORAGE_KEY.startsWith(LOCAL_STORAGE_PREFIX)).toBe(true);
    expect(BROWSER_STORAGE?.erasedBy).toBe('preferences');
  });

  it('the Adzuna entry says the country you chose travels with a search', () => {
    const adzuna = OUTBOUND_HOSTS.find((entry) => entry.host === 'api.adzuna.com');

    expect(adzuna?.why).toContain(
      'The request also carries your search words and location, and the country you chose, ' +
        'which is what a search is, and Adzuna sees your IP address',
    );
  });

  it('negative: Reed is sent no country, so its entry does not claim one', () => {
    const reed = OUTBOUND_HOSTS.find(
      (entry) => entry.host === 'www.reed.co.uk' && entry.purpose === 'fetched-with-your-key',
    );

    expect(reed?.why).toBeTruthy();
    expect(reed?.why).not.toContain('country');
  });
});
