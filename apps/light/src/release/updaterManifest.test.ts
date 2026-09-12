/**
 * The updater-manifest verifier (L-92).
 *
 * ============================================================================
 * WHAT IS BEING PROTECTED
 * ============================================================================
 * `latest.json` is the one file every installed copy of this app reads to
 * decide whether there is a new version. It names a download and carries the
 * minisign signature that download will be checked against. If it is missing,
 * unparseable, or carries signatures made by a key that no shipped binary
 * trusts, the release is broken — and broken in the direction nobody
 * investigates, because the app reports "no update" or "could not verify"
 * rather than "the release is wrong".
 *
 * So the release flow verifies it before it is published, and this is the
 * verifier.
 *
 * ============================================================================
 * THE KEYS IN THIS FILE ARE THROWAWAY AND GENERATED IN-TEST
 * ============================================================================
 * Every keypair below is created by `throwawayMinisignKeypair()` at run time
 * with `node:crypto`, used for the length of one assertion, and discarded. They
 * are labelled THROWAWAY in their own comment fields so that a key appearing in
 * a log or a failure message cannot be mistaken for the real one.
 *
 * THE REAL UPDATER KEY IS NEVER GENERATED, READ FOR ITS PRIVATE HALF, OR
 * REPLACED. Its private half exists only in this repository's Actions secrets.
 * The single place the real key appears here is `the real updater key decodes`,
 * which reads the PUBLIC half out of `tauri.conf.json` and asserts the decoder
 * produces the documented key id — see the note on that test for why a
 * fixtures-only proof would not be enough.
 *
 * ============================================================================
 * THE WIRE FORMAT, READ OUT OF THE REAL ARTEFACTS RATHER THAN ASSUMED
 * ============================================================================
 * Checked against the `light-v0.1.0` draft release and `minisign-verify` 0.2.5,
 * the crate `tauri-plugin-updater` actually verifies with:
 *
 *   * A `.sig` file is base64 of a FOUR-LINE minisign document, and the
 *     `signature` field in `latest.json` is that base64 verbatim.
 *   * Line 2 decodes to 74 bytes: 2-byte algorithm, 8-byte key id, 64-byte
 *     Ed25519 signature.
 *   * Tauri signs `ED` — PREHASHED, BLAKE2b-512 of the file — not legacy `Ed`.
 *   * Line 4 is a second Ed25519 signature over `signature || trusted_comment`,
 *     so the trusted comment cannot be edited without detection.
 *   * A key id is STORED little-endian and DISPLAYED reversed: the real key is
 *     `8F154F6BBCFC2970` on the wire and `7029FCBC6B4F158F` in every document.
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../lib/repo-scan.ts';

import {
  checkUpdaterManifest,
  decodeMinisignPublicKey,
  displayKeyId,
  type ManifestProblem,
} from './updaterManifest.ts';

/** The documented id of the live updater key. Public information. */
const REAL_KEY_ID = '7029FCBC6B4F158F';

interface Throwaway {
  readonly pubkeyBase64: string;
  readonly keyIdHex: string;
  /** A `latest.json` `signature` value over `data`. */
  readonly signatureFor: (data: Uint8Array, fileName?: string) => string;
  /** The same, but with the trusted comment rewritten AFTER signing. */
  readonly forgedCommentFor: (data: Uint8Array) => string;
}

/**
 * A complete, disposable minisign keypair.
 *
 * Labelled THROWAWAY inside the key's own comment fields so it can never be
 * confused with the live key in a log.
 */
function throwawayMinisignKeypair(): Throwaway {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const rawPublic = Buffer.from(publicKey.export({ type: 'spki', format: 'der' })).subarray(-32);
  const keyId = randomBytes(8);

  const publicBinary = Buffer.concat([Buffer.from('Ed', 'latin1'), keyId, rawPublic]);
  const publicDocument =
    `untrusted comment: THROWAWAY TEST KEY - minisign public key: ${displayKeyId(keyId)}\n` +
    `${publicBinary.toString('base64')}\n`;

  const build = (data: Uint8Array, fileName: string, commentOverride: string | null): string => {
    const prehashed = createHash('blake2b512').update(data).digest();
    const signature = sign(null, prehashed, privateKey);
    const signatureBinary = Buffer.concat([Buffer.from('ED', 'latin1'), keyId, signature]);

    const signedComment = `timestamp:0\tfile:${fileName}`;
    const globalSignature = sign(
      null,
      Buffer.concat([signature, Buffer.from(signedComment, 'utf8')]),
      privateKey,
    );

    const document =
      'untrusted comment: THROWAWAY TEST SIGNATURE\n' +
      `${signatureBinary.toString('base64')}\n` +
      `trusted comment: ${commentOverride ?? signedComment}\n` +
      `${globalSignature.toString('base64')}\n`;
    return Buffer.from(document, 'utf8').toString('base64');
  };

  return {
    pubkeyBase64: Buffer.from(publicDocument, 'utf8').toString('base64'),
    keyIdHex: displayKeyId(keyId),
    signatureFor: (data, fileName = 'installer.exe') => build(data, fileName, null),
    forgedCommentFor: (data) =>
      build(data, 'installer.exe', 'timestamp:0\tfile:something-else.exe'),
  };
}

const BUNDLE = Buffer.from('pretend this is an installer', 'utf8');

/** A manifest of the shape tauri-action actually writes. */
function manifestWith(signature: string, url = 'https://example.com/installer.exe'): string {
  return JSON.stringify({
    version: '0.2.0',
    notes: 'A release.',
    pub_date: '2026-09-01T00:00:00.000Z',
    platforms: { 'windows-x86_64': { signature, url } },
  });
}

function reasons(problems: readonly ManifestProblem[]): string {
  return problems.map((problem) => `${problem.where}: ${problem.why}`).join(' | ');
}

// ── The real key, so this is not a fixtures-only proof ──────────────────────

describe('the real updater key decodes', () => {
  // A verifier proved only against keys it generated itself is a verifier that
  // agrees with its own conventions. This is the leg that ties it to the key
  // every shipped binary actually carries. It reads the PUBLIC half only.
  const config = JSON.parse(
    readFileSync(join(REPO_ROOT, 'apps/light/src-tauri/tauri.conf.json'), 'utf8'),
  ) as { plugins?: { updater?: { pubkey?: string } } };

  it('produces the documented key id', () => {
    const pubkey = config.plugins?.updater?.pubkey;
    expect(typeof pubkey).toBe('string');

    const decoded = decodeMinisignPublicKey(String(pubkey));
    expect(decoded.keyIdHex).toBe(REAL_KEY_ID);
    expect(decoded.key).toHaveLength(32);
  });

  it('displays a key id reversed, the way minisign prints it', () => {
    // Stored little-endian, printed big-endian. Getting this backwards would
    // make every failure message name a key nobody can find.
    expect(displayKeyId(Buffer.from('8f154f6bbcfc2970', 'hex'))).toBe(REAL_KEY_ID);
  });
});

// ── The contract ────────────────────────────────────────────────────────────

describe('a manifest that is fine', () => {
  it('passes with no problems', () => {
    const key = throwawayMinisignKeypair();
    const problems = checkUpdaterManifest({
      manifestText: manifestWith(key.signatureFor(BUNDLE)),
      pubkeyBase64: key.pubkeyBase64,
    });
    expect(problems, reasons(problems)).toEqual([]);
  });

  it('passes when the bundle bytes are available and match', () => {
    const key = throwawayMinisignKeypair();
    const problems = checkUpdaterManifest({
      manifestText: manifestWith(key.signatureFor(BUNDLE)),
      pubkeyBase64: key.pubkeyBase64,
      bundleFor: () => BUNDLE,
    });
    expect(problems, reasons(problems)).toEqual([]);
  });
});

describe('a manifest that is not fine', () => {
  it('negative: a MISSING file is a failure, not an empty pass', () => {
    // The single most important case. "No manifest" must never be mistaken for
    // "no problems with the manifest".
    const key = throwawayMinisignKeypair();
    const problems = checkUpdaterManifest({
      manifestText: null,
      pubkeyBase64: key.pubkeyBase64,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.why).toContain('missing');
  });

  it('negative: a signature from a DIFFERENT key fails, and names both ids', () => {
    // The catastrophe this exists to prevent: a release signed by a key that no
    // installed copy carries. Every user would refuse the update, silently.
    const shipped = throwawayMinisignKeypair();
    const stranger = throwawayMinisignKeypair();

    const problems = checkUpdaterManifest({
      manifestText: manifestWith(stranger.signatureFor(BUNDLE)),
      pubkeyBase64: shipped.pubkeyBase64,
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.why).toContain(shipped.keyIdHex);
    expect(problems[0]?.found).toContain(stranger.keyIdHex);
  });

  it('negative: malformed JSON fails', () => {
    const key = throwawayMinisignKeypair();
    const problems = checkUpdaterManifest({
      manifestText: '{ this is not json',
      pubkeyBase64: key.pubkeyBase64,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.why.toLowerCase()).toContain('parse');
  });

  it('negative: a manifest with no platforms fails rather than passing vacuously', () => {
    // "No platforms" means no user can update. An empty map trivially satisfies
    // a per-platform loop, which is exactly the shape that passes while
    // inspecting nothing.
    const key = throwawayMinisignKeypair();
    const problems = checkUpdaterManifest({
      manifestText: JSON.stringify({ version: '0.2.0', platforms: {} }),
      pubkeyBase64: key.pubkeyBase64,
    });
    expect(problems.map((problem) => problem.why).join(' ')).toContain('no platforms');
  });

  it('negative: a manifest with no version fails', () => {
    const key = throwawayMinisignKeypair();
    const problems = checkUpdaterManifest({
      manifestText: JSON.stringify({
        platforms: {
          'windows-x86_64': { signature: key.signatureFor(BUNDLE), url: 'https://x/y' },
        },
      }),
      pubkeyBase64: key.pubkeyBase64,
    });
    expect(problems.map((problem) => problem.why).join(' ')).toContain('version');
  });

  it('negative: a platform entry with no signature fails', () => {
    const key = throwawayMinisignKeypair();
    const problems = checkUpdaterManifest({
      manifestText: JSON.stringify({
        version: '0.2.0',
        platforms: { 'windows-x86_64': { url: 'https://example.com/i.exe' } },
      }),
      pubkeyBase64: key.pubkeyBase64,
    });
    expect(problems.map((problem) => problem.why).join(' ')).toContain('signature');
  });

  it('negative: a signature that is not minisign at all fails', () => {
    const key = throwawayMinisignKeypair();
    const problems = checkUpdaterManifest({
      manifestText: manifestWith(Buffer.from('hello', 'utf8').toString('base64')),
      pubkeyBase64: key.pubkeyBase64,
    });
    expect(problems).toHaveLength(1);
  });

  it('negative: bundle bytes that do not match the signature fail', () => {
    const key = throwawayMinisignKeypair();
    const problems = checkUpdaterManifest({
      manifestText: manifestWith(key.signatureFor(BUNDLE)),
      pubkeyBase64: key.pubkeyBase64,
      bundleFor: () => Buffer.from('a DIFFERENT installer', 'utf8'),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.why).toContain('does not verify');
  });

  it('negative: an asset the manifest names but nobody can find fails', () => {
    // Asked for bundles and given none. Silently skipping would turn the
    // strongest check in the file into a no-op.
    const key = throwawayMinisignKeypair();
    const problems = checkUpdaterManifest({
      manifestText: manifestWith(key.signatureFor(BUNDLE)),
      pubkeyBase64: key.pubkeyBase64,
      bundleFor: () => null,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.why).toContain('could not be found');
  });

  it('negative: a trusted comment edited after signing fails', () => {
    // The second signature exists for exactly this. Without checking it, the
    // filename a signature vouches for could be swapped.
    const key = throwawayMinisignKeypair();
    const problems = checkUpdaterManifest({
      manifestText: manifestWith(key.forgedCommentFor(BUNDLE)),
      pubkeyBase64: key.pubkeyBase64,
      bundleFor: () => BUNDLE,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.why).toContain('trusted comment');
  });

  it('boundary: an empty manifest file is a failure, not an empty pass', () => {
    const key = throwawayMinisignKeypair();
    expect(checkUpdaterManifest({ manifestText: '', pubkeyBase64: key.pubkeyBase64 })).not.toEqual(
      [],
    );
  });

  it('boundary: every platform is adjudicated, not just the first', () => {
    const shipped = throwawayMinisignKeypair();
    const stranger = throwawayMinisignKeypair();
    const problems = checkUpdaterManifest({
      manifestText: JSON.stringify({
        version: '0.2.0',
        platforms: {
          'windows-x86_64': { signature: shipped.signatureFor(BUNDLE), url: 'https://x/a.exe' },
          'darwin-universal': { signature: stranger.signatureFor(BUNDLE), url: 'https://x/b.app' },
        },
      }),
      pubkeyBase64: shipped.pubkeyBase64,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.where).toContain('darwin-universal');
  });
});

describe('the public-key decoder', () => {
  it('negative: refuses a key of the wrong length', () => {
    const document = `untrusted comment: bad\n${Buffer.from('too short').toString('base64')}\n`;
    expect(() => decodeMinisignPublicKey(Buffer.from(document).toString('base64'))).toThrow();
  });

  it('negative: refuses something that is not base64 of a minisign document', () => {
    expect(() => decodeMinisignPublicKey('!!!not base64!!!')).toThrow();
  });
});
