/**
 * Description fingerprinting for cross-post detection.
 *
 * PORTED FROM: backend/helpers/dedupe_fingerprint.py  (CViper repo, @ d15c7b4b)
 *
 * Upstream drift is pinned in CViper's `docs/port-parity-manifest.yaml`; its
 * guard fails there when this source changes. This is a FIDELITY port — the bit
 * layout must stay identical or the two products disagree about what counts as
 * a duplicate. Anything in that file's `FINGERPRINT_VERSION` bump list changes
 * the computed value, not just the decision.
 *
 * ============================================================================
 * WHY
 * ============================================================================
 * In London banking and finance the same client role is routinely reposted by
 * Reed, Hays and Robert Half with the company field set to the AGENCY name - or
 * to "Confidential". So the strongest available evidence that two postings are
 * the same role is the one field the agencies copy and paste: the description.
 *
 * This module turns a description into a 64-bit SimHash, so near-duplicate text
 * can be compared as a Hamming distance instead of a string comparison.
 *
 * ============================================================================
 * WHAT WAS DELIBERATELY LEFT OUT OF THE PORT
 * ============================================================================
 * The source keeps 64 per-bit counters packed into ONE Python integer as 32-bit
 * lanes, with eight precomputed 256-entry tables, because a plain per-bit loop
 * measured 190ms for a 100-job batch in CPython. That is a Python-loop-speed
 * workaround, not an algorithm. A straightforward 64-iteration loop is used
 * here instead: at most 100 adverts per search, and the result is code a
 * reviewer can actually check. The bit layout is preserved exactly - lane `L`
 * is bit `L % 8` of digest byte `L / 8` - so the values agree with the source's
 * to the bit, which `fingerprint.test.ts` pins against real Python output.
 */
import { md5Of } from './md5';
import { unescapeHtmlEntities } from './text';

/**
 * A fingerprint value is only comparable to another produced by the SAME
 * algorithm.
 *
 * BUMP THIS whenever any of the following changes:
 *   * `normaliseTokens` (lowercase / unescape order, tag regex, punctuation
 *     regex, whitespace handling)
 *   * the named-entity table in `text.ts`, which `normaliseTokens` uses
 *   * `SHINGLE_SIZE`
 *   * `MIN_FINGERPRINT_TOKENS` (it changes which jobs have a fingerprint at all)
 *   * `FINGERPRINT_BITS` or the bit layout
 *   * the digest function (`md5Of`) or its input encoding
 *   * the majority tie-break (`count * 2 > total`)
 *
 * `MERGE_MAX_HAMMING` is NOT in this list: it changes the decision, not the
 * value, so stored fingerprints stay comparable across a threshold change.
 */
export const FINGERPRINT_VERSION = 1;

export const FINGERPRINT_BITS = 64;

/** Words per shingle. */
export const SHINGLE_SIZE = 3;

/**
 * Below this many normalised tokens a SimHash is dominated by a handful of
 * shingles and stops discriminating, so we return no fingerprint at all rather
 * than a fingerprint we do not trust. No fingerprint means the description can
 * never contribute to a duplicate claim.
 */
export const MIN_FINGERPRINT_TOKENS = 20;

/**
 * The duplicate band, INCLUSIVE: a distance of exactly this matches, one more
 * does not. `isDuplicateMatch` is the single place that comparison is written,
 * so no caller ever re-derives the operator.
 *
 * PROVISIONAL, and the source says so too - it was calibrated against synthetic
 * agency-rewrite fixtures. Measured against this package's own fixtures, a
 * single reworded phrase in an 88-token advert moves the fingerprint by 3 bits
 * and two or three reworded phrases move it by 5 to 8. So this threshold
 * catches near-verbatim reposts and deliberately misses looser rewrites. That
 * is the right way round for an app whose job is to never hide a real advert:
 * a missed duplicate costs a scroll, a false one costs an application.
 */
export const MERGE_MAX_HAMMING = 3;

/**
 * A letter is REQUIRED after the optional slash. `<[^>]*>` would also match
 * "<100k but >" in the unescaped text of "salary &lt;100k but &gt;80k",
 * swallowing the salary range - a common phrasing in job descriptions.
 *
 * Deliberately a SEPARATE copy of the regex in `text.ts` rather than a shared
 * import: that one shapes what a person reads, this one is an input to a
 * versioned hash. Sharing it would mean a cosmetic tweak to display formatting
 * silently invalidated every fingerprint ever stored, with no error.
 */
const TAG = /<\/?[a-zA-Z][^>]*>/g;

/**
 * Python's `re.compile(r"[^\w\s]", re.UNICODE)`.
 *
 * `\w` there is "alphanumeric or underscore", unicode-aware, which is
 * `\p{L}`, `\p{N}` and `_` here. Accented word characters are PRESERVED - this
 * is text, not an ASCII slug.
 */
const PUNCTUATION = /[^\p{L}\p{N}_\s]/gu;

const MASK_64 = (1n << 64n) - 1n;

/**
 * lowercase -> HTML-entity unescape -> lowercase AGAIN -> strip tags -> strip
 * punctuation -> collapse whitespace.
 *
 * Descriptions reach us as scraped HTML, so `&amp;` / `&#163;` and `<p>`
 * wrappers must not change the identity of otherwise identical copy.
 *
 * ============================================================================
 * THE SECOND `toLowerCase()` IS A CORRECTNESS FIX, NOT A TYPO.
 * ============================================================================
 * Numeric entities decode to uppercase (`&#65;` -> "A"), so a single
 * pre-unescape lowercase leaks case back in and two identical descriptions
 * stop fingerprinting alike. Lowercasing FIRST is also what makes the entity
 * table case-insensitive: `&AMP;` and `&amp;` are the same string by the time
 * the table is consulted.
 *
 * Anything that is not a string yields no tokens, and therefore no
 * fingerprint. This runs over every description on the search path, so a
 * malformed provider response must degrade to "no fingerprint" rather than
 * throw - an exception here would lose the whole search.
 */
export function normaliseTokens(text: unknown): string[] {
  if (typeof text !== 'string' || text === '') return [];

  const unescaped = unescapeHtmlEntities(text.toLowerCase()).toLowerCase();
  const untagged = unescaped.replace(TAG, ' ');
  const depunctuated = untagged.replace(PUNCTUATION, ' ');

  return depunctuated.split(/\s+/).filter((token) => token !== '');
}

/**
 * Overlapping word n-grams.
 *
 * Word ORDER matters for job specs: two postings that share a vocabulary but
 * sequence it differently are different postings.
 */
export function shingles(tokens: readonly string[]): string[] {
  if (tokens.length < SHINGLE_SIZE) return tokens.length === 0 ? [] : [tokens.join(' ')];

  const result: string[] = [];
  for (let start = 0; start <= tokens.length - SHINGLE_SIZE; start += 1) {
    result.push(tokens.slice(start, start + SHINGLE_SIZE).join(' '));
  }
  return result;
}

/**
 * The 64-bit SimHash of a job description, or `null` when the text is too short
 * to fingerprint reliably or is not a string at all.
 *
 * Only comparable to another fingerprint produced at the same
 * `FINGERPRINT_VERSION` - read that constant before changing anything here.
 */
export function computeFingerprint(description: unknown): bigint | null {
  const tokens = normaliseTokens(description);
  if (tokens.length < MIN_FINGERPRINT_TOKENS) return null;

  const grams = shingles(tokens);

  // One counter per output bit. Plain numbers: the count cannot exceed the
  // number of shingles in one description, which is thousands at most.
  const counters = new Array<number>(FINGERPRINT_BITS).fill(0);

  // Repeated shingles are counted repeatedly - that is the frequency weighting
  // a classic SimHash applies.
  for (const gram of grams) {
    const digest = md5Of(gram);
    for (let bit = 0; bit < FINGERPRINT_BITS; bit += 1) {
      // Bit `b` of digest byte `n` lands at output bit `n * 8 + b`. This is the
      // source's lane layout, not the textbook one; Hamming distance is
      // permutation-invariant so it changes no threshold, but it does change
      // the VALUE, which is why it is reproduced exactly.
      const byte = digest[bit >> 3] ?? 0;
      if (((byte >> (bit & 7)) & 1) === 1) counters[bit] = (counters[bit] ?? 0) + 1;
    }
  }

  let fingerprint = 0n;
  for (let bit = 0; bit < FINGERPRINT_BITS; bit += 1) {
    // Set the bit when a STRICT majority of shingles had it set - identical to
    // the textbook "+1/-1 sum > 0".
    if ((counters[bit] ?? 0) * 2 > grams.length) fingerprint |= 1n << BigInt(bit);
  }

  return fingerprint;
}

/** How many bits differ between two fingerprints. */
export function hammingDistance(left: bigint, right: bigint): number {
  let difference = (left ^ right) & MASK_64;
  let bits = 0;
  while (difference !== 0n) {
    // `& 1n` rather than a `Number()` conversion: the top bit of a 64-bit value
    // does not survive a conversion to a JavaScript number intact.
    if ((difference & 1n) === 1n) bits += 1;
    difference >>= 1n;
  }
  return bits;
}

/**
 * Are these two descriptions close enough to call the same posting?
 *
 * The boundary is INCLUSIVE: a distance of exactly `MERGE_MAX_HAMMING` matches,
 * one more does not.
 *
 * A missing fingerprint on either side NEVER matches. An absent discriminator
 * is not a weak signal, it is no signal - precision over recall, the same
 * posture as the source's "a missing company never merges".
 */
export function isDuplicateMatch(left: bigint | null, right: bigint | null): boolean {
  if (left === null || right === null) return false;
  return hammingDistance(left, right) <= MERGE_MAX_HAMMING;
}

/**
 * The stored form of a fingerprint: a DECIMAL STRING.
 *
 * ============================================================================
 * NOT A NUMBER. THIS IS NOT A STYLE CHOICE.
 * ============================================================================
 * A 64-bit value with the top bit set is beyond what a JavaScript number holds
 * exactly, and beyond SQLite's comfortable integer range. Stored as a number it
 * comes back subtly different, the Hamming distance to its own original is not
 * zero, and cross-batch duplicate detection quietly degrades to nothing with no
 * error and no log line. Both fixture fingerprints in this package have the top
 * bit set, so this is the common case rather than an edge one.
 */
export function fingerprintToStorage(fingerprint: bigint): string {
  return (fingerprint & MASK_64).toString(10);
}

/** Read a stored fingerprint back, or `null` if it is not one. */
export function fingerprintFromStorage(raw: unknown): bigint | null {
  // Digits only. `BigInt` accepts "0x1f", " 12 " and "" - all of which mean
  // something went wrong upstream rather than "here is a fingerprint".
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;

  const value = BigInt(raw);
  return value <= MASK_64 ? value : null;
}
