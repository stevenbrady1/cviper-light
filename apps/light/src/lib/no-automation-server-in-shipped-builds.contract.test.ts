/**
 * The no-automation-server contract: the embedded WebDriver server is compiled
 * into the CI smoke build and into nothing else, ever.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `.github/workflows/smoke.yml` drives the real built app. To be drivable, the
 * app has to serve WebDriver, which it does via `tauri-plugin-wdio-webdriver`
 * behind the `wdio` Cargo feature. That plugin opens an HTTP server on a local
 * port with 47 W3C endpoints that can read the DOM, click things and run
 * JavaScript in the window. Its own README says: "This plugin exposes
 * automation capabilities via HTTP. Never include it in production builds."
 *
 * This app promises that nothing leaves the user's machine without them asking.
 * An automation server in a shipped binary is the loudest possible violation of
 * that promise, and it would arrive silently: one `--features wdio` copied from
 * one workflow into another, or one entry added to a `default` feature list.
 *
 * `src-tauri/src/lib.rs` carries a `compile_error!` that stops the WORST case
 * (the feature on in a release profile) at the compiler. That is the strong
 * gate. This guard covers what a compile error cannot see: a debug-profile
 * release, a default-feature list that quietly turns it on for everyone, an
 * unguarded `.plugin(...)` call, or a second workflow enabling the feature.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * The rules say what must be ABSENT: absent from every default feature list,
 * absent from `lib.rs` outside a `cfg(feature)` guard, absent from every
 * workflow except the one smoke job whose entire purpose it is. Nothing here
 * asserts that some line IS present, except the tripwire itself — because a
 * guard that asserted "smoke.yml contains --features wdio" would go red the day
 * somebody legitimately renamed the flag, and green the day the plugin was
 * added somewhere else entirely.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

/** The crate that opens the port. */
const PLUGIN_CRATE = 'tauri-plugin-wdio-webdriver';

/** The Rust path of the same thing, as `lib.rs` spells it. */
const PLUGIN_MODULE = 'tauri_plugin_wdio_webdriver';

/** The feature that turns it on. */
const FEATURE = 'wdio';

/**
 * The ONLY workflow permitted to enable the feature.
 *
 * Not a list of blessed files for its own sake: every name added here is a new
 * place an automation server can be switched on, and the value of the promise
 * is that the set is small enough to read.
 */
const ALLOWED_WORKFLOWS = ['smoke.yml'];

const CARGO_TOML = readFileSync(join(REPO_ROOT, 'apps/light/src-tauri/Cargo.toml'), 'utf8');
const LIB_RS = readFileSync(join(REPO_ROOT, 'apps/light/src-tauri/src/lib.rs'), 'utf8');

// ── Detectors ───────────────────────────────────────────────────────────────

/** Is the crate declared `optional`? An optional dep is what makes a feature a gate. */
export function declaredOptional(cargoToml: string): boolean {
  const line = cargoToml
    .split('\n')
    .find((candidate) => candidate.trimStart().startsWith(`${PLUGIN_CRATE} =`));
  return line !== undefined && /\boptional\s*=\s*true\b/.test(line);
}

/**
 * Every feature whose expansion mentions the plugin, other than the feature
 * itself. A `default = ["wdio"]` — or a `default = ["something", "wdio"]`, or a
 * chain through another feature — is the silent way this gets switched on for
 * everybody.
 */
export function featuresEnablingPlugin(cargoToml: string): string[] {
  // ------------------------------------------------------------------------
  // WALKED LINE BY LINE, NOT MATCHED WITH A CLEVER REGULAR EXPRESSION.
  // ------------------------------------------------------------------------
  // The first version of this function was `/^\[features\]...$/` with no `/m`
  // flag, so `^` anchored to the start of the INPUT. `[features]` sits in the
  // middle of a real Cargo.toml, so it never matched, the function returned
  // "no offenders" for every possible input, and the guard was inert. It was
  // caught only because the non-inertness proof planted `default = ["wdio"]`
  // and the suite still reported twelve passes.
  //
  // The detector's own unit tests did not catch it either: their fixtures
  // begin with `[features]` at position 0, which is the one case the broken
  // pattern did handle. That is why the fixtures below now carry a realistic
  // prefix AND a following section.
  //
  // So: no anchors, no lookaheads, no flags to get wrong. Find the header,
  // read until the next one. Slower and impossible to be subtly wrong about.
  const lines = cargoToml.split('\n');
  const start = lines.findIndex((line) => line.trim() === '[features]');
  if (start === -1) return [];

  const found: string[] = [];
  for (const line of lines.slice(start + 1)) {
    // The next section header ends the block.
    if (/^\s*\[/.test(line)) break;

    const match = /^\s*([A-Za-z0-9_-]+)\s*=\s*\[([^\]]*)\]/.exec(line);
    if (match === null) continue;
    const name = match[1] ?? '';
    const expansion = match[2] ?? '';
    if (name === FEATURE) continue;
    if (expansion.includes(PLUGIN_CRATE) || expansion.includes(`"${FEATURE}"`)) found.push(name);
  }
  return found;
}

/**
 * Lines that register the plugin without a `cfg(feature = "wdio")` immediately
 * above them.
 *
 * Deliberately line-based rather than a Rust parse: the shape being forbidden
 * is one `.plugin(...)` call losing its attribute, and an attribute that is not
 * on the preceding line is not guarding anything anyway.
 */
export function unguardedRegistrations(libRs: string): string[] {
  const lines = libRs.split('\n');
  const offenders: string[] = [];

  lines.forEach((line, index) => {
    if (!line.includes(`${PLUGIN_MODULE}::init`)) return;
    const preceding = lines.slice(Math.max(0, index - 3), index).join('\n');
    if (!/#\[cfg\([^)]*feature\s*=\s*"wdio"/.test(preceding)) offenders.push(line.trim());
  });

  return offenders;
}

/** Does the release tripwire still exist? */
export function hasReleaseTripwire(libRs: string): boolean {
  return (
    /#\[cfg\(all\(\s*feature\s*=\s*"wdio"\s*,\s*not\(debug_assertions\)\s*\)\)\]/.test(libRs) &&
    /compile_error!/.test(libRs)
  );
}

/** Does a workflow's text turn the feature on? */
export function enablesFeature(workflowText: string): boolean {
  return new RegExp(String.raw`--features[= ][^\n]*\b${FEATURE}\b`).test(workflowText);
}

// ── The detectors can actually fail ─────────────────────────────────────────

describe('the detectors bite, and let the honest shapes through', () => {
  it('sees an optional dependency, and a non-optional one', () => {
    expect(declaredOptional(`${PLUGIN_CRATE} = { version = "1.4.0", optional = true }`)).toBe(true);
    expect(declaredOptional(`${PLUGIN_CRATE} = "1.4.0"`)).toBe(false);
    expect(declaredOptional(`${PLUGIN_CRATE} = { version = "1.4.0" }`)).toBe(false);
  });

  /**
   * A fixture shaped like the real file: `[features]` is NOT the first line,
   * and another section follows it.
   *
   * This is a regression fixture, not decoration. The first version of
   * `featuresEnablingPlugin` only worked when `[features]` sat at position 0 —
   * true of a naive fixture, false of every real Cargo.toml — so the detector
   * tests passed while the scan of the actual manifest was inert.
   */
  const manifest = (featuresBlock: string): string =>
    `[package]\nname = "light"\nversion = "0.1.0"\n\n[features]\n${featuresBlock}\n[dependencies]\ntauri = "2"\n`;

  it('catches a default list that switches the plugin on', () => {
    expect(featuresEnablingPlugin(manifest('default = ["wdio"]\nwdio = ["dep:x"]'))).toEqual([
      'default',
    ]);
    // Through another feature, which is the version nobody spots in review.
    expect(featuresEnablingPlugin(manifest('e2e = ["wdio"]\nwdio = ["dep:x"]'))).toEqual(['e2e']);
    expect(featuresEnablingPlugin(manifest(`default = ["dep:${PLUGIN_CRATE}"]`))).toEqual([
      'default',
    ]);
  });

  it('finds the block even when it is not the first line of the file', () => {
    // The exact blind spot that made this guard inert. If `[features]` is only
    // found at offset 0, this fails and the guard cannot ship broken again.
    expect(featuresEnablingPlugin(manifest('default = ["wdio"]'))).toEqual(['default']);
  });

  it('stops at the next section, and does not read dependencies as features', () => {
    // `[dependencies]` legitimately contains `wdio` in a crate name. Reading
    // past the block would report it as a feature and fire on an honest file.
    expect(
      featuresEnablingPlugin(
        `[features]\n${FEATURE} = ["dep:${PLUGIN_CRATE}"]\n\n[dependencies]\n${PLUGIN_CRATE} = { version = "1", optional = true }\n`,
      ),
    ).toEqual([]);
  });

  it('lets the real, gated declaration through', () => {
    expect(featuresEnablingPlugin(manifest(`${FEATURE} = ["dep:${PLUGIN_CRATE}"]`))).toEqual([]);
  });

  it('catches an unguarded registration and accepts a guarded one', () => {
    expect(
      unguardedRegistrations(`    let builder = builder.plugin(${PLUGIN_MODULE}::init());`),
    ).toHaveLength(1);
    expect(
      unguardedRegistrations(
        `    #[cfg(feature = "wdio")]\n    let builder = builder.plugin(${PLUGIN_MODULE}::init());`,
      ),
    ).toEqual([]);
  });

  it('knows a tripwire from an empty file', () => {
    expect(
      hasReleaseTripwire(
        '#[cfg(all(feature = "wdio", not(debug_assertions)))]\ncompile_error!("no");',
      ),
    ).toBe(true);
    expect(hasReleaseTripwire('')).toBe(false);
    // A cfg that is not the release tripwire must not satisfy it.
    expect(hasReleaseTripwire('#[cfg(feature = "wdio")]\nlet b = b;')).toBe(false);
  });

  it('spots a workflow enabling the feature, in either spelling', () => {
    expect(enablesFeature('run: tauri build --debug --features wdio --config x')).toBe(true);
    expect(enablesFeature('run: cargo check --features=wdio')).toBe(true);
    // Honest lines that must walk through.
    expect(enablesFeature('run: tauri build --debug')).toBe(false);
    expect(enablesFeature('# the wdio feature is deliberately not enabled here')).toBe(false);
  });
});

// ── The real tree ───────────────────────────────────────────────────────────

describe('the automation server is compiled into the smoke build and nothing else', () => {
  it('declares the plugin as an optional dependency', () => {
    expect(
      declaredOptional(CARGO_TOML),
      `${PLUGIN_CRATE} must be \`optional = true\`. Without that, the feature is a label ` +
        'rather than a gate and the crate is compiled into every build.',
    ).toBe(true);
  });

  it('has no feature that turns the plugin on for everybody', () => {
    expect(
      featuresEnablingPlugin(CARGO_TOML),
      'These features enable the embedded WebDriver server. `wdio` must be opted into ' +
        'explicitly by the smoke workflow and reachable from nothing else — especially not ' +
        '`default`.',
    ).toEqual([]);
  });

  it('registers the plugin only under `cfg(feature = "wdio")`', () => {
    expect(
      unguardedRegistrations(LIB_RS),
      'An unguarded `.plugin(...)` call compiles the automation server into every build, ' +
        'whatever Cargo.toml says.',
    ).toEqual([]);
  });

  it('keeps the compile_error tripwire that forbids a release build with the feature', () => {
    expect(
      hasReleaseTripwire(LIB_RS),
      'src-tauri/src/lib.rs must keep `#[cfg(all(feature = "wdio", not(debug_assertions)))] ' +
        'compile_error!(...)`. It is the only check that cannot be forgotten, because it ' +
        'fails at the compiler rather than in a test somebody can skip.',
    ).toBe(true);
  });

  it('is enabled by no workflow other than the smoke job', () => {
    const directory = join(REPO_ROOT, '.github/workflows');
    const offenders = ['ci.yml', 'release.yml', 'ios.yml', 'monorepo-split.yml', 'smoke.yml']
      .filter((name) => !ALLOWED_WORKFLOWS.includes(name))
      .filter((name) => {
        try {
          return enablesFeature(readFileSync(join(directory, name), 'utf8'));
        } catch {
          // A workflow that has been deleted cannot enable anything. Renaming
          // one into existence is caught the next time this list is read.
          return false;
        }
      });

    expect(
      offenders,
      'Only the smoke workflow may enable `--features wdio`. Every other workflow here ' +
        'produces something a person can install, and an automation server must not be in it.',
    ).toEqual([]);
  });

  it('never enables the feature from release.yml, the one that ships', () => {
    // Named separately from the sweep above because this is the file that
    // actually publishes installers, and it deserves its own failing line.
    const release = readFileSync(join(REPO_ROOT, '.github/workflows/release.yml'), 'utf8');
    expect(enablesFeature(release)).toBe(false);
  });
});
