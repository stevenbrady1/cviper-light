/**
 * The Microsoft Store build contract (L-93): a Store flavour cannot contain the
 * updater, and cannot be built without saying so to the screen.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * An installed MSIX's files are READ-ONLY. `tauri-plugin-updater` works by
 * replacing the installed binary, so in a Store build it cannot succeed — it
 * can only fail, on a machine where Windows was already updating the app
 * properly. The Store replaces the whole package instead.
 *
 * Nothing about that failure is visible from here. It happens on a user's
 * computer, weeks after a submission, when they press a button that should not
 * have been on the screen. There is no test run, no log and no report.
 *
 * So the absence is arranged structurally — an optional Cargo dependency, a
 * feature that is on by default and off for the Store, a `compile_error!` when
 * the two flags disagree — and this file holds every link of that chain.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * What is forbidden is a Store build that COULD carry the updater: a
 * non-optional dependency, a feature that pulls it in, a registration without
 * the feature gate, a missing tripwire, a build command missing
 * `--no-default-features`, a build-time capability glob that still reaches
 * `updater:default`, or a workflow that compiles the Store flavour without
 * telling the frontend.
 *
 * It never asserts that some blessed line is PRESENT, with two deliberate
 * exceptions that are anti-inert checks rather than policy: the updater must
 * still be in `default` (or the Store flavour is not a flavour, it is the only
 * build), and some capability file must still grant `updater:default` (or the
 * glob below excludes nothing).
 *
 * ============================================================================
 * WHAT IT CANNOT DO
 * ============================================================================
 * It reads source. It cannot see the dependency graph cargo actually resolves,
 * which is a different claim — so `.github/workflows/msix.yml` asks `cargo
 * tree` directly, in both directions, immediately before packaging. This guard
 * is the one that runs on every commit; that probe is the one that runs on the
 * artefact.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DISTRIBUTION_ENV, MICROSOFT_STORE } from '../platform/distribution.ts';

import { REPO_ROOT } from './repo-scan.ts';

const CARGO_TOML_PATH = 'apps/light/src-tauri/Cargo.toml';
const LIB_RS_PATH = 'apps/light/src-tauri/src/lib.rs';
const BUILD_RS_PATH = 'apps/light/src-tauri/build.rs';
const STORE_CONFIG_PATH = 'apps/light/src-tauri/tauri.microsoft-store.conf.json';
const MANIFEST_PATH = 'apps/light/src-tauri/msix/Package.appxmanifest';
const CAPABILITIES_PATH = 'apps/light/src-tauri/capabilities';
const WORKFLOW_DIRECTORY = '.github/workflows';

const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

const CARGO_TOML = read(CARGO_TOML_PATH);
const LIB_RS = read(LIB_RS_PATH);
const BUILD_RS = read(BUILD_RS_PATH);
const MANIFEST = read(MANIFEST_PATH);

/** The crate that must not reach a Store build. */
const UPDATER_CRATE = 'tauri-plugin-updater';
/** The feature that pulls it in. In `default`, so every other build keeps it. */
const UPDATER_FEATURE = 'updater';
/** The feature that selects the Store flavour. Compiles nothing of its own. */
const STORE_FEATURE = 'microsoft-store';
/** The cargo flag that actually removes the updater. */
const NO_DEFAULT_FEATURES = '--no-default-features';

// ── Detectors ───────────────────────────────────────────────────────────────

/** Is this crate declared `optional = true` anywhere in the manifest? */
export function declaredOptional(cargoToml: string, crate: string): boolean {
  const line = cargoToml
    .split('\n')
    .find((candidate) => candidate.trimStart().startsWith(`${crate} =`));
  return line !== undefined && /\boptional\s*=\s*true\b/.test(line);
}

/** The `[features]` block, as `name -> expansion entries`. */
export function featureTable(cargoToml: string): Map<string, string[]> {
  const lines = cargoToml.split('\n');
  const start = lines.findIndex((line) => line.trim() === '[features]');
  const table = new Map<string, string[]>();
  if (start === -1) return table;

  for (const line of lines.slice(start + 1)) {
    // The next section header ends the block. No anchors, no flags to get
    // wrong: the sibling guard for `wdio` was inert for exactly that reason.
    if (/^\s*\[/.test(line)) break;
    const match = /^\s*([A-Za-z0-9_-]+)\s*=\s*\[([^\]]*)\]/.exec(line);
    if (match === null) continue;
    const entries = (match[2] ?? '')
      .split(',')
      .map((entry) => entry.trim().replace(/^["']|["']$/g, ''))
      .filter((entry) => entry.length > 0);
    table.set(match[1] ?? '', entries);
  }
  return table;
}

/**
 * Every feature whose expansion reaches the crate, directly or through another
 * feature.
 *
 * Transitive on purpose: `store = ["extras"]`, `extras = ["dep:the-crate"]` is
 * the version nobody spots in review.
 */
export function featuresPullingIn(cargoToml: string, crate: string): string[] {
  const table = featureTable(cargoToml);
  const reaches = new Map<string, boolean>();

  const visit = (name: string, seen: Set<string>): boolean => {
    const cached = reaches.get(name);
    if (cached !== undefined) return cached;
    if (seen.has(name)) return false;
    seen.add(name);

    const answer = (table.get(name) ?? []).some(
      (entry) => entry === `dep:${crate}` || entry === crate || visit(entry, seen),
    );
    reaches.set(name, answer);
    return answer;
  };

  return [...table.keys()].filter((name) => visit(name, new Set())).sort();
}

/**
 * Registrations of the plugin without the feature gate on one of the three
 * lines above.
 *
 * Line-based rather than a Rust parse: the shape being forbidden is one
 * `.plugin(...)` call losing its attribute, and an attribute that is not on a
 * neighbouring line is not guarding anything anyway.
 */
export function registrationsWithoutTheFeature(libRs: string): string[] {
  const lines = libRs.split('\n');
  return lines.flatMap((line, index) => {
    if (!line.includes('tauri_plugin_updater::')) return [];
    const preceding = lines.slice(Math.max(0, index - 3), index).join('\n');
    return new RegExp(String.raw`#\[cfg\([^)]*feature\s*=\s*"${UPDATER_FEATURE}"`).test(preceding)
      ? []
      : [line.trim()];
  });
}

/** Does the compile-time tripwire that forbids both features at once exist? */
export function hasStoreTripwire(libRs: string): boolean {
  return (
    new RegExp(
      String.raw`#\[cfg\(all\(\s*feature\s*=\s*"${UPDATER_FEATURE}"\s*,\s*feature\s*=\s*"${STORE_FEATURE}"\s*\)\)\]`,
    ).test(libRs) && /compile_error!/.test(libRs)
  );
}

/** Does this line build the Store flavour? */
export function isStoreBuild(line: string): boolean {
  return (
    line.includes('tauri build') &&
    new RegExp(String.raw`--features[= ][^\n]*\b${STORE_FEATURE}\b`).test(line)
  );
}

/** Every Store build in a piece of text that is missing a required flag. */
export function storeBuildsMissing(text: string, required: string): string[] {
  return text
    .split('\n')
    .filter(isStoreBuild)
    .filter((line) => !line.includes(required))
    .map((line) => line.trim());
}

/** Capability FILES that grant an `updater:` permission, as bare file names. */
export function capabilityFilesGrantingUpdater(): string[] {
  const directory = join(REPO_ROOT, CAPABILITIES_PATH);
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => {
      const parsed: unknown = JSON.parse(readFileSync(join(directory, name), 'utf8'));
      const permissions = (parsed as { permissions?: readonly unknown[] }).permissions ?? [];
      return permissions.some((permission) => {
        const identifier =
          typeof permission === 'string'
            ? permission
            : ((permission as { identifier?: string }).identifier ?? '');
        return identifier.startsWith('updater:');
      });
    })
    .sort();
}

/**
 * The capability glob the Store flavour compiles with, out of `build.rs`.
 *
 * ============================================================================
 * WHY A GLOB IN build.rs AND NOT A LIST IN THE CONFIG
 * ============================================================================
 * `app.security.capabilities` in `tauri.conf.json` looks like the right lever
 * and is not. `tauri-build` 2.6.3 parses the capability DIRECTORY and validates
 * every permission in it against the compiled plugins BEFORE anything reads
 * that list — so with the updater plugin gone, `capabilities/desktop.json`
 * fails the build whatever the config says. This was measured, not assumed: the
 * config merge was tried, had no effect, and the failure is silent because the
 * key is perfectly valid and simply applies at runtime instead.
 *
 * `Attributes::capabilities_path_pattern` is the supported way to change what
 * the build parses, and `build.rs` can read a Cargo feature — so the same flag
 * that removes the plugin also removes the capability that names it.
 *
 * Returns `null` unless the call is genuinely behind the Store feature gate: a
 * pattern applied unconditionally would narrow EVERY build, including the
 * direct download that still needs the updater.
 */
export function storeCapabilityPattern(buildRs: string): string | null {
  const gate = buildRs.indexOf(`#[cfg(feature = "${STORE_FEATURE}")]`);
  const match = /capabilities_path_pattern\(\s*"([^"]+)"\s*\)/.exec(buildRs);
  if (gate === -1 || match?.index === undefined) return null;
  return match.index > gate ? (match[1] ?? null) : null;
}

/**
 * Would this glob reach that capability file?
 *
 * Deliberately dumb: any wildcard under `capabilities/` is treated as reaching
 * everything in it. That is not a general glob engine and it FAILS CLOSED — a
 * narrower wildcard like `capabilities/default*.json` would be reported as
 * reaching `desktop.json` when it does not. For a forbid-list that is the safe
 * direction, and the alternative is a glob library resolving a question this
 * repository only ever asks about two files.
 */
export function patternReaches(pattern: string, file: string): boolean {
  const normalised = pattern.replace(/^\.\//, '');
  if (normalised.includes('*')) return normalised.startsWith('capabilities/');
  return normalised === `capabilities/${file}`;
}

/** The three identity values a submission replaces, or `null` where absent. */
export function identityFields(manifestXml: string): Record<string, string | null> {
  const identity = /<Identity\b([^>]*)>/.exec(manifestXml)?.[1] ?? '';
  return {
    Name: /\bName="([^"]*)"/.exec(identity)?.[1] ?? null,
    Publisher: /\bPublisher="([^"]*)"/.exec(identity)?.[1] ?? null,
    PublisherDisplayName:
      /<PublisherDisplayName>([^<]*)<\/PublisherDisplayName>/.exec(manifestXml)?.[1] ?? null,
  };
}

// ── The corpus ──────────────────────────────────────────────────────────────

const WORKFLOW_NAMES = readdirSync(join(REPO_ROOT, WORKFLOW_DIRECTORY)).filter((name) =>
  /\.ya?ml$/.test(name),
);
const WORKFLOWS = new Map(
  WORKFLOW_NAMES.map((name) => [name, read(`${WORKFLOW_DIRECTORY}/${name}`)] as const),
);

const ROOT_SCRIPTS: Record<string, string> =
  (JSON.parse(read('package.json')) as { scripts?: Record<string, string> }).scripts ?? {};

/**
 * Every place a build command can be written down.
 *
 * The `tauri build` line lives in a root `package.json` script rather than in
 * the workflow, precisely so that the `--no-default-features` half cannot be
 * present in one caller and missing in another — so the scripts have to be in
 * the corpus or this guard adjudicates nothing.
 */
const BUILD_COMMAND_CORPUS = [
  ...Object.entries(ROOT_SCRIPTS).map(([name, body]) => `package.json ${name}: ${body}`),
  ...[...WORKFLOWS].map(([name, text]) =>
    text
      .split('\n')
      .map((line) => `${name}: ${line}`)
      .join('\n'),
  ),
].join('\n');

const STORE_CONFIG = JSON.parse(read(STORE_CONFIG_PATH)) as {
  bundle?: { createUpdaterArtifacts?: unknown };
};

// ── The premise ─────────────────────────────────────────────────────────────

describe('the premise: there is a Store flavour to adjudicate', () => {
  // Asserted FIRST. Every rule below is a filter over a list, and a corpus that
  // came back empty would make all of them pass by having nothing to say.

  it('the corpus contains a Store build to inspect', () => {
    const builds = BUILD_COMMAND_CORPUS.split('\n').filter(isStoreBuild);
    expect(
      builds,
      'No `tauri build --features microsoft-store` was found in any root script or workflow. ' +
        'Either the Store flavour is gone — in which case delete this contract rather than ' +
        'leaving it adjudicating nothing — or the detector has stopped matching it.',
    ).not.toEqual([]);
  });

  it('reads a real Cargo manifest with a features block', () => {
    expect(featureTable(CARGO_TOML).size).toBeGreaterThanOrEqual(3);
  });

  it('lib.rs still registers the updater somewhere', () => {
    expect(LIB_RS).toContain('tauri_plugin_updater::');
  });

  it('reads the real workflow directory', () => {
    expect(WORKFLOW_NAMES.length).toBeGreaterThanOrEqual(5);
    expect(WORKFLOW_NAMES).toContain('msix.yml');
  });
});

// ── The chain ───────────────────────────────────────────────────────────────

describe('the updater cannot reach a Microsoft Store build', () => {
  it('is an OPTIONAL dependency, so the feature is a gate and not a name', () => {
    expect(
      declaredOptional(CARGO_TOML, UPDATER_CRATE),
      `${UPDATER_CRATE} must be \`optional = true\` in ${CARGO_TOML_PATH}. Without that, ` +
        '`--no-default-features` removes a feature flag and leaves the crate compiled in, and ' +
        'the whole Store flavour is a naming convention.',
    ).toBe(true);
  });

  it(`is reachable only through \`default\` and \`${UPDATER_FEATURE}\``, () => {
    // Transitive, so a chain through a third feature is caught too. `default`
    // is in the list because `default = ["updater"]` — which is the point, and
    // is why `--no-default-features` is what removes the crate.
    //
    // The assertion is an exact list rather than a "does not contain
    // microsoft-store" check, because the failure worth catching is a NEW
    // feature quietly joining the set. A containment check would pass for
    // every one of those.
    expect(featuresPullingIn(CARGO_TOML, UPDATER_CRATE)).toEqual(['default', UPDATER_FEATURE]);
  });

  it(`the \`${STORE_FEATURE}\` feature pulls in nothing at all`, () => {
    expect(featureTable(CARGO_TOML).get(STORE_FEATURE)).toEqual([]);
  });

  it('anti-inert: every OTHER build still gets it, because it is in `default`', () => {
    // Without this leg, deleting the updater entirely would pass every rule
    // above. A gate that also removes the thing from the normal build is not a
    // gate, and a direct-download copy with no updater has no route to a fix.
    expect(featureTable(CARGO_TOML).get('default')).toContain(UPDATER_FEATURE);
  });

  it('is registered only behind the feature in lib.rs', () => {
    expect(registrationsWithoutTheFeature(LIB_RS)).toEqual([]);
  });

  it('keeps the compile_error tripwire for the two flags disagreeing', () => {
    expect(
      hasStoreTripwire(LIB_RS),
      `${LIB_RS_PATH} must keep \`#[cfg(all(feature = "${UPDATER_FEATURE}", feature = ` +
        `"${STORE_FEATURE}"))] compile_error!(...)\`. It is the only check that cannot be ` +
        'forgotten: if `--no-default-features` is ever dropped from the build command, the ' +
        'compiler refuses rather than shipping a Store package whose update button cannot work.',
    ).toBe(true);
  });

  it(`every Store build passes ${NO_DEFAULT_FEATURES}`, () => {
    const offenders = storeBuildsMissing(BUILD_COMMAND_CORPUS, NO_DEFAULT_FEATURES);
    expect(
      offenders,
      `A \`tauri build --features ${STORE_FEATURE}\` without \`${NO_DEFAULT_FEATURES}\` compiles ` +
        'the updater into a package that cannot use it. The tripwire in lib.rs turns that into a ' +
        'compile error, and this turns it into a failing test minutes earlier.',
    ).toEqual([]);
  });

  it('every Store build merges the Store config', () => {
    const offenders = storeBuildsMissing(BUILD_COMMAND_CORPUS, 'tauri.microsoft-store.conf.json');
    expect(
      offenders,
      'The Store config turns off `createUpdaterArtifacts`. Without it `tauri build` tries to ' +
        'sign updater artefacts for a build that has no updater, and demands a signing key it ' +
        'is never given.',
    ).toEqual([]);
  });
});

describe('the build-time capability glob leaves the updater out', () => {
  const granting = capabilityFilesGrantingUpdater();
  const pattern = storeCapabilityPattern(BUILD_RS);

  it('anti-inert: some capability file really does grant the updater', () => {
    // If nothing granted it, excluding nothing would look like a clean pass.
    expect(
      granting,
      'No capability file grants an `updater:` permission any more, so the glob below excludes ' +
        'nothing and this whole rule proves nothing.',
    ).not.toEqual([]);
  });

  it('build.rs narrows the glob, and only under the Store feature', () => {
    expect(
      pattern,
      `${BUILD_RS_PATH} must call \`capabilities_path_pattern\` behind ` +
        `\`#[cfg(feature = "${STORE_FEATURE}")]\`. Without it, \`tauri-build\` globs the whole ` +
        'capabilities directory and fails on `updater:default` — a permission for a plugin the ' +
        'Store build does not compile. Applying it unconditionally would be worse: it would ' +
        'narrow the direct-download build too, which still needs the updater.',
    ).not.toBeNull();
  });

  it('the glob reaches no capability file that grants the updater', () => {
    const reached = granting.filter((file) => patternReaches(pattern ?? '', file));
    expect(
      reached,
      `The Store capability glob \`${pattern}\` still reaches ${reached.join(', ')}, which grants ` +
        'an `updater:` permission. That is a build failure at best and a permission for an ' +
        'absent plugin at worst.',
    ).toEqual([]);
  });

  it('anti-inert: the glob still reaches the capability every build needs', () => {
    // A pattern matching nothing at all would pass the rule above and leave the
    // app with no permissions whatsoever.
    expect(patternReaches(pattern ?? '', 'default.json')).toBe(true);
  });

  it('turns off updater artefacts, which would demand a signing key', () => {
    expect(STORE_CONFIG.bundle?.createUpdaterArtifacts).toBe(false);
  });

  it('the pattern detector bites, and lets the honest shape through', () => {
    const gated =
      `fn main() {\n  let a = Attributes::new();\n  #[cfg(feature = "${STORE_FEATURE}")]\n` +
      '  let a = a.capabilities_path_pattern("./capabilities/default.json");\n}';
    expect(storeCapabilityPattern(gated)).toBe('./capabilities/default.json');

    // Ungated: it would narrow every build, so it is not a Store gate at all.
    expect(
      storeCapabilityPattern(
        'fn main() { Attributes::new().capabilities_path_pattern("./capabilities/default.json"); }',
      ),
    ).toBeNull();
    // Gate present but AFTER the call — it guards something else.
    expect(
      storeCapabilityPattern(
        'a.capabilities_path_pattern("./capabilities/default.json");\n' +
          `#[cfg(feature = "${STORE_FEATURE}")]\nlet b = b;`,
      ),
    ).toBeNull();
    expect(storeCapabilityPattern('fn main() { tauri_build::build() }')).toBeNull();
  });

  it('the glob matcher bites, and lets the honest shape through', () => {
    expect(patternReaches('./capabilities/**/*', 'desktop.json')).toBe(true);
    expect(patternReaches('capabilities/**/*', 'default.json')).toBe(true);
    expect(patternReaches('./capabilities/default.json', 'desktop.json')).toBe(false);
    expect(patternReaches('./capabilities/default.json', 'default.json')).toBe(true);
  });
});

describe('the screen agrees with the binary', () => {
  const storeWorkflows = [...WORKFLOWS].filter(
    ([, text]) => text.includes('build:msix') || text.split('\n').some(isStoreBuild),
  );
  const flagged = [...WORKFLOWS].filter(([, text]) => text.includes(DISTRIBUTION_ENV));

  it('anti-inert: some workflow does build the Store flavour', () => {
    expect(storeWorkflows.map(([name]) => name)).not.toEqual([]);
  });

  it('every workflow that builds the Store flavour also tells the frontend', () => {
    // A Store build with the updater compiled out and this variable unset draws
    // a "Check for updates" button that calls a plugin that is not there.
    const offenders = storeWorkflows
      .filter(([, text]) => !new RegExp(`${DISTRIBUTION_ENV}:\\s*${MICROSOFT_STORE}\\b`).test(text))
      .map(([name]) => name);

    expect(offenders).toEqual([]);
  });

  it('no workflow claims the Store flavour without building it', () => {
    // The other direction, and the worse one: a build that TELLS the screen it
    // came from the Store while still carrying an updater would hide the only
    // update route a direct download has.
    const names = new Set(storeWorkflows.map(([name]) => name));
    expect(flagged.map(([name]) => name).filter((name) => !names.has(name))).toEqual([]);
  });
});

describe('the package manifest is honest about its placeholders', () => {
  const fields = identityFields(MANIFEST);
  const values = Object.values(fields);

  it('carries all three identity fields', () => {
    expect(fields.Name).not.toBeNull();
    expect(fields.Publisher).not.toBeNull();
    expect(fields.PublisherDisplayName).not.toBeNull();
  });

  it('is either all placeholders or none — never half filled in', () => {
    // ==================================================================
    // THE THREE-STATE RULE, THE SAME SHAPE AS THE APPLE SIGNING GATE.
    // ==================================================================
    // This never asks that the fields BE placeholders: replacing all three is
    // exactly what a real submission does. What it forbids is the middle
    // state, where somebody pasted the Publisher from Partner Center and left
    // the Name — because that manifest looks finished, passes every other
    // check here, and is rejected at upload.
    const placeholders = values.filter((value) => /placeholder/i.test(value ?? '')).length;
    expect(
      placeholders === 0 || placeholders === values.length,
      `${placeholders} of ${values.length} identity fields in ${MANIFEST_PATH} are still ` +
        `placeholders: ${JSON.stringify(fields)}. Paste all three from Partner Center ` +
        '(Product -> Product identity) or none of them.',
    ).toBe(true);
  });

  it('uses a four-part version whose fourth number is zero', () => {
    // The Microsoft Store reserves the fourth number and rejects a package that
    // sets it to anything else.
    const version = /<Identity\b[^>]*\bVersion="([^"]*)"/.exec(MANIFEST)?.[1];
    expect(version).toMatch(/^\d+\.\d+\.\d+\.0$/);
  });
});

// ── Proof the detectors can actually fail ───────────────────────────────────

describe('the detectors bite, and let the honest shapes through', () => {
  const manifest = (features: string, dependency: string): string =>
    `[package]\nname = "light"\n\n[features]\n${features}\n\n[dependencies]\ntauri = "2"\n` +
    `\n[target.'cfg(unix)'.dependencies]\n${dependency}\n`;

  it('sees an optional dependency, and a non-optional one', () => {
    expect(
      declaredOptional(
        manifest('a = []', `${UPDATER_CRATE} = { version = "2", optional = true }`),
        UPDATER_CRATE,
      ),
    ).toBe(true);
    expect(declaredOptional(manifest('a = []', `${UPDATER_CRATE} = "2"`), UPDATER_CRATE)).toBe(
      false,
    );
    expect(
      declaredOptional(manifest('a = []', `${UPDATER_CRATE} = { version = "2" }`), UPDATER_CRATE),
    ).toBe(false);
  });

  it('follows a feature chain, not just a direct mention', () => {
    const chained = manifest(
      `default = ["shim"]\nshim = ["${UPDATER_FEATURE}"]\n${UPDATER_FEATURE} = ["dep:${UPDATER_CRATE}"]`,
      `${UPDATER_CRATE} = { version = "2", optional = true }`,
    );
    expect(featuresPullingIn(chained, UPDATER_CRATE)).toEqual(['default', 'shim', UPDATER_FEATURE]);
  });

  it('finds the features block when it is not the first line of the file', () => {
    // The exact blind spot that made the sibling `wdio` guard inert for a
    // while: a pattern anchored to the start of the INPUT never matched a real
    // Cargo.toml, so the scan returned "no offenders" for every input.
    expect(featureTable(CARGO_TOML).has(UPDATER_FEATURE)).toBe(true);
  });

  it('stops at the next section rather than reading dependencies as features', () => {
    expect([...featureTable(manifest('a = []', 'x = "1"')).keys()]).toEqual(['a']);
  });

  it('catches an unguarded registration and accepts a guarded one', () => {
    expect(
      registrationsWithoutTheFeature(
        '    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());',
      ),
    ).toHaveLength(1);
    expect(
      registrationsWithoutTheFeature(
        `    #[cfg(desktop)]\n    #[cfg(feature = "${UPDATER_FEATURE}")]\n` +
          '    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());',
      ),
    ).toEqual([]);
  });

  it('knows the tripwire from a cfg that merely mentions a feature', () => {
    expect(
      hasStoreTripwire(
        `#[cfg(all(feature = "${UPDATER_FEATURE}", feature = "${STORE_FEATURE}"))]\ncompile_error!("no");`,
      ),
    ).toBe(true);
    expect(hasStoreTripwire('')).toBe(false);
    expect(hasStoreTripwire(`#[cfg(feature = "${STORE_FEATURE}")]\nlet b = b;`)).toBe(false);
    // The attribute without the error is not a tripwire.
    expect(
      hasStoreTripwire(
        `#[cfg(all(feature = "${UPDATER_FEATURE}", feature = "${STORE_FEATURE}"))]\nlet b = b;`,
      ),
    ).toBe(false);
  });

  it('spots a Store build in either spelling of the features flag', () => {
    expect(
      isStoreBuild(`run: tauri build --features ${STORE_FEATURE} -- ${NO_DEFAULT_FEATURES}`),
    ).toBe(true);
    expect(isStoreBuild(`run: pnpm tauri build --features=${STORE_FEATURE}`)).toBe(true);
    // Honest lines that must walk through.
    expect(isStoreBuild('run: pnpm tauri build --debug')).toBe(false);
    expect(isStoreBuild(`# the ${STORE_FEATURE} feature is not enabled here`)).toBe(false);
  });

  it('catches a Store build that lost the flag that does the work', () => {
    const offenders = storeBuildsMissing(
      `run: pnpm tauri build --features ${STORE_FEATURE} --config x.json`,
      NO_DEFAULT_FEATURES,
    );
    expect(offenders).toHaveLength(1);
    expect(
      storeBuildsMissing(
        `run: pnpm tauri build --features ${STORE_FEATURE} -- ${NO_DEFAULT_FEATURES}`,
        NO_DEFAULT_FEATURES,
      ),
    ).toEqual([]);
  });

  it('reads identity fields, and recognises a half-filled one', () => {
    const half =
      '<Identity Name="Real.Name" Publisher="CN=PLACEHOLDER-x" Version="1.0.0.0" />' +
      '<PublisherDisplayName>A Real Name</PublisherDisplayName>';
    const fields = identityFields(half);

    expect(fields.Name).toBe('Real.Name');
    expect(fields.Publisher).toBe('CN=PLACEHOLDER-x');
    expect(fields.PublisherDisplayName).toBe('A Real Name');

    const placeholders = Object.values(fields).filter((value) => /placeholder/i.test(value ?? ''));
    expect(placeholders).toHaveLength(1);
  });
});
