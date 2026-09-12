/**
 * Verify `latest.json` before it is published.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `latest.json` is the file every installed copy reads to decide whether there
 * is a newer version, and it carries the minisign signature each download is
 * checked against. Three things can be wrong with it, and all three fail
 * QUIETLY on the user's machine rather than loudly in CI:
 *
 *   * It is ABSENT — the release publishes installers no existing copy can
 *     discover, and the app reports "there are no published releases to compare
 *     against yet".
 *   * It is UNPARSEABLE — the plugin fails to deserialise it and the user is
 *     told the check did not finish.
 *   * Its signatures were made by a key the shipped binaries DO NOT CARRY. This
 *     is the worst one. Every user is offered the update and every user's
 *     install refuses it at the last moment, with no way to tell the difference
 *     between that and a corrupt download. It cannot be repaired by shipping
 *     another release, because the binaries that would have to accept a new key
 *     are already on other people's machines.
 *
 * A release that fails in CI costs ten minutes. A release that fails this way
 * costs the update channel.
 *
 * ============================================================================
 * THE WIRE FORMAT, READ OUT OF THE REAL ARTEFACTS
 * ============================================================================
 * Confirmed against the `light-v0.1.0` artefacts and `minisign-verify` 0.2.5,
 * which is what `tauri-plugin-updater` verifies with:
 *
 *   * A `.sig` file is base64 of a four-line minisign document, and the
 *     `signature` field in `latest.json` is that base64 VERBATIM.
 *   * Line 2 decodes to 74 bytes: 2-byte algorithm, 8-byte key id, 64-byte
 *     Ed25519 signature.
 *   * `ED` (0x45 0x44) is PREHASHED — the signature is over BLAKE2b-512 of the
 *     file. `Ed` (0x45 0x64) is the legacy mode, over the file itself. Tauri
 *     emits `ED` and accepts both (`verify(..., allow_legacy = true)`), so both
 *     are supported here.
 *   * Line 4 is a second Ed25519 signature over `signature || trusted_comment`,
 *     which is what stops the comment — and the filename in it — being edited
 *     after the fact.
 *   * A key id is STORED little-endian and DISPLAYED reversed. The live key is
 *     `8F154F6BBCFC2970` on the wire and `7029FCBC6B4F158F` in every document
 *     that names it.
 *
 * ============================================================================
 * WHAT THIS DOES NOT DO
 * ============================================================================
 * Without the bundle bytes it verifies that every signature was made BY THE
 * RIGHT KEY, not that it matches a particular download — the signed bytes are
 * not in the manifest and cannot be. Pass `bundleFor` to get the full check;
 * the release job does, because it downloads the assets alongside the manifest.
 *
 * Stated rather than hidden: a key-id check alone would accept a signature the
 * right key made over the WRONG FILE. That is why `bundleFor` exists and why
 * the release job supplies it.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';

/** The DER preamble for a raw 32-byte Ed25519 public key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** `trusted comment: ` — minisign's own fixed prefix on line three. */
const TRUSTED_COMMENT_PREFIX = 'trusted comment: ';

export interface ManifestProblem {
  /** Where it is, in words a person can act on. */
  readonly where: string;
  /** What was actually there. */
  readonly found: string;
  /** Why it is wrong, and what it would cost. */
  readonly why: string;
}

export interface MinisignPublicKey {
  readonly algorithm: string;
  readonly keyId: Uint8Array;
  /** As minisign prints it, and as every document in this repository names it. */
  readonly keyIdHex: string;
  readonly key: Uint8Array;
}

export interface MinisignSignature {
  readonly algorithm: string;
  /** `ED`: the signature is over BLAKE2b-512 of the file, not the file. */
  readonly prehashed: boolean;
  readonly keyId: Uint8Array;
  readonly keyIdHex: string;
  readonly signature: Uint8Array;
  readonly trustedComment: string;
  readonly globalSignature: Uint8Array;
}

export interface ManifestCheckInput {
  /** The manifest's text, or `null` when the file is not there at all. */
  readonly manifestText: string | null;
  /** `plugins.updater.pubkey` — the base64 minisign public key. */
  readonly pubkeyBase64: string;
  /**
   * The bytes of a named asset, or `null` if it cannot be found.
   *
   * Supplying this turns a key-id check into a real signature verification.
   * Returning `null` is a FAILURE, never a skip: asked for the bundles and
   * given none, the strongest check here would otherwise become a no-op.
   */
  readonly bundleFor?: ((fileName: string) => Uint8Array | null) | undefined;
}

/** A key id as minisign prints it: the stored bytes, reversed, upper-case hex. */
export function displayKeyId(keyId: Uint8Array): string {
  return Buffer.from(keyId).reverse().toString('hex').toUpperCase();
}

/** The lines of a base64-wrapped minisign document, blanks dropped. */
function documentLines(base64: string): string[] {
  const text = Buffer.from(base64, 'base64').toString('utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function decodeMinisignPublicKey(base64: string): MinisignPublicKey {
  const lines = documentLines(base64);
  // The payload is the first line that is not the comment. Taking index 1
  // blindly would break on a document with no comment at all.
  const payload = lines.find((line) => !line.toLowerCase().startsWith('untrusted comment:'));
  if (payload === undefined) {
    throw new Error('not a minisign public key: no payload line was found.');
  }

  const binary = Buffer.from(payload, 'base64');
  if (binary.length !== 42) {
    throw new Error(
      `not a minisign public key: its payload is ${binary.length} bytes, and a public key is 42 ` +
        '(2-byte algorithm, 8-byte key id, 32-byte key).',
    );
  }

  const keyId = binary.subarray(2, 10);
  return {
    algorithm: binary.subarray(0, 2).toString('latin1'),
    keyId,
    keyIdHex: displayKeyId(keyId),
    key: binary.subarray(10),
  };
}

export function decodeMinisignSignature(base64: string): MinisignSignature {
  const lines = documentLines(base64);
  if (lines.length < 4) {
    throw new Error(
      `not a minisign signature: it has ${lines.length} lines and a signature has four ` +
        '(comment, signature, trusted comment, global signature).',
    );
  }

  const binary = Buffer.from(lines[1] ?? '', 'base64');
  if (binary.length !== 74) {
    throw new Error(
      `not a minisign signature: its payload is ${binary.length} bytes, and a signature is 74.`,
    );
  }

  const algorithm = binary.subarray(0, 2).toString('latin1');
  if (algorithm !== 'ED' && algorithm !== 'Ed') {
    throw new Error(
      `unsupported signature algorithm ${JSON.stringify(algorithm)}: minisign uses "ED" ` +
        '(prehashed) or "Ed" (legacy).',
    );
  }

  const commentLine = lines[2] ?? '';
  if (!commentLine.startsWith(TRUSTED_COMMENT_PREFIX)) {
    throw new Error('not a minisign signature: the third line is not a trusted comment.');
  }

  const globalSignature = Buffer.from(lines[3] ?? '', 'base64');
  if (globalSignature.length !== 64) {
    throw new Error(
      `not a minisign signature: its global signature is ${globalSignature.length} bytes, not 64.`,
    );
  }

  const keyId = binary.subarray(2, 10);
  return {
    algorithm,
    prehashed: algorithm === 'ED',
    keyId,
    keyIdHex: displayKeyId(keyId),
    signature: binary.subarray(10),
    trustedComment: commentLine.slice(TRUSTED_COMMENT_PREFIX.length),
    globalSignature,
  };
}

function publicKeyObject(publicKey: MinisignPublicKey) {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey.key)]),
    format: 'der',
    type: 'spki',
  });
}

/** Does this signature cover exactly these bytes? */
export function verifyPayload(
  publicKey: MinisignPublicKey,
  signature: MinisignSignature,
  data: Uint8Array,
): boolean {
  const message = signature.prehashed
    ? createHash('blake2b512').update(Buffer.from(data)).digest()
    : Buffer.from(data);
  return verify(null, message, publicKeyObject(publicKey), Buffer.from(signature.signature));
}

/** Has the trusted comment been edited since it was signed? */
export function verifyTrustedComment(
  publicKey: MinisignPublicKey,
  signature: MinisignSignature,
): boolean {
  const signed = Buffer.concat([
    Buffer.from(signature.signature),
    Buffer.from(signature.trustedComment, 'utf8'),
  ]);
  return verify(null, signed, publicKeyObject(publicKey), Buffer.from(signature.globalSignature));
}

/** The file name an asset URL ends in. */
function assetNameOf(url: string): string {
  return url.split('?')[0]?.split('/').pop() ?? '';
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * Every way this manifest would let a release down.
 *
 * Returns an empty array when there is nothing wrong. One problem per fault,
 * each naming the platform it belongs to, because a release with two broken
 * targets should report both rather than the first.
 */
export function checkUpdaterManifest(input: ManifestCheckInput): ManifestProblem[] {
  const { manifestText, pubkeyBase64, bundleFor } = input;

  if (manifestText === null) {
    return [
      {
        where: 'latest.json',
        found: 'nothing',
        why:
          'the updater manifest is missing. Without it the release contains installers no ' +
          'existing copy of the app can ever discover, and the update check reports "there are ' +
          'no published releases to compare against yet".',
      },
    ];
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch (thrown) {
    return [
      {
        where: 'latest.json',
        found: manifestText.slice(0, 60),
        why: `the updater manifest could not be parsed as JSON: ${messageOf(thrown)}`,
      },
    ];
  }

  let publicKey: MinisignPublicKey;
  try {
    publicKey = decodeMinisignPublicKey(pubkeyBase64);
  } catch (thrown) {
    return [
      {
        where: 'tauri.conf.json — plugins.updater.pubkey',
        found: pubkeyBase64.slice(0, 32),
        why: `the configured updater public key could not be decoded: ${messageOf(thrown)}`,
      },
    ];
  }

  const problems: ManifestProblem[] = [];
  const record = manifest as { version?: unknown; platforms?: unknown };

  if (typeof record.version !== 'string' || record.version.trim() === '') {
    problems.push({
      where: 'latest.json — version',
      found: String(record.version),
      why:
        'the manifest carries no version, so the plugin cannot compare it against the running ' +
        'build and every check fails to deserialise the response.',
    });
  }

  const platforms =
    typeof record.platforms === 'object' && record.platforms !== null
      ? (record.platforms as Record<string, unknown>)
      : {};
  const targets = Object.keys(platforms).sort();

  if (targets.length === 0) {
    problems.push({
      where: 'latest.json — platforms',
      found: 'an empty map',
      why:
        'the manifest lists no platforms, so there is nothing any user could install. An empty ' +
        'map also satisfies a per-platform loop without inspecting anything, which is why it is ' +
        'called out here rather than passing quietly.',
    });
    return problems;
  }

  for (const target of targets) {
    const where = `latest.json — platforms.${target}`;
    const entry = platforms[target] as { signature?: unknown; url?: unknown } | undefined;

    if (typeof entry?.signature !== 'string' || entry.signature.trim() === '') {
      problems.push({
        where,
        found: String(entry?.signature),
        why: 'this platform has no signature, so a download for it could never be verified.',
      });
      continue;
    }

    if (typeof entry.url !== 'string' || entry.url.trim() === '') {
      problems.push({
        where,
        found: String(entry.url),
        why: 'this platform has no download url, so there is nothing for the app to fetch.',
      });
      continue;
    }

    let signature: MinisignSignature;
    try {
      signature = decodeMinisignSignature(entry.signature);
    } catch (thrown) {
      problems.push({ where, found: entry.signature.slice(0, 32), why: messageOf(thrown) });
      continue;
    }

    if (signature.keyIdHex !== publicKey.keyIdHex) {
      problems.push({
        where,
        found: `a signature from key ${signature.keyIdHex}`,
        why:
          `this signature was made by a DIFFERENT key from the one shipped binaries check ` +
          `against (${publicKey.keyIdHex}). Every installed copy would be offered this update ` +
          'and every one would refuse it at the last moment. Shipping another release cannot ' +
          'repair that, because the binaries that would have to accept a new key are already on ' +
          "other people's machines.",
      });
      continue;
    }

    if (bundleFor === undefined) continue;

    const assetName = assetNameOf(entry.url);
    const bytes = bundleFor(assetName);
    if (bytes === null) {
      problems.push({
        where,
        found: assetName,
        why:
          `the asset this platform points at could not be found, so its signature could not be ` +
          'checked against anything. This is reported rather than skipped: a verification that ' +
          'quietly inspects nothing is worse than no verification at all.',
      });
      continue;
    }

    if (!verifyPayload(publicKey, signature, bytes)) {
      problems.push({
        where,
        found: assetName,
        why:
          'the signature does not verify against the bytes of the asset it names. The file has ' +
          'changed since it was signed, or the manifest names the wrong file.',
      });
      continue;
    }

    if (!verifyTrustedComment(publicKey, signature)) {
      problems.push({
        where,
        found: signature.trustedComment,
        why:
          'the trusted comment does not match the signature that covers it, so the comment — ' +
          'including the filename it names — was edited after signing.',
      });
    }
  }

  return problems;
}
