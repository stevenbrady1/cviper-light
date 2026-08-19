/**
 * MD5, checked against known answers.
 *
 * A hand-written digest is only trustworthy if it is pinned to values produced
 * by something else. The first seven cases are the official test suite from
 * RFC 1321 appendix A.5. The rest were produced by Node's `crypto.createHash`
 * and cover the message lengths where the padding rule changes, which is where
 * every hand-rolled MD5 goes wrong.
 *
 * `node:crypto` is deliberately not imported here: this package is compiled
 * into a browser WebView, where it does not exist, so a test that leaned on it
 * would be testing a code path the app never runs.
 */
import { describe, expect, it } from 'vitest';

import { md5Hex, md5Of } from './md5';

describe('md5 — the RFC 1321 test suite', () => {
  const RFC_1321: readonly [string, string][] = [
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    [
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      'd174ab98d277d9f5a5611c2c9f419d9f',
    ],
    [
      '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
      '57edf4a22be3c955ac49da2e2107b67a',
    ],
  ];

  it.each(RFC_1321)('digests %j', (input, expected) => {
    expect(md5Hex(input)).toBe(expected);
  });
});

describe('md5 — the padding boundaries', () => {
  // 55 bytes is the largest message whose length still fits in the same block
  // as the 0x80 terminator and the 8-byte length. 56 forces a second block, and
  // 64 and 120 are exact block multiples. Every one of these is a place a
  // hand-written implementation silently produces the wrong answer.
  const LENGTHS: readonly [number, string][] = [
    [55, '04364420e25c512fd958a70738aa8f72'],
    [56, '668a72d5ba17f08e62dabcafad6db14b'],
    [63, '7dc2ca208106a2f703567bdff99d8981'],
    [64, 'c1bb4f81d892b2d57947682aeb252456'],
    [65, '1bc932052302d074bdec39795fe00cf6'],
    [119, 'ab347a5f68c8a443cfcddc633f12c24f'],
    [120, 'fb98667f98096de92620b64f46e1c5b5'],
  ];

  it.each(LENGTHS)('digests %i bytes', (length, expected) => {
    expect(md5Hex('x'.repeat(length))).toBe(expected);
  });
});

describe('md5 — text that is not ASCII', () => {
  it('hashes the UTF-8 bytes, not the code units', () => {
    // Job adverts contain pound signs and accented names. A digest taken over
    // UTF-16 code units would disagree with every other MD5 in the world, and
    // the fingerprints built on it would not survive a change of platform.
    expect(md5Hex('£ é \u{1F4C8} naïve')).toBe('4847b17c05d1423d90cc7109a07b819a');
  });
});

describe('md5 — the digest itself', () => {
  it('is sixteen bytes', () => {
    expect(md5Of('anything')).toHaveLength(16);
  });

  it('is deterministic across calls, which is the whole point', () => {
    // The built-in `hash()` in Python is salted per process; that is exactly
    // why the source module uses md5 and why this one does too. A fingerprint
    // that changes between runs cannot be persisted or compared.
    expect(md5Hex('Credit Risk Analyst')).toBe(md5Hex('Credit Risk Analyst'));
  });

  it('boundary: an empty string hashes without error', () => {
    expect(md5Of('')).toHaveLength(16);
  });
});
