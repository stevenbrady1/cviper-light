/**
 * L-344: the count in the "too short" refusals. Exact matches on purpose:
 * "1 characters" contains "1 character", so `toContain` could not fail.
 */
import { describe, expect, it } from 'vitest';
import { isErr } from '@cviper/core-types';

import { MIN_SCORABLE_CHARS, scoreByKeywords } from './score';

const LONG_ENOUGH = 'Business Analyst wanted with strong SQL skills';

function refusal(cv: string, advert: string): string {
  const result = scoreByKeywords(cv, advert);
  if (!isErr(result)) throw new Error('expected a refusal');
  return result.error.message;
}

const cvRefusal = (count: string) =>
  `That CV is only ${count} long, and at least ${MIN_SCORABLE_CHARS} are needed before a keyword ` +
  'comparison says anything useful. If your CV is a scan or a photo, the text could not be read ' +
  'out of it — try the original Word or PDF file you exported.';

const advertRefusal = (count: string) =>
  `That job advert is only ${count} long, and at least ${MIN_SCORABLE_CHARS} are needed for a ` +
  'keyword comparison to mean anything. Paste the full advert, including the requirements, ' +
  'rather than just the job title.';

describe('the count of characters in a refusal (L-344)', () => {
  it('boundary: a one-character CV says "1 character"', () => {
    expect(refusal('x', LONG_ENOUGH)).toBe(cvRefusal('1 character'));
  });

  it('boundary: a one-character advert says "1 character"', () => {
    expect(refusal(LONG_ENOUGH, 'x')).toBe(advertRefusal('1 character'));
  });

  it('negative: neither ever says "1 characters"', () => {
    expect(refusal('x', LONG_ENOUGH)).not.toMatch(/\b1 characters\b/);
    expect(refusal(LONG_ENOUGH, 'x')).not.toMatch(/\b1 characters\b/);
  });

  it('two characters stay plural', () => {
    expect(refusal('xy', LONG_ENOUGH)).toBe(cvRefusal('2 characters'));
    expect(refusal(LONG_ENOUGH, 'xy')).toBe(advertRefusal('2 characters'));
  });

  it('zero characters is a different refusal, with no count in it', () => {
    expect(refusal('', LONG_ENOUGH)).not.toMatch(/\d characters?\b/);
    expect(refusal(LONG_ENOUGH, '')).not.toMatch(/\d characters?\b/);
  });
});
