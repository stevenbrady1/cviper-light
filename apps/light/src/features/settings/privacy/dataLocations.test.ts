import { describe, expect, it } from 'vitest';

import { DATA_LOCATIONS } from './dataLocations';

/**
 * L-133: "Your jobs, applications, CV text and every analysis" did not
 * mention that a CV's row also carries the file path it was added from —
 * usually `C:\Users\<name>\...` on Windows — so a reader had no way to know
 * that detail existed, let alone that `backup.ts` now deliberately drops it
 * from every export. This is the sentence that tells them.
 */
function findEntry() {
  return DATA_LOCATIONS.find((location) => location.what.toLowerCase().includes('came from'));
}

describe('the CV file-path location (L-133)', () => {
  it('is in the list', () => {
    expect(findEntry()).toBeDefined();
  });

  it('says the path stays on this computer', () => {
    expect(findEntry()?.where).toContain('this computer');
  });

  it('says an export leaves it out', () => {
    expect(findEntry()?.where.toLowerCase()).toContain('export');
  });

  it('boundary: like every other location, it is erased by a step that actually runs', () => {
    const entry = findEntry();
    expect(entry?.erasedBy).toBeDefined();
    expect(['database', 'keys', 'preferences']).toContain(entry?.erasedBy);
  });
});
