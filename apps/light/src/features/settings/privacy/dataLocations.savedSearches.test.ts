/**
 * L-309: the app also keeps your saved searches in its browser storage
 * (`cviper.light.savedSearches`). The privacy policy's list says so, and
 * "Delete everything" clears them with the rest.
 */
import { describe, expect, it } from 'vitest';

import { SAVED_SEARCHES_STORAGE_KEY } from '../../search/savedSearches';
import { LOCAL_STORAGE_PREFIX } from '../erase/port';

import { DATA_LOCATIONS } from './dataLocations';

const BROWSER_STORAGE = DATA_LOCATIONS.find((location) =>
  location.where.includes('browser storage'),
);

describe('saved searches in the privacy policy (L-309)', () => {
  it('are named beside the other small conveniences', () => {
    expect(BROWSER_STORAGE?.what).toContain('your saved searches');
    expect(BROWSER_STORAGE?.what).toContain('your last search');
  });

  it('and are erased by "Delete everything" like the rest', () => {
    expect(SAVED_SEARCHES_STORAGE_KEY.startsWith(LOCAL_STORAGE_PREFIX)).toBe(true);
    expect(BROWSER_STORAGE?.erasedBy).toBe('preferences');
  });
});
