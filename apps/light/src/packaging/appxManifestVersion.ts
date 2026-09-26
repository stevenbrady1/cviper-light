/**
 * The MSIX manifest version, derived from the app version and checked against
 * a manifest — at commit time (the contract test) AND at pack time (L-169).
 *
 * ============================================================================
 * WHY THIS IS A MODULE AND NOT PART OF THE TEST (L-169)
 * ============================================================================
 * L-168 pinned `Package.appxmanifest`'s `Identity/@Version` to `tauri.conf.json`
 * with a contract test. That protects a COMMIT: a stale manifest on `main` is
 * a red `pnpm test`. It does not protect a PACKAGING RUN. `msix.yml` rewrites
 * the manifest's `Executable=` attribute into a staged copy and hands that copy
 * to `winapp pack` without ever re-reading its version — so a rebase that drops
 * the guard's own fix commit, a hotfix branch built from an older manifest, or
 * a `workflow_dispatch` from a stale ref would pack and upload a
 * version-mismatched `.msix` with no test standing between it and Partner
 * Center.
 *
 * So the derivation and the comparison live HERE, imported by both the test
 * and `checkAppxManifestVersion.ts`, which the workflow runs against the
 * STAGED manifest immediately before `winapp pack`. One function, two moments;
 * a second copy of the rule would be the copy nobody reads.
 *
 * ============================================================================
 * THE STORE CONFIG FRAGMENT MUST NOT CARRY A VERSION
 * ============================================================================
 * `tauri.microsoft-store.conf.json` is MERGED into `tauri.conf.json` for the
 * Store build. A `version` key in it would override the app's real version for
 * the Store flavour only — the binary would report one version and the
 * manifest another, and nothing else in the repository compares those two.
 * `checkStagedManifest` refuses that shape too, so the fragment stays what it
 * is meant to be: a bundle switch, never a second source of truth.
 */
import { manifestVersion } from '../lib/appx-manifest.ts';

/** The three files the pack-time check reads, named so failures can cite them. */
export const TAURI_CONF_PATH = 'apps/light/src-tauri/tauri.conf.json';
export const STORE_CONF_PATH = 'apps/light/src-tauri/tauri.microsoft-store.conf.json';
export const MANIFEST_PATH = 'apps/light/src-tauri/msix/Package.appxmanifest';

/**
 * The `version` in a Cargo manifest's `[package]` table — never a
 * dependency's `version = "…"` line, which this repository writes as
 * `crate = { version = "…", … }` and never as a bare `version =` key.
 *
 * Stops at the next `[section]`, the same defence
 * `msix-store-build.contract.test.ts`'s `featureTable` uses: without it, a
 * `[dependencies]` table using the long `[dependencies.x]` / `version = "…"`
 * form would be read as the package version.
 */
export function packageVersion(cargoToml: string): string {
  const lines = cargoToml.split('\n');
  const start = lines.findIndex((line) => line.trim() === '[package]');
  if (start === -1) {
    throw new Error('Cargo.toml has no [package] section.');
  }
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line)) break;
    const match = /^\s*version\s*=\s*"([^"]*)"/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  throw new Error('Cargo.toml [package] section has no version.');
}

/**
 * One version segment: either exactly `0`, or a non-zero digit followed by
 * more digits. A leading zero (`02`) matches neither branch, so it is
 * rejected the same way a pre-release suffix is — semver forbids it, and it
 * is not a shape either `tauri.conf.json` or the Store has ever been asked
 * to accept.
 */
const VERSION_SEGMENT = String.raw`(0|[1-9]\d*)`;
const THREE_PART_VERSION = new RegExp(
  `^${VERSION_SEGMENT}\\.${VERSION_SEGMENT}\\.${VERSION_SEGMENT}$`,
);

/** MSIX stores each version segment in 16 bits. Store submission fails above this. */
export const MAX_SEGMENT_VALUE = 65535;

/**
 * The manifest `Identity/@Version` a plain app version maps to: the same
 * three numbers, with the Store's reserved fourth segment appended as `0`.
 *
 * Throws on anything that is not exactly `major.minor.patch` with each
 * segment in `0..=65535` and no leading zero. A pre-release suffix
 * (`0.2.0-beta.1`) or an already-four-part value (`0.2.0.0`) has no
 * unambiguous mapping to a Store manifest version, and a helper that silently
 * truncated or reformatted one would turn a real ambiguity into a wrong answer
 * nobody reviewed. The same reasoning applies to a segment MSIX cannot
 * represent: truncating or wrapping it would produce a manifest that looks
 * plausible and is rejected at Partner Center.
 */
export function expectedManifestVersion(appVersion: string): string {
  const match = THREE_PART_VERSION.exec(appVersion);
  if (match === null) {
    throw new Error(
      `"${appVersion}" is not a plain major.minor.patch version with no leading zeros. A ` +
        'pre-release suffix or a fourth segment has no unambiguous Store manifest version to ' +
        'map to.',
    );
  }
  const segments = [match[1], match[2], match[3]] as const;
  const tooLarge = segments.find((segment) => Number(segment) > MAX_SEGMENT_VALUE);
  if (tooLarge !== undefined) {
    throw new Error(
      `"${appVersion}" has a version segment ("${tooLarge}") greater than ${MAX_SEGMENT_VALUE}, ` +
        'which MSIX stores in 16 bits and the Microsoft Store rejects at upload.',
    );
  }
  return `${segments[0]}.${segments[1]}.${segments[2]}.0`;
}

/**
 * Keys of a Tauri config fragment that would override the app version when
 * the fragment is merged. Top-level `version` is the one Tauri reads; it is
 * listed as data so the check names what it refuses.
 */
export const FORBIDDEN_STORE_CONF_KEYS: readonly string[] = ['version'];

/** What the pack-time check was given. Strings, not paths: the reader is the caller's. */
export interface StagedManifestInput {
  /** The manifest ABOUT TO BE PACKED — the staged copy, never the source file. */
  readonly manifestXml: string;
  /** The text of `tauri.conf.json`. */
  readonly tauriConfJson: string;
  /** The text of `tauri.microsoft-store.conf.json`. */
  readonly storeConfJson: string;
}

export type StagedManifestVerdict =
  | { readonly ok: true; readonly appVersion: string; readonly manifestVersion: string }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Every reason the staged manifest must not be packed, or none.
 *
 * Collects ALL problems rather than stopping at the first, so one red run
 * names everything wrong with it. Nothing here reads a file or exits: the
 * CLI does that, and the test drives this with strings.
 */
export function checkStagedManifest(input: StagedManifestInput): StagedManifestVerdict {
  const problems: string[] = [];

  let appVersion: string | null = null;
  try {
    const parsed: unknown = JSON.parse(input.tauriConfJson);
    const version = (parsed as { version?: unknown }).version;
    if (typeof version === 'string' && version !== '') appVersion = version;
    else
      problems.push(
        `${TAURI_CONF_PATH} has no string "version" to derive the manifest version from.`,
      );
  } catch (cause) {
    problems.push(`${TAURI_CONF_PATH} is not valid JSON: ${describe(cause)}`);
  }

  try {
    const parsed: unknown = JSON.parse(input.storeConfJson);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      problems.push(`${STORE_CONF_PATH} is not a JSON object.`);
    } else {
      for (const key of FORBIDDEN_STORE_CONF_KEYS) {
        if (Object.hasOwn(parsed, key)) {
          problems.push(
            `${STORE_CONF_PATH} carries a "${key}" key. The fragment is merged into ` +
              `${TAURI_CONF_PATH} for the Store build, so this would override the app version ` +
              'for the Store flavour only and nothing would compare it to the manifest. Remove it; ' +
              `${TAURI_CONF_PATH} is the only version.`,
          );
        }
      }
    }
  } catch (cause) {
    problems.push(`${STORE_CONF_PATH} is not valid JSON: ${describe(cause)}`);
  }

  let expected: string | null = null;
  if (appVersion !== null) {
    try {
      expected = expectedManifestVersion(appVersion);
    } catch (cause) {
      problems.push(describe(cause));
    }
  }

  const found = manifestVersion(input.manifestXml);
  if (found === null || found === '') {
    problems.push('The staged manifest has no readable Identity/@Version.');
  } else if (expected !== null && found !== expected) {
    problems.push(
      `The staged manifest's Identity/@Version is "${found}" but the app version ` +
        `"${String(appVersion)}" in ${TAURI_CONF_PATH} requires "${expected}". The Store records ` +
        'the manifest value and demands a strictly increasing sequence, so packing this would ' +
        'upload the wrong version (L-168 / L-169).',
    );
  }

  if (problems.length > 0 || appVersion === null || found === null) {
    return { ok: false, problems };
  }
  return { ok: true, appVersion, manifestVersion: found };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
