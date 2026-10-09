/**
 * L-147: a CV's file path is no longer kept (never written, and migration
 * 0009 cleared the old ones), so the privacy policy no longer lists it — and
 * nothing in it claims the app knows where a CV file came from.
 */
import { describe, expect, it } from 'vitest';

import { DATA_LOCATIONS } from './dataLocations';
import { currentPrivacyPolicy } from './policyDocument';

describe('the CV file path is not a stored thing any more (L-147)', () => {
  it('no data location names a file path or where a CV came from', () => {
    for (const location of DATA_LOCATIONS) {
      expect(`${location.what} ${location.where}`.toLowerCase()).not.toMatch(
        /came from|full path|file path/,
      );
    }
  });

  it('negative: the rendered policy says nothing of the kind either', () => {
    expect(currentPrivacyPolicy().toLowerCase()).not.toMatch(
      /came from on this computer|full path/,
    );
  });
});
