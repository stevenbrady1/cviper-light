/**
 * Ported from `backend/ai/keywords.py::_plural_variants` (line 85) and the
 * guards documented above it (lines 57-82).
 */
import { describe, expect, it } from 'vitest';
import { PLURAL_EXEMPT, PLURAL_MIN_LEN, pluralVariants } from './plurals';

/** Set equality, order-independent, for readable failure output. */
function variantsOf(term: string): string[] {
  return [...pluralVariants(term)].sort();
}

describe('pluralVariants', () => {
  it('adds the simple plural to a singular token', () => {
    expect(variantsOf('developer')).toEqual(['developer', 'developers']);
  });

  it('strips the simple plural from a plural token', () => {
    expect(variantsOf('containers')).toEqual(['container', 'containers']);
  });

  // NEGATIVE — short tokens must never fold. "ios" folding to "io" was the
  // exact mis-match this guard was written for.
  it.each(['ios', 'aws', 'api', 'go', 'r'])('never folds the short token %s', (term) => {
    expect(variantsOf(term)).toEqual([term]);
  });

  // NEGATIVE — symbol-bearing tokens are whole identifiers, not words.
  it.each(['c#', '.net', 'ci/cd', 'node.js', 'c++'])(
    'never folds the symbol-bearing token %s',
    (term) => {
      expect(variantsOf(term)).toEqual([term]);
    },
  );

  // NEGATIVE — -ss / -us / -is endings are not plurals.
  it.each(['class', 'status', 'redis', 'analysis', 'express', 'less', 'sass', 'css'])(
    'never strips the trailing s from %s',
    (term) => {
      expect(pluralVariants(term).has(term.slice(0, -1))).toBe(false);
    },
  );

  // NEGATIVE — curated exceptions that look like plurals and are not.
  it.each(['kubernetes', 'jenkins', 'devops', 'https', 'cors', 'kudos'])(
    'never folds the curated exception %s',
    (term) => {
      expect(variantsOf(term)).toEqual([term]);
    },
  );

  // BOUNDARY — exactly at the minimum length, and one below it.
  it('folds at exactly PLURAL_MIN_LEN and not one character below', () => {
    expect(PLURAL_MIN_LEN).toBe(4);
    expect(pluralVariants('java').size).toBe(2); // 4 chars — folds
    expect(pluralVariants('gcp').size).toBe(1); // 3 chars — does not
  });

  // BOUNDARY
  it('returns just the term for empty input', () => {
    expect(variantsOf('')).toEqual(['']);
  });

  it('carries the source exemption list', () => {
    expect(PLURAL_EXEMPT.has('kubernetes')).toBe(true);
    expect(PLURAL_EXEMPT.has('developer')).toBe(false);
  });
});
