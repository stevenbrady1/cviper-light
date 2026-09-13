/**
 * Every source an advert can carry has a name a person can read.
 *
 * The card used to derive its chip with `job.source === 'adzuna' ? 'adzuna' :
 * 'reed'`, which was true while there were two boards and quietly labels a
 * Guardian advert "Reed" the moment there are four. A ternary cannot be
 * exhaustive; a `Record<JobSource, string>` is, and TypeScript fails the build
 * when a source is added without a name.
 */
import { describe, expect, it } from 'vitest';

import { JobSchema } from '@cviper/core-types';

import { SOURCE_LABEL } from './sources';

describe('SOURCE_LABEL', () => {
  it('names every source the data model allows', () => {
    // Read off the schema rather than retyped, so this cannot drift from the
    // union it is meant to cover.
    for (const source of JobSchema.shape.source.options) {
      expect(SOURCE_LABEL[source], source).toBeTruthy();
    }
  });

  it('names the two keyless feeds as the feeds they are', () => {
    expect(SOURCE_LABEL.arbeitnow).toBe('Arbeitnow');
    expect(SOURCE_LABEL.guardian).toBe('Guardian Jobs');
  });

  it('agrees with the keyed providers’ own labels', () => {
    expect(SOURCE_LABEL.adzuna).toBe('Adzuna');
    expect(SOURCE_LABEL.reed).toBe('Reed');
  });
});
