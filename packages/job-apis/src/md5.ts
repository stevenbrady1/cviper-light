/**
 * MD5, in about eighty lines, because the fingerprint needs a digest that is
 * the SAME on every platform and available synchronously.
 *
 * ============================================================================
 * WHY THIS IS HERE AND NOT A DEPENDENCY OR A BUILT-IN.
 * ============================================================================
 * `node:crypto` does not exist in the WebView this package is compiled into.
 * Web Crypto's `subtle.digest` exists in both, but it is asynchronous and does
 * not offer MD5 at all. A package from npm would be a supply-chain risk for
 * eighty lines of arithmetic - the same reasoning that kept the Python source
 * on `hashlib` rather than a simhash library.
 *
 * ============================================================================
 * NOT A SECURITY PRIMITIVE. NOT USED AS ONE.
 * ============================================================================
 * MD5 is broken for anything that needs collision resistance against an
 * attacker, and nothing here needs that. It is used as a fast, stable,
 * well-specified way to spread a short string across 128 bits, exactly as the
 * source module uses it. It must never be used to hash a password, sign
 * anything, or check that a file is what it claims to be.
 *
 * The reason it has to be MD5 specifically, rather than any cheap hash, is
 * that `FINGERPRINT_VERSION` promises a fingerprint computed here is
 * comparable with one computed by the web application - and the source names
 * the digest function as one of the things that forces a version bump.
 *
 * Pinned against the RFC 1321 test suite in `md5.test.ts`.
 */

/** Per-round left-rotation amounts. RFC 1321, section 3.4. */
const SHIFTS: readonly number[] = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/**
 * `K[i] = floor(abs(sin(i + 1)) * 2^32)`.
 *
 * Written out rather than computed at module load, because `Math.sin` is not
 * required to be bit-identical between JavaScript engines and a one-unit
 * difference here would change every fingerprint the app produces.
 */
const SINE: readonly number[] = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

const ENCODER = new TextEncoder();

function rotateLeft(value: number, amount: number): number {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

/** The 16-byte MD5 digest of `text`, hashed as UTF-8. */
export function md5Of(text: string): Uint8Array {
  const input = ENCODER.encode(text);

  // One 0x80 byte, then zeroes, then the original length in bits as a 64-bit
  // little-endian integer - and the whole thing a multiple of 64 bytes.
  const blocks = Math.floor((input.length + 8) / 64) + 1;
  const padded = new Uint8Array(blocks * 64);
  padded.set(input);
  padded[input.length] = 0x80;

  const view = new DataView(padded.buffer);
  const bits = input.length * 8;
  view.setUint32(padded.length - 8, bits >>> 0, true);
  // The high word. Only reachable for inputs over 512 MB, which this package
  // never sees, but a length field that silently wraps is not a length field.
  view.setUint32(padded.length - 4, Math.floor(bits / 0x1_0000_0000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const words = new Array<number>(16);

  for (let start = 0; start < padded.length; start += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(start + index * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let round = 0; round < 64; round += 1) {
      let mixed: number;
      let wordIndex: number;

      if (round < 16) {
        mixed = (b & c) | (~b & d);
        wordIndex = round;
      } else if (round < 32) {
        mixed = (d & b) | (~d & c);
        wordIndex = (5 * round + 1) % 16;
      } else if (round < 48) {
        mixed = b ^ c ^ d;
        wordIndex = (3 * round + 5) % 16;
      } else {
        mixed = c ^ (b | ~d);
        wordIndex = (7 * round) % 16;
      }

      // `noUncheckedIndexedAccess` is on, so every lookup is `| undefined` to
      // the type system. The indices are provably in range - `round` is bounded
      // by the loop and `wordIndex` by the modulus - so `?? 0` is unreachable
      // rather than a silent default.
      const sum = (mixed + a + (SINE[round] ?? 0) + (words[wordIndex] ?? 0)) >>> 0;

      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(sum, SHIFTS[round] ?? 0)) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const digest = new Uint8Array(16);
  const digestView = new DataView(digest.buffer);
  digestView.setUint32(0, a0, true);
  digestView.setUint32(4, b0, true);
  digestView.setUint32(8, c0, true);
  digestView.setUint32(12, d0, true);
  return digest;
}

/** The same digest as lowercase hex. Used by the tests and by nothing else. */
export function md5Hex(text: string): string {
  return Array.from(md5Of(text), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
