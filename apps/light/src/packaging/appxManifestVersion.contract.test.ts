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
 * `expectedManifestVersion` and `packageVersion` live in
 * `./appxManifestVersion.ts` (L-169), shared with the pack-time check the
 * MSIX workflow runs — see "pack-time enforcement" below.
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

import {
  checkStagedManifest,
  expectedManifestVersion,
  packageVersion,
} from './appxManifestVersion.ts';

const TAURI_CONF_PATH = 'apps/light/src-tauri/tauri.conf.json';
const CARGO_TOML_PATH = 'apps/light/src-tauri/Cargo.toml';
const PACKAGE_JSON_PATH = 'apps/light/package.json';
const MANIFEST_PATH = 'apps/light/src-tauri/msix/Package.appxmanifest';
const STORE_CONF_PATH = 'apps/light/src-tauri/tauri.microsoft-store.conf.json';
const MSIX_WORKFLOW_PATH = '.github/workflows/msix.yml';
const ROOT_PACKAGE_JSON_PATH = 'package.json';

const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

const TAURI_CONF = JSON.parse(read(TAURI_CONF_PATH)) as { version?: string };
const PACKAGE_JSON = JSON.parse(read(PACKAGE_JSON_PATH)) as { version?: string };
const CARGO_TOML = read(CARGO_TOML_PATH);
const MANIFEST = read(MANIFEST_PATH);
const STORE_CONF = read(STORE_CONF_PATH);
const MSIX_WORKFLOW = read(MSIX_WORKFLOW_PATH);
const ROOT_PACKAGE_JSON = read(ROOT_PACKAGE_JSON_PATH);

// ── Detectors ───────────────────────────────────────────────────────────────
//
// `packageVersion` and `expectedManifestVersion` moved to
// `./appxManifestVersion.ts` (L-169) so the pack-time check in `msix.yml` can
// share them — one rule, two moments. Their tests stay here.

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

// ── L-169: the Store config fragment is not a second version ─────────────────

describe('the Store config fragment carries no version (L-169)', () => {
  it('tauri.microsoft-store.conf.json has no top-level "version" key', () => {
    const parsed = JSON.parse(STORE_CONF) as Record<string, unknown>;
    expect(
      Object.hasOwn(parsed, 'version'),
      `${STORE_CONF_PATH} carries a "version" key. It is merged into ${TAURI_CONF_PATH} for ` +
        'the Store build, so it would override the app version for the Store flavour only, ' +
        'and nothing compares that to the manifest.',
    ).toBe(false);
  });
});

// ── L-169: the pack-time check ───────────────────────────────────────────────

const GOOD_MANIFEST = '<Package><Identity Name="x" Publisher="CN=y" Version="0.2.0.0" /></Package>';
const GOOD_CONF = JSON.stringify({ version: '0.2.0' });
const GOOD_STORE_CONF = JSON.stringify({ bundle: { createUpdaterArtifacts: false } });

describe('checkStagedManifest (L-169)', () => {
  it('happy: a staged manifest matching the app version, with a clean fragment, passes', () => {
    const verdict = checkStagedManifest({
      manifestXml: GOOD_MANIFEST,
      tauriConfJson: GOOD_CONF,
      storeConfJson: GOOD_STORE_CONF,
    });
    expect(verdict).toEqual({ ok: true, appVersion: '0.2.0', manifestVersion: '0.2.0.0' });
  });

  it('negative: a stale staged manifest is refused, naming both versions', () => {
    const verdict = checkStagedManifest({
      manifestXml: GOOD_MANIFEST.replace('0.2.0.0', '0.1.0.0'),
      tauriConfJson: GOOD_CONF,
      storeConfJson: GOOD_STORE_CONF,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.problems).toHaveLength(1);
      expect(verdict.problems[0]).toContain('"0.1.0.0"');
      expect(verdict.problems[0]).toContain('"0.2.0.0"');
    }
  });

  it('negative: a fragment carrying a version is refused even when the manifest matches', () => {
    const verdict = checkStagedManifest({
      manifestXml: GOOD_MANIFEST,
      tauriConfJson: GOOD_CONF,
      storeConfJson: JSON.stringify({ version: '0.3.0', bundle: {} }),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.problems.some((problem) => problem.includes('"version" key'))).toBe(true);
    }
  });

  it('negative: a manifest with no Identity/@Version is refused, never read as a match', () => {
    const verdict = checkStagedManifest({
      manifestXml: '<Package><Identity Name="x" /></Package>',
      tauriConfJson: GOOD_CONF,
      storeConfJson: GOOD_STORE_CONF,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.problems[0]).toContain('no readable Identity/@Version');
  });

  it('negative: an app version with no Store mapping (pre-release) is refused, not reformatted', () => {
    const verdict = checkStagedManifest({
      manifestXml: GOOD_MANIFEST,
      tauriConfJson: JSON.stringify({ version: '0.2.0-beta.1' }),
      storeConfJson: GOOD_STORE_CONF,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.problems[0]).toContain('pre-release');
  });

  it('boundary: unreadable JSON on either side is a refusal that names the file, not a crash', () => {
    const verdict = checkStagedManifest({
      manifestXml: GOOD_MANIFEST,
      tauriConfJson: '{ not json',
      storeConfJson: '[]',
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.problems.some((problem) => problem.includes(TAURI_CONF_PATH))).toBe(true);
      expect(verdict.problems.some((problem) => problem.includes(STORE_CONF_PATH))).toBe(true);
    }
  });

  it('every problem is reported at once, not just the first', () => {
    const verdict = checkStagedManifest({
      manifestXml: GOOD_MANIFEST.replace('0.2.0.0', '0.1.0.0'),
      tauriConfJson: GOOD_CONF,
      storeConfJson: JSON.stringify({ version: '9.9.9' }),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.problems.length).toBeGreaterThanOrEqual(2);
  });

  it('regression (L-168 C1): a commented-out Identity in the staged manifest is not the one compared', () => {
    const verdict = checkStagedManifest({
      manifestXml:
        '<Package><!-- <Identity Name="x" Version="0.2.0.0" /> -->' +
        '<Identity Name="real" Version="0.1.0.0" /></Package>',
      tauriConfJson: GOOD_CONF,
      storeConfJson: GOOD_STORE_CONF,
    });
    expect(verdict.ok).toBe(false);
  });

  it('the real repository files pass the same check the workflow runs', () => {
    const verdict = checkStagedManifest({
      manifestXml: MANIFEST,
      tauriConfJson: read(TAURI_CONF_PATH),
      storeConfJson: STORE_CONF,
    });
    expect(verdict).toMatchObject({ ok: true });
  });
});

// ── L-169: the workflow actually runs it, against the STAGED manifest, before packing ──

describe('msix.yml enforces the check at pack time (L-169)', () => {
  /** The workflow as the runner sees it: `#` commentary gone, CRLF normalised. */
  const runnable = MSIX_WORKFLOW.replaceAll('\r\n', '\n').replace(/(^|\s)#.*$/gm, '$1');

  it('the root package.json exposes the check as a script the workflow can call', () => {
    const scripts = (JSON.parse(ROOT_PACKAGE_JSON) as { scripts: Record<string, string> }).scripts;
    expect(scripts['check:msix-manifest']).toBe(
      'node apps/light/src/packaging/checkAppxManifestVersion.ts',
    );
  });

  it('runs the check against the staged manifest ($env:MANIFEST_PATH), not the source file', () => {
    expect(runnable).toMatch(/pnpm check:msix-manifest --manifest "\$env:MANIFEST_PATH"/);
  });

  it('runs it BEFORE `winapp pack` — a check after packing protects nothing', () => {
    const check = runnable.indexOf('pnpm check:msix-manifest');
    const pack = runnable.indexOf('winapp pack');
    expect(check).toBeGreaterThan(-1);
    expect(pack).toBeGreaterThan(-1);
    expect(check).toBeLessThan(pack);
  });

  it('runs it AFTER the manifest is staged — MANIFEST_PATH must already exist', () => {
    const staged = runnable.indexOf('MANIFEST_PATH=$manifestPacked');
    const check = runnable.indexOf('pnpm check:msix-manifest');
    expect(staged).toBeGreaterThan(-1);
    expect(staged).toBeLessThan(check);
  });
});
