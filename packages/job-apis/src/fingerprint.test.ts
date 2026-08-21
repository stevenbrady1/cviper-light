/**
 * The cross-post fingerprint, pinned against the Python original.
 *
 * The expected values below were produced by running
 * `backend/core/dedupe_fingerprint.py` from the CViper web application over
 * the SAME fixture text. They are not "whatever this implementation happens to
 * produce" - they are the answer the algorithm is supposed to give, which is
 * what makes `FINGERPRINT_VERSION = 1` an honest claim rather than a label.
 */
import { describe, expect, it } from 'vitest';

import adzunaFixture from './fixtures/adzuna-search.json';
import reedFixture from './fixtures/reed-search.json';
import {
  FINGERPRINT_VERSION,
  MERGE_MAX_HAMMING,
  MIN_FINGERPRINT_TOKENS,
  SHINGLE_SIZE,
  computeFingerprint,
  fingerprintFromStorage,
  fingerprintToStorage,
  hammingDistance,
  isDuplicateMatch,
  normaliseTokens,
  shingles,
} from './fingerprint';

/**
 * `noUncheckedIndexedAccess` is on, so a fixture that lost a result would be a
 * compile error rather than a test that quietly asserts things about
 * `undefined`.
 */
function fixtureText(value: string | undefined, what: string): string {
  if (value === undefined) throw new Error(`the fixture no longer has ${what}`);
  return value;
}

const ADZUNA_DESCRIPTION = fixtureText(
  adzunaFixture.results[0]?.description,
  'an Adzuna description',
);
const REED_DESCRIPTION = fixtureText(reedFixture.results[0]?.jobDescription, 'a Reed description');
const REED_DAY_RATE_DESCRIPTION = fixtureText(
  reedFixture.results[1]?.jobDescription,
  'the Reed day-rate description',
);

/** Enough words to clear `MIN_FINGERPRINT_TOKENS` without saying anything. */
const FILLER =
  'with plenty of extra padding words here to pass the minimum token threshold for a fingerprint value';

describe('normaliseTokens', () => {
  it('lowercases, unescapes, strips tags and strips punctuation', () => {
    expect(normaliseTokens('<p>Credit Risk &amp; Analyst!</p>')).toEqual([
      'credit',
      'risk',
      'analyst',
    ]);
  });

  it('REGRESSION: lowercases AGAIN after unescaping', () => {
    // ==================================================================
    // THE DOUBLE LOWERCASE IS A REAL CORRECTNESS FIX, NOT A TYPO.
    // ==================================================================
    // Numeric entities decode to uppercase (`&#65;` -> "A"), so a single
    // pre-unescape `toLowerCase()` leaks case back in and two identical
    // descriptions stop fingerprinting alike.
    expect(normaliseTokens('&#65;cme Bank')).toEqual(['acme', 'bank']);
    expect(normaliseTokens('&#65;cme Bank')).toEqual(normaliseTokens('Acme Bank'));
  });

  it('an entity name is matched whatever case the advert wrote it in', () => {
    // Because the text is lowercased BEFORE the entity pass, `&AMP;` and
    // `&amp;` are the same by the time the table is consulted.
    expect(normaliseTokens('R&AMP;D team')).toEqual(normaliseTokens('R&amp;D team'));
  });

  it('REGRESSION: does not let the tag regex eat a salary range', () => {
    // `<[^>]*>` would match "<100k but >" in the unescaped text and swallow the
    // range. A letter is REQUIRED after the optional slash.
    expect(normaliseTokens('salary &lt;100k but &gt;80k')).toEqual([
      'salary',
      '100k',
      'but',
      '80k',
    ]);
  });

  it('keeps accented word characters - this is text, not an ASCII slug', () => {
    expect(normaliseTokens('Café Zürich naïve')).toEqual(['café', 'zürich', 'naïve']);
  });

  it('negative: anything that is not a string yields no tokens', () => {
    // Dedupe runs over every description on the search path, so a bytes
    // payload or an object from a malformed provider response must degrade to
    // "no fingerprint", never throw - an exception here would lose the whole
    // search.
    for (const bad of [null, undefined, 42, {}, [], '']) {
      expect(normaliseTokens(bad)).toEqual([]);
    }
  });
});

describe('shingles', () => {
  it('produces overlapping word n-grams', () => {
    // Word ORDER matters for job specs: two postings that share a vocabulary
    // but sequence it differently are different postings.
    expect(shingles(['a', 'b', 'c', 'd'])).toEqual(['a b c', 'b c d']);
  });

  it('the shingle size is three words', () => {
    expect(SHINGLE_SIZE).toBe(3);
  });

  it('boundary: fewer tokens than a shingle collapses to a single one', () => {
    expect(shingles(['a', 'b'])).toEqual(['a b']);
    expect(shingles(['a'])).toEqual(['a']);
  });

  it('boundary: no tokens produces no shingles', () => {
    expect(shingles([])).toEqual([]);
  });
});

describe('computeFingerprint — parity with the Python original', () => {
  it('matches the value the source module computes for the Adzuna advert', () => {
    expect(computeFingerprint(ADZUNA_DESCRIPTION)).toBe(11891954719471477322n);
  });

  it('matches the value the source module computes for the Reed cross-post', () => {
    expect(computeFingerprint(REED_DESCRIPTION)).toBe(11898710118913057354n);
  });

  it('matches for an advert whose text is entity-escaped HTML', () => {
    expect(computeFingerprint(REED_DAY_RATE_DESCRIPTION)).toBe(14298142179187429471n);
  });

  it('matches for text exercising the double-lowercase path', () => {
    const withEntity = `Salary &lt;100k but &gt;80k and R&amp;D work at &#65;cme ${FILLER}`;
    expect(computeFingerprint(withEntity)).toBe(3969454833548251455n);
  });

  it('the version is 1, and the value above is what makes that honest', () => {
    expect(FINGERPRINT_VERSION).toBe(1);
  });
});

describe('computeFingerprint — the minimum length', () => {
  it('boundary: exactly the minimum number of tokens produces a fingerprint', () => {
    const tokens = Array.from({ length: MIN_FINGERPRINT_TOKENS }, (_, index) => `word${index}`);
    expect(computeFingerprint(tokens.join(' '))).not.toBeNull();
  });

  it('boundary: one token short produces none', () => {
    // Below this many tokens a SimHash is dominated by a handful of shingles
    // and stops discriminating, so we return no fingerprint at all rather than
    // one we do not trust.
    const tokens = Array.from({ length: MIN_FINGERPRINT_TOKENS - 1 }, (_, index) => `word${index}`);
    expect(computeFingerprint(tokens.join(' '))).toBeNull();
  });

  it('the minimum is twenty tokens', () => {
    expect(MIN_FINGERPRINT_TOKENS).toBe(20);
  });

  it('negative: an empty or non-string description has no fingerprint', () => {
    for (const bad of ['', '   ', null, undefined, 42, {}]) {
      expect(computeFingerprint(bad)).toBeNull();
    }
  });

  it('is deterministic - the same text always gives the same value', () => {
    expect(computeFingerprint(ADZUNA_DESCRIPTION)).toBe(computeFingerprint(ADZUNA_DESCRIPTION));
  });
});

describe('hammingDistance and the duplicate band', () => {
  it('the two cross-posted fixtures are within the band', () => {
    const left = computeFingerprint(ADZUNA_DESCRIPTION);
    const right = computeFingerprint(REED_DESCRIPTION);
    if (left === null || right === null) throw new Error('both fixtures must fingerprint');

    expect(hammingDistance(left, right)).toBe(3);
    expect(isDuplicateMatch(left, right)).toBe(true);
  });

  it('two unrelated adverts are nowhere near it', () => {
    const left = computeFingerprint(ADZUNA_DESCRIPTION);
    const right = computeFingerprint(REED_DAY_RATE_DESCRIPTION);
    if (left === null || right === null) throw new Error('both fixtures must fingerprint');

    expect(hammingDistance(left, right)).toBeGreaterThan(MERGE_MAX_HAMMING);
    expect(isDuplicateMatch(left, right)).toBe(false);
  });

  it('boundary: the band is INCLUSIVE - three matches, four does not', () => {
    // Constructed by flipping exact bits rather than by writing text, because
    // the comparison operator is the thing under test and it must be pinned
    // exactly. `MERGE_MAX_HAMMING + 1` must not match.
    const base = 0x0123_4567_89ab_cdefn;
    const flipThree = base ^ 0b111n;
    const flipFour = base ^ 0b1111n;

    expect(hammingDistance(base, flipThree)).toBe(3);
    expect(hammingDistance(base, flipFour)).toBe(4);
    expect(isDuplicateMatch(base, flipThree)).toBe(true);
    expect(isDuplicateMatch(base, flipFour)).toBe(false);
  });

  it('boundary: identical fingerprints are distance zero', () => {
    expect(hammingDistance(42n, 42n)).toBe(0);
  });

  it('boundary: opposite fingerprints are distance sixty-four', () => {
    expect(hammingDistance(0n, 0xffff_ffff_ffff_ffffn)).toBe(64);
  });

  it('counts a difference in the TOP bit, which is where a naive mask fails', () => {
    expect(hammingDistance(0n, 0x8000_0000_0000_0000n)).toBe(1);
  });

  it('negative: a missing fingerprint on either side never matches', () => {
    // An absent discriminator is not a weak signal, it is no signal. Precision
    // over recall - the same posture as "missing company never merges".
    expect(isDuplicateMatch(null, 42n)).toBe(false);
    expect(isDuplicateMatch(42n, null)).toBe(false);
    expect(isDuplicateMatch(null, null)).toBe(false);
  });

  it('the band is three, inclusive', () => {
    expect(MERGE_MAX_HAMMING).toBe(3);
  });
});

describe('decimal-string persistence', () => {
  it('round-trips a fingerprint with the TOP BIT SET', () => {
    // ==================================================================
    // WHY THE STORED FORM IS A DECIMAL STRING AND NOT A NUMBER.
    // ==================================================================
    // A 64-bit value with the top bit set is outside the range a JavaScript
    // number can hold exactly and outside SQLite's comfortable integer range.
    // One text representation behaves the same everywhere.
    const topBitSet = 0xffff_ffff_ffff_ffffn;

    expect(fingerprintToStorage(topBitSet)).toBe('18446744073709551615');
    expect(fingerprintFromStorage(fingerprintToStorage(topBitSet))).toBe(topBitSet);
  });

  it('round-trips the real fixture fingerprints, both of which have the top bit set', () => {
    for (const description of [ADZUNA_DESCRIPTION, REED_DESCRIPTION]) {
      const fingerprint = computeFingerprint(description);
      if (fingerprint === null) throw new Error('fixture must fingerprint');

      expect(fingerprint >> 63n).toBe(1n);
      expect(fingerprintFromStorage(fingerprintToStorage(fingerprint))).toBe(fingerprint);
    }
  });

  it('REGRESSION: the value would not survive a round trip through a JS number', () => {
    // This is the failure the decimal string prevents, asserted directly so
    // nobody "simplifies" the column back to an integer.
    const fingerprint = 11891954719471477322n;
    expect(BigInt(Number(fingerprint))).not.toBe(fingerprint);
    expect(fingerprintFromStorage(fingerprintToStorage(fingerprint))).toBe(fingerprint);
  });

  it('boundary: zero and the maximum both survive', () => {
    for (const value of [0n, 1n, 0xffff_ffff_ffff_ffffn]) {
      expect(fingerprintFromStorage(fingerprintToStorage(value))).toBe(value);
    }
  });

  it('negative: refuses anything that is not a plain decimal string', () => {
    for (const bad of [
      '',
      ' 12 ',
      '-1',
      '1.5',
      '0x1f',
      '1e10',
      'NaN',
      '18446744073709551616',
      null,
      undefined,
      42,
      42n,
    ]) {
      expect(fingerprintFromStorage(bad)).toBeNull();
    }
  });
});
