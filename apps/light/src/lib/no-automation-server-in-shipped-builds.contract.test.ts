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
 *
 * ============================================================================
 * WHAT THIS DOES NOT COVER. READ THIS BEFORE TRUSTING IT.
 * ============================================================================
 * The workflow sweep reads the `.github/workflows` DIRECTORY, so a new
 * workflow file is in scope the moment it exists. It still cannot see:
 *
 *   * COMPOSITE ACTIONS — a `.github/actions/<name>/action.yml` invoked by a
 *     workflow, whose `run:` steps are not in the scanned directory. (Written
 *     with a placeholder rather than a glob on purpose: a star followed by a
 *     slash ends a block comment, and writing one here silently truncated this
 *     docblock and stopped the whole file parsing.)
 *   * SHELL SCRIPTS — a `scripts/*.sh` or `*.ps1` that a workflow calls, with
 *     the build command inside it rather than in the YAML.
 *   * `.cargo/config.toml` — which can set `build.rustflags` or feature
 *     defaults for every cargo invocation, workflow or not.
 *   * A HUMAN running `tauri build --features wdio` by hand and uploading the
 *     result somewhere. Nothing in CI can stop that; the `compile_error!` in
 *     lib.rs at least confines it to debug profiles.
 *
 * Each is a real way the feature could reach an artefact without this file
 * noticing. They are listed rather than quietly unhandled so the next person
 * knows the shape of the hole, and so adding any of those surfaces to the repo
 * comes with an obligation to extend this guard.
 */
import { readdirSync, readFileSync } from 'node:fs';
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

/**
 * Every `tauri build` that turns the test feature on WITHOUT `--no-bundle`.
 *
 * ==========================================================================
 * THIS RULE EXISTS BECAUSE THE HOLE IT FORBIDS WAS REAL.
 * ==========================================================================
 * A build with `--features wdio` produces a binary containing an
 * unauthenticated HTTP automation server. If that build is also allowed to
 * BUNDLE, it writes a `.msi` and a `-setup.exe` containing that server, under
 * the normal product name and version, one `path:` glob away from being
 * published as a public artefact anybody signed in can download.
 *
 * That is not hypothetical. smoke.yml did exactly that until a review caught
 * it: the Cargo feature gate was working — it protects release.yml — and this
 * job was shipping an instrumented installer through a different door.
 *
 * `--no-bundle` means the instrumented installer is never CREATED, so it
 * cannot be uploaded by a reordered step, an edited glob, or a future author
 * who does not know any of this. Ordering the steps would be a convention;
 * not producing the file is a property.
 */
export function bundlingInstrumentedBuilds(workflowText: string): string[] {
  const enables = new RegExp(String.raw`--features[= ][^\n]*\b${FEATURE}\b`);
  return workflowText
    .split('\n')
    .filter((line) => line.includes('tauri build'))
    .filter((line) => enables.test(line))
    .filter((line) => !line.includes('--no-bundle'))
    .map((line) => line.trim());
}

/**
 * Key material that must never be published as a CI artefact.
 *
 * A sibling session published a throwaway self-signed `devcert.pfx` from a
 * spike workflow to this public repository on the same day the smoke job here
 * was found publishing an instrumented installer. Two leaks, two causes, one
 * shape: a workflow uploading something that should never be downloadable.
 *
 * Signing material is the worst case because it is silent — a `.pfx` in an
 * artefact looks exactly like a build output in the run summary.
 */
const FORBIDDEN_UPLOAD_PATTERNS: readonly RegExp[] = [
  /\.pfx\b/i,
  /\.p12\b/i,
  /\.pem\b/i,
  /\.key\b/i,
  /\.jks\b/i,
  /\.keystore\b/i,
  /\.asc\b/i,
  /\bid_rsa\b/i,
];

/** How many `upload-artifact` steps a workflow declares. Feeds the floor. */
export function countUploadSteps(workflowText: string): number {
  return workflowText.split('\n').filter((line) => /uses:\s*actions\/upload-artifact/.test(line))
    .length;
}

/**
 * Lines inside an `actions/upload-artifact` step that name key material.
 *
 * Scoped to upload steps rather than the whole file on purpose: a workflow may
 * legitimately MENTION a `.pfx` (importing a signing certificate from a secret,
 * for instance) without publishing it, and a guard that fired on that would be
 * deleted the first week. What is forbidden is naming one in something that
 * becomes a downloadable artefact.
 */
export function uploadedSecretMaterial(workflowText: string): string[] {
  const found: string[] = [];
  let inUpload = false;

  for (const line of workflowText.split('\n')) {
    if (/^\s*-\s/.test(line)) inUpload = line.includes('actions/upload-artifact');
    else if (/^\s*uses:\s*actions\/upload-artifact/.test(line)) inUpload = true;
    if (!inUpload) continue;

    // Comments explaining the rule must not trip the rule.
    const code = line.replace(/#.*$/, '');
    if (FORBIDDEN_UPLOAD_PATTERNS.some((pattern) => pattern.test(code))) found.push(line.trim());
  }

  return found;
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

  it('catches an instrumented build that is allowed to bundle', () => {
    // The exact regression a review found: feature on, bundling not disabled,
    // so a `.msi` containing the automation server lands on disk.
    expect(
      bundlingInstrumentedBuilds(
        `        run: pnpm --filter @cviper/light tauri build --debug --features ${FEATURE} --config '{}'`,
      ),
    ).toHaveLength(1);
    expect(bundlingInstrumentedBuilds(`run: tauri build --features=${FEATURE}`)).toHaveLength(1);
  });

  it('lets the two honest build shapes through', () => {
    // Instrumented but never bundled — the thing the spec drives.
    expect(
      bundlingInstrumentedBuilds(`run: pnpm tauri build --debug --features ${FEATURE} --no-bundle`),
    ).toEqual([]);
    // Clean and bundled — the thing that is uploaded. Bundling is the POINT
    // here, so a rule that fired on it would be deleted within a week.
    expect(bundlingInstrumentedBuilds('run: pnpm tauri build --debug --config x')).toEqual([]);
    // Not a build at all.
    expect(bundlingInstrumentedBuilds(`run: cargo check --features ${FEATURE}`)).toEqual([]);
  });

  it('catches key material inside an upload step', () => {
    const leak = [
      '      - uses: actions/upload-artifact@v4',
      '        with:',
      '          name: wack-spike',
      '          path: |',
      '            build/devcert.pfx',
      '            build/app.msix',
    ].join('\n');
    expect(uploadedSecretMaterial(leak)).toEqual(['build/devcert.pfx']);
  });

  it('does not fire on a certificate that is used but never uploaded', () => {
    // The false positive that would get this rule deleted: importing a signing
    // certificate from a secret is normal and publishes nothing.
    const honest = [
      '      - name: Import the signing certificate',
      '        run: certutil -importpfx cert.pfx',
      '      - uses: actions/upload-artifact@v4',
      '        with:',
      '          name: installers',
      '          path: target/release/bundle/msi/*.msi',
    ].join('\n');
    expect(uploadedSecretMaterial(honest)).toEqual([]);
  });

  it('boundary: an empty workflow uploads nothing', () => {
    expect(uploadedSecretMaterial('')).toEqual([]);
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

const WORKFLOW_DIRECTORY = join(REPO_ROOT, '.github/workflows');

/**
 * How many workflows exist today: ci, ios, monorepo-split, release, smoke.
 *
 * A floor, not a count. The danger a floor answers is not "somebody added a
 * workflow" — that is caught by the scan itself — it is "the scan quietly
 * stopped finding any", which produces an empty offender list that every
 * assertion below reads as clean. This file has already shipped one guard that
 * failed exactly that way, reporting twelve passes while scanning nothing.
 */
const WORKFLOW_FLOOR = 5;

/**
 * How many `upload-artifact` steps exist today: smoke.yml and ios.yml.
 *
 * Same reasoning. A key-material rule that adjudicated zero upload steps —
 * because the step shape changed, or the directory read returned nothing — is
 * indistinguishable from one where every upload is safe.
 */
const UPLOAD_STEP_FLOOR = 2;

/**
 * Every workflow file, read from the DIRECTORY rather than from a list.
 *
 * The first version of this guard iterated a hardcoded array of five
 * filenames. A workflow added tomorrow would not have been in it, and the
 * guard would have passed without ever opening the file — the same
 * looks-green-because-it-never-looked failure this file already suffered once
 * in `featuresEnablingPlugin`.
 *
 * The floor assertion is the other half: an empty or failed read must fail
 * loudly rather than produce an empty offender list that every assertion below
 * would treat as clean.
 */
function workflowFiles(): string[] {
  const names = readdirSync(WORKFLOW_DIRECTORY).filter(
    (name) => name.endsWith('.yml') || name.endsWith('.yaml'),
  );

  expect(
    names.length,
    `Only ${names.length} workflow files were read from ${WORKFLOW_DIRECTORY}, expected at ` +
      `least ${WORKFLOW_FLOOR}. An empty or shrunken scan looks byte-for-byte identical to a ` +
      'clean one. If a workflow was deliberately deleted, lower the floor in the same commit ' +
      'so the decision is visible; do not delete the floor.',
  ).toBeGreaterThanOrEqual(WORKFLOW_FLOOR);
  expect(names, 'the workflow that ships installers must be in scope').toContain('release.yml');
  expect(names, 'the workflow that enables the feature must be in scope').toContain('smoke.yml');

  return names;
}

function readWorkflow(name: string): string {
  return readFileSync(join(WORKFLOW_DIRECTORY, name), 'utf8');
}

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
    const workflows = workflowFiles();

    const offenders = workflows
      .filter((name) => !ALLOWED_WORKFLOWS.includes(name))
      .filter((name) => enablesFeature(readWorkflow(name)));

    expect(
      offenders,
      'Only the smoke workflow may enable `--features wdio`. Every other workflow here ' +
        'produces something a person can install, and an automation server must not be in it.',
    ).toEqual([]);
  });

  it('never lets an instrumented build produce an installer', () => {
    // The rule a review had to find for us. `--features wdio` without
    // `--no-bundle` writes a .msi and a -setup.exe containing the automation
    // server, under the normal product name and version, one `path:` glob away
    // from being published as a downloadable artefact.
    const offenders = workflowFiles().flatMap((name) =>
      bundlingInstrumentedBuilds(readWorkflow(name)).map((line) => `${name}: ${line}`),
    );

    expect(
      offenders,
      'A `tauri build` that passes `--features wdio` must also pass `--no-bundle`, so the ' +
        'instrumented installer is never created and therefore cannot be uploaded. Build the ' +
        'shippable installer in a separate step, without the feature.',
    ).toEqual([]);
  });

  it('uploads no key material from any workflow', () => {
    // Narrower than it could be, deliberately. A full allow-list of artefact
    // names with written reasons would be the stronger mechanism, and is worth
    // doing — but it encodes policy about workflows other branches are editing
    // right now, so it belongs in its own change rather than riding along here.
    const workflows = workflowFiles();

    // THE FLOOR. Without this, a scan that found no upload steps at all would
    // produce an empty offender list and pass, looking exactly like a tree
    // where every upload is justified.
    const adjudicated = workflows.reduce(
      (total, name) => total + countUploadSteps(readWorkflow(name)),
      0,
    );
    expect(
      adjudicated,
      `This rule adjudicated ${adjudicated} upload steps, expected at least ` +
        `${UPLOAD_STEP_FLOOR}. Finding none is not the same as finding nothing wrong.`,
    ).toBeGreaterThanOrEqual(UPLOAD_STEP_FLOOR);

    const offenders = workflows.flatMap((name) =>
      uploadedSecretMaterial(readWorkflow(name)).map((line) => `${name}: ${line}`),
    );

    expect(
      offenders,
      'A CI artefact is downloadable by anyone signed in, and this repository is public. ' +
        'Certificates and keys must never be uploaded — generate them in the job that needs ' +
        'them and let them die with the runner.',
    ).toEqual([]);
  });

  it('never enables the feature from release.yml, the one that ships', () => {
    // Named separately from the sweep above because this is the file that
    // actually publishes installers, and it deserves its own failing line.
    const release = readFileSync(join(REPO_ROOT, '.github/workflows/release.yml'), 'utf8');
    expect(enablesFeature(release)).toBe(false);
  });
});
