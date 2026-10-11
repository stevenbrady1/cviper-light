/**
 * A disposable minisign keypair for tests, in the exact wire format Tauri signs
 * with. See the header of `updaterManifest.test.ts` for that format, read out
 * of real release artefacts.
 *
 * Every key made here is generated at run time, used for one test, and thrown
 * away. It is labelled THROWAWAY in its own comment fields so that a key
 * appearing in a log cannot be mistaken for the real one. The real updater
 * key's private half is never read by any test.
 *
 * Imported only by tests. Nothing the app ships reaches it.
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

import { displayKeyId } from './updaterManifest.ts';

export interface Throwaway {
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
export function throwawayMinisignKeypair(): Throwaway {
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
