/**
 * The MSIX manifest version is pinned to the app version (L-168).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `Package.appxmanifest` carries its own `Identity/@Version`, independent of
 * `tauri.conf.json`, `Cargo.toml` and `apps/light/package.json` — nothing ties
 * them together. The 0.2.0 bump (L-160, commit 0a110de) landed after the last
 * MSIX workflow run, and the manifest was never touched: it still read
 * `Version="0.1.0.0"` while every other source of truth said `0.2.0`.
 *
 * The only existing check on this attribute —
 * `src/lib/msix-store-build.contract.test.ts`, "uses a four-part version whose
 * fourth number is zero" — pins the SHAPE (`/^\d+\.\d+\.\d+\.0$/`), which
 * `0.1.0.0` satisfies just as well as the correct `0.2.0.0`. A shape check
 * cannot catch a stale value; only a cross-file comparison can.
 *
 * The Store compares a submission's version against the previous one and
 * rejects anything that does not strictly increase. If this drift reached a
 * real MSIX workflow run, the Store would record 0.1.0.0 for a 0.2.0 build,
 * and a later, correct 0.2.0.0 submission could be rejected as not-higher —
 * an upload failure discovered at Partner Center, not in a two-second test.
 *
 * ============================================================================
 * WHY A THROWING HELPER, NOT A SILENT ONE
 * ============================================================================
 * `expectedManifestVersion` only accepts a plain three-part version
 * (`major.minor.patch`). A pre-release suffix (`0.2.0-beta.1`) or an
 * already-four-part value (`0.2.0.0`) has no unambiguous mapping to a Store
 * manifest version, and a helper that silently truncated or reformatted one
 * would turn a real ambiguity into a wrong answer nobody reviewed. It throws
 * instead, so a version shape this repository has never used yet fails loudly
 * here rather than packaging something nobody decided.
 *
 * `manifestVersion` itself lives in `../lib/appx-manifest.ts`, shared with
 * `msix-store-build.contract.test.ts` — see that module's docblock for why a
 * reader that did not strip XML comments first was a real, mutation-proven
 * hole (L-168 review, C1).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { manifestVersion } from '../lib/appx-manifest.ts';
import { REPO_ROOT } from '../lib/repo-scan.ts';

const TAURI_CONF_PATH = 'apps/light/src-tauri/tauri.conf.json';
const CARGO_TOML_PATH = 'apps/light/src-tauri/Cargo.toml';
const PACKAGE_JSON_PATH = 'apps/light/package.json';
const MANIFEST_PATH = 'apps/light/src-tauri/msix/Package.appxmanifest';

const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

const TAURI_CONF = JSON.parse(read(TAURI_CONF_PATH)) as { version?: string };
const PACKAGE_JSON = JSON.parse(read(PACKAGE_JSON_PATH)) as { version?: string };
const CARGO_TOML = read(CARGO_TOML_PATH);
const MANIFEST = read(MANIFEST_PATH);

// ── Detectors ───────────────────────────────────────────────────────────────

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
    throw new Error(`${CARGO_TOML_PATH} has no [package] section.`);
  }
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line)) break;
    const match = /^\s*version\s*=\s*"([^"]*)"/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  throw new Error(`${CARGO_TOML_PATH} [package] section has no version.`);
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
const MAX_SEGMENT_VALUE = 65535;

/**
 * The manifest `Identity/@Version` a plain app version maps to: the same
 * three numbers, with the Store's reserved fourth segment appended as `0`.
 *
 * Throws on anything that is not exactly `major.minor.patch` with each
 * segment in `0..=65535` and no leading zero — see the docblock above for why
 * silently reformatting a pre-release or an already-four-part value would be
 * worse than refusing it. The same reasoning applies to a segment MSIX cannot
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

// ── The premise ─────────────────────────────────────────────────────────────

describe('the premise: there are real version files to adjudicate', () => {
  it('reads a real tauri.conf.json version', () => {
    expect(TAURI_CONF.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('reads a real Cargo.toml [package] version', () => {
    expect(packageVersion(CARGO_TOML)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('reads a real apps/light/package.json version', () => {
    expect(PACKAGE_JSON.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('reads a real manifest with an Identity/@Version', () => {
    expect(manifestVersion(MANIFEST)).not.toBeNull();
  });
});

// ── Three-way agreement ─────────────────────────────────────────────────────

describe('the three app-version sources agree', () => {
  it('tauri.conf.json, Cargo.toml and apps/light/package.json all carry the same version', () => {
    const versions = {
      [TAURI_CONF_PATH]: TAURI_CONF.version,
      [CARGO_TOML_PATH]: packageVersion(CARGO_TOML),
      [PACKAGE_JSON_PATH]: PACKAGE_JSON.version,
    };
    expect(
      new Set(Object.values(versions)).size,
      `The app version disagrees across files: ${JSON.stringify(versions)}. A single bump that ` +
        'misses one of these three leaves no source of truth for what "the app version" is.',
    ).toBe(1);
  });
});

// ── The guard itself ────────────────────────────────────────────────────────

describe('the manifest version is pinned to the app version', () => {
  it('anti-inert: the manifest version is present and shaped like a version before comparing it', () => {
    // Without this, a parse failure (a renamed attribute, a moved Identity
    // element) would read as `null` or `''` and — depending on how the
    // comparison below were written — could look indistinguishable from a
    // deliberate mismatch, or worse, from a pass.
    const version = manifestVersion(MANIFEST);
    expect(version, `${MANIFEST_PATH} has no readable Identity/@Version.`).not.toBeNull();
    expect(version).not.toBe('');
    expect(version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it('Identity/@Version equals the app version, Store-shaped', () => {
    const appVersion = TAURI_CONF.version;
    expect(appVersion).toBeDefined();
    const expected = expectedManifestVersion(appVersion as string);

    expect(
      manifestVersion(MANIFEST),
      `${MANIFEST_PATH} Identity/@Version is stale: it must be "${expected}" to match the app ` +
        `version "${String(appVersion)}" in ${TAURI_CONF_PATH}. This is the exact drift that let ` +
        '0.1.0.0 ship a build that was really 0.2.0 (L-168) — the Store records the manifest ' +
        'value, not the app version, and MSIX versions must strictly increase.',
    ).toBe(expected);
  });
});

// ── expectedManifestVersion: negative and boundary ──────────────────────────

describe('expectedManifestVersion', () => {
  it('happy: maps a plain three-part version to a four-part one with a trailing zero', () => {
    expect(expectedManifestVersion('0.2.0')).toBe('0.2.0.0');
  });

  it('negative: a pre-release suffix throws rather than being silently dropped', () => {
    expect(() => expectedManifestVersion('0.2.0-beta.1')).toThrow();
  });

  it('boundary: an already-four-part version throws rather than gaining a fifth segment', () => {
    expect(() => expectedManifestVersion('0.2.0.0')).toThrow();
  });

  it('boundary: multi-digit version numbers are not truncated or reordered', () => {
    expect(expectedManifestVersion('10.20.30')).toBe('10.20.30.0');
  });

  it('negative: a segment over 65535 throws — MSIX cannot represent it', () => {
    // MSIX (and the Store) store each version segment in 16 bits. A silent
    // pass-through here would produce a manifest the packaging tool or the
    // Store rejects, discovered far later than a two-second test.
    expect(() => expectedManifestVersion('70000.0.0')).toThrow();
  });

  it('negative: a leading zero throws — neither MSIX nor semver accepts one', () => {
    expect(() => expectedManifestVersion('0.02.0')).toThrow();
  });

  it('boundary: the largest representable segment value is accepted on all three positions', () => {
    expect(expectedManifestVersion('65535.65535.65535')).toBe('65535.65535.65535.0');
  });
});

// ── Proof the detectors can actually fail ───────────────────────────────────

describe('the detectors bite, and let the honest shapes through', () => {
  it('packageVersion reads [package], not a dependency inline table', () => {
    const cargoToml = [
      '[package]',
      'name = "light"',
      'version = "0.2.0"',
      '',
      '[dependencies]',
      'tauri = { version = "2", features = [] }',
    ].join('\n');
    expect(packageVersion(cargoToml)).toBe('0.2.0');
  });

  it('packageVersion throws rather than silently returning a dependency version', () => {
    const cargoToml = ['[dependencies]', 'tauri = { version = "2" }'].join('\n');
    expect(() => packageVersion(cargoToml)).toThrow();
  });

  it('packageVersion stops at the next section, rather than reading into it for a version', () => {
    // A `[package]` table with no version, immediately followed by a table
    // that HAS one. Without the section-break, the scan would walk straight
    // past `[package]` and return the dependency's version instead of
    // throwing — the exact failure `[dependencies]` alone (the fixture
    // above) cannot catch, because that fixture has no `[package]` table at
    // all and throws before the break is ever reached.
    const cargoToml = [
      '[package]',
      'name = "light"',
      '',
      '[dependencies.tauri]',
      'version = "2"',
    ].join('\n');
    expect(() => packageVersion(cargoToml)).toThrow();
  });

  it('manifestVersion finds the Identity Version attribute, and null when absent', () => {
    expect(manifestVersion('<Package><Identity Name="x" Version="1.2.3.0" /></Package>')).toBe(
      '1.2.3.0',
    );
    expect(manifestVersion('<Package><Identity Name="x" /></Package>')).toBeNull();
  });

  it('regression (L-168 C1): a commented-out example Identity above the real one is not read', () => {
    // Proved by mutation: the manifest's own header comment explains the
    // version rule with a worked example, and the obvious next edit to that
    // prose is to paste an illustrative `<Identity … Version="9.9.9.0" />`
    // above the real element — exactly the shape a reviewer adds to show a
    // "before". A reader that regex-scans the RAW file finds that one first
    // and reports it as the manifest's version, so the guard above would pass
    // on a manifest that had actually drifted.
    const withPlantedExample =
      '<Package>\n' +
      '  <!-- e.g. <Identity Name="x" Publisher="CN=Y" Version="9.9.9.0" /> -->\n' +
      '  <Identity Name="real" Version="1.2.3.0" />\n' +
      '</Package>';
    expect(manifestVersion(withPlantedExample)).toBe('1.2.3.0');
  });
});
