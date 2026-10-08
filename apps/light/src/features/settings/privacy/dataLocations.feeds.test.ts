/**
 * L-220: since L-219 the app also remembers which free job feeds you ticked
 * (`cviper.light.search.feeds`). The privacy policy's list of what is kept in
 * the app's browser storage says so.
 */
import { describe, expect, it } from 'vitest';

import { FEED_CHOICE_KEY } from '../../search/feedDefaults';
import { LOCAL_STORAGE_PREFIX } from '../erase/port';

import { DATA_LOCATIONS } from './dataLocations';

const BROWSER_STORAGE = DATA_LOCATIONS.find((location) =>
  location.where.includes('browser storage'),
);

describe('browser storage in the privacy policy (L-220)', () => {
  it('names the free-feed choice beside the other small conveniences', () => {
    expect(BROWSER_STORAGE?.what).toContain('which free job feeds you ticked');
    expect(BROWSER_STORAGE?.what).toContain('your last search');
  });

  it('and that choice is erased by "Delete everything" like the rest', () => {
    expect(FEED_CHOICE_KEY.startsWith(LOCAL_STORAGE_PREFIX)).toBe(true);
    expect(BROWSER_STORAGE?.erasedBy).toBe('preferences');
  });
});
