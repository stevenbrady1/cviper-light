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

/**
 * The shape Partner Center issues for `Identity/@Publisher` on this account.
 *
 * `CN=` then an UPPERCASE GUID, and anchored at both ends so a trailing space
 * or a second RDN is a failure rather than a shrug. Partner Center compares
 * this value to the reservation CASE SENSITIVELY, so the character class is
 * deliberately not `[0-9A-Fa-f]` — a lowercased GUID is a real, rejected-at-
 * upload package, and a guard that accepted it would be agreeing with the
 * mistake.
 *
 * If this repository ever moves to a COMPANY account, Partner Center issues a
 * full distinguished name (`CN=Acme Ltd, O=Acme, C=GB`) instead and this test
 * is the right place to find that out: widen it deliberately, with the new
 * value in front of you.
 */
const PUBLISHER_SHAPE = /^CN=[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

/**
 * The shape of `Identity/@Name`: a publisher prefix, a dot, then the app name.
 *
 * The prefix is issued, not chosen. Ours is `StBr` and reads like an
 * abbreviation somebody could "tidy" into `StevenBrady` — which would be a
 * different package that no longer matches the reservation.
 */
const IDENTITY_NAME_SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9.-]*$/;

/** Is this a real pasted value, rather than blank or a leftover example? */
export function looksPasted(value: string | null): boolean {
  return value !== null && value.trim().length > 0 && !/placeholder/i.test(value);
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

describe('the identity is the real reservation, and keeps its shape', () => {
  // ==========================================================================
  // WHY THIS EXISTS, AND WHY IT IS NOT THE RULE ABOVE (L-93 follow-up)
  // ==========================================================================
  // The all-three-or-none rule forbids the HALF-FILLED state. That was the
  // right question while the values were unpasted, and it is the wrong one now
  // that they are real: with nothing matching /placeholder/i, it counts zero,
  // compares zero to zero, and passes for EVERY possible manifest. Blank all
  // three, lowercase the GUID, drop the `StBr.` prefix, and it still passes.
  // Each of those is a package Partner Center rejects at upload.
  //
  // So the rule above is kept, unchanged, for the state it was written for,
  // and this one pins what the fields must now LOOK like. Neither asserts the
  // literal values: a guard that hardcoded the GUID would be a copy of the
  // manifest rather than a statement about it, and would go red for the one
  // edit that is legitimate here — a genuine new reservation.
  const fields = identityFields(MANIFEST);

  it('all three are pasted values, not blanks or leftover examples', () => {
    // This is the leg the rule above cannot carry. `placeholders === 0` is true
    // of an empty string too.
    const unpasted = Object.entries(fields)
      .filter(([, value]) => !looksPasted(value))
      .map(([name]) => name);
    expect(
      unpasted,
      `${unpasted.join(', ')} in ${MANIFEST_PATH} is blank or still reads as a placeholder. ` +
        'Partner Center (Product -> Product identity) is the only source for these.',
    ).toEqual([]);
  });

  it('Publisher is `CN=` and an UPPERCASE GUID, as Partner Center issued it', () => {
    expect(
      fields.Publisher,
      `Identity/@Publisher is "${fields.Publisher}". Partner Center compares it to the ` +
        'reservation character for character, so a lowercased GUID, a missing `CN=` or a ' +
        'trailing space is a package that is rejected at upload.',
    ).toMatch(PUBLISHER_SHAPE);
  });

  it('Name is a `<prefix>.<name>` identity, prefix intact', () => {
    expect(
      fields.Name,
      `Identity/@Name is "${fields.Name}". The publisher prefix before the dot is issued by ` +
        'Partner Center, not chosen, and an identity without one matches no reservation.',
    ).toMatch(IDENTITY_NAME_SHAPE);
  });

  it('the shape checks bite, and let the real values through', () => {
    // Anti-inert. Every rule above is a match against a pattern, and a pattern
    // that accepted anything would make all of them permanently green
    // statements about nothing. The rejected values below are the exact
    // placeholders this manifest shipped with, plus the near-misses that look
    // finished and are not.
    expect(PUBLISHER_SHAPE.test('CN=F08F8DD5-FEF4-41DC-84E4-37C56C36B399')).toBe(true);
    expect(PUBLISHER_SHAPE.test('CN=PLACEHOLDER-Partner-Center-Publisher-Id')).toBe(false);
    expect(PUBLISHER_SHAPE.test('CN=f08f8dd5-fef4-41dc-84e4-37c56c36b399')).toBe(false);
    expect(PUBLISHER_SHAPE.test('F08F8DD5-FEF4-41DC-84E4-37C56C36B399')).toBe(false);
    expect(PUBLISHER_SHAPE.test('CN=F08F8DD5-FEF4-41DC-84E4-37C56C36B399 ')).toBe(false);
    expect(PUBLISHER_SHAPE.test('')).toBe(false);

    expect(IDENTITY_NAME_SHAPE.test('StBr.CViperLight')).toBe(true);
    expect(IDENTITY_NAME_SHAPE.test('PLACEHOLDER-Partner-Center-Identity-Name')).toBe(false);
    expect(IDENTITY_NAME_SHAPE.test('CViperLight')).toBe(false);
    expect(IDENTITY_NAME_SHAPE.test('')).toBe(false);

    expect(looksPasted('Steven Brady')).toBe(true);
    expect(looksPasted('PLACEHOLDER-Owners-Own-Name')).toBe(false);
    expect(looksPasted('   ')).toBe(false);
    expect(looksPasted(null)).toBe(false);
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

// ── One binary in the package, and no second one ─────────────────────────────

/**
 * Lines that would copy a DLL into the MSIX layout.
 *
 * Comments are stripped first, for the reason `repo-scan.ts` gives: the
 * paragraph explaining why DLLs are excluded names `light_lib.dll` repeatedly,
 * and a guard that fired on its own rationale is a guard somebody deletes.
 */
export function dllCopiesIntoTheLayout(workflowText: string): string[] {
  return workflowText
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .filter((line) => /Copy-Item/i.test(line) && /\.dll\b/i.test(line))
    .map((line) => line.trim());
}

describe('the package contains one binary, and the kit scans only that', () => {
  /**
   * ==========================================================================
   * WHY THIS MATTERS MORE THAN IT LOOKS
   * ==========================================================================
   * `target/release` holds `light_lib.dll`, a cdylib nothing loads at runtime
   * because `main.rs` links the crate as an rlib. Staging it would hand the
   * certification kit a SECOND binary to scan for blocked APIs — and an earlier
   * draft of the L-95 spike did exactly that, manufacturing a "Blocked
   * executables" failure caused entirely by packaging and indistinguishable in
   * the report from a real one.
   *
   * The workflow already copies only the one discovered executable. Nothing
   * held that shape, so a future `Copy-Item *.dll` would have been green here
   * and wrong in the package. This is the fast half — the workflow also asserts
   * the real staged tree holds exactly one PE and no DLLs, which catches a DLL
   * this scan cannot see, such as one arriving inside `bundle.resources`.
   */
  const MSIX_WORKFLOW = read(`${WORKFLOW_DIRECTORY}/msix.yml`);

  it('anti-inert: the workflow really does stage files with Copy-Item', () => {
    // A scan that found no copying at all would report "no DLL copies" while
    // inspecting nothing.
    const copies = MSIX_WORKFLOW.split('\n').filter((line) => /Copy-Item/i.test(line));
    expect(copies.length).toBeGreaterThanOrEqual(3);
  });

  it('copies no DLL into the layout', () => {
    const offenders = dllCopiesIntoTheLayout(MSIX_WORKFLOW);
    expect(
      offenders,
      'Staging a second binary changes what the certification kit scans for blocked APIs, and ' +
        'produces a failure about our packaging that reads exactly like a failure about the app.',
    ).toEqual([]);
  });

  it('asserts the staged layout, rather than trusting the copying', () => {
    // The artefact-level half. Named here so that deleting it from the
    // workflow is a failing test rather than a silent loss of cover.
    expect(MSIX_WORKFLOW).toMatch(/\$stagedDlls/);
    expect(MSIX_WORKFLOW).toMatch(/stagedExes\.Count -ne 1/);
  });

  it('the detector bites, and lets the honest lines through', () => {
    expect(dllCopiesIntoTheLayout('  Copy-Item $d.FullName -Destination $layout # a.dll')).toEqual(
      [],
    );
    expect(
      dllCopiesIntoTheLayout("Copy-Item (Join-Path $target '*.dll') -Destination $layout"),
    ).toHaveLength(1);
    expect(dllCopiesIntoTheLayout('Copy-Item $exe.FullName -Destination $layout')).toEqual([]);
    expect(dllCopiesIntoTheLayout('Write-Host "not staging light_lib.dll"')).toEqual([]);
  });
});

// ── The artefact is installable, and carries no private key ──────────────────

/**
 * Key material: the things that must never be downloadable from a public
 * repository.
 *
 * `.cer` is deliberately NOT here. A DER certificate is a public key and a
 * signature; publishing one is the whole point of the section below, and a
 * forbid-list that also forbade the fix would be a rule nobody could satisfy.
 */
const KEY_MATERIAL = /\.(pfx|p12|pem|key|snk|jks|keystore)\b/i;

/** Indentation width, without a non-null assertion on a regex group. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * The steps of a workflow job, as `{ name, body }`.
 *
 * Line-based rather than a YAML parse, for the same reason the detectors above
 * are: the question is only ever "is this step still here, and does its body
 * still do the thing", and a parser would add a dependency to answer it.
 *
 * The step indent is DISCOVERED as the shallowest `- name:`/`- uses:` rather
 * than hardcoded, so re-indenting the file does not silently return zero steps
 * — which every assertion below would read as "no offending step found".
 */
export function workflowSteps(workflowText: string): { name: string; body: string }[] {
  const lines = workflowText.replaceAll('\r\n', '\n').split('\n');

  const starts: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (/^\s*-\s+(name|uses):/.test(line)) starts.push(index);
  }
  if (starts.length === 0) return [];

  const stepIndent = Math.min(...starts.map((index) => indentOf(lines[index] ?? '')));
  const boundaries = starts.filter((index) => indentOf(lines[index] ?? '') === stepIndent);

  return boundaries.map((start, position) => ({
    name: /^\s*-\s+name:\s*(.*)$/.exec(lines[start] ?? '')?.[1]?.trim() ?? '',
    body: lines.slice(start, boundaries[position + 1] ?? lines.length).join('\n'),
  }));
}

/**
 * Every file name the workflow writes into `OUT_DIR` — the directory that
 * BECOMES the artefact.
 *
 * Comments are stripped first, for the reason `repo-scan.ts` gives and this
 * file already relies on once: the paragraphs explaining why the private key
 * stays out name `devcert.pfx` repeatedly, and a guard that fired on its own
 * rationale is a guard somebody deletes.
 *
 * A name must start with an alphanumeric, so a bare extension in a forbid-list
 * (`'.pfx'`) is not mistaken for a file this job writes.
 */
export function artefactFileNames(workflowText: string): string[] {
  const names = new Set<string>();

  for (const raw of workflowText.replaceAll('\r\n', '\n').split('\n')) {
    const code = raw.replace(/#.*$/, '');
    if (!/\bOUT_DIR\b/.test(code)) continue;
    for (const match of code.matchAll(/'([A-Za-z0-9][^']*\.[A-Za-z0-9]+)'/g)) {
      const name = match[1];
      if (name !== undefined) names.add(name);
    }
  }

  return [...names].sort();
}

/**
 * Lines that put key material into the uploaded directory.
 *
 * `uploadedSecretMaterial` in `no-automation-server-in-shipped-builds.contract
 * .test.ts` reads the `upload-artifact` step and cannot see this: the step
 * names a DIRECTORY, so a `.pfx` written into that directory ten steps earlier
 * is invisible to it and lands in the artefact all the same. This is the same
 * rule asked one step upstream, where the file is created.
 *
 * KNOWN COUPLING, stated so nobody rediscovers it in a red build: the workflow
 * carries the same forbid-list at runtime, and the line that NAMES the
 * extensions must stay separate from the line that names `OUT_DIR`, or this
 * detector fires on the guard rather than on a leak.
 */
export function keyMaterialIntoTheArtefact(workflowText: string): string[] {
  return workflowText
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .filter((line) => /\bOUT_DIR\b/.test(line) && KEY_MATERIAL.test(line))
    .map((line) => line.trim());
}

/**
 * Exactly what the `cviper-light-msix` artefact contains.
 *
 * An allow-list, which the rest of this file argues against — and the argument
 * does not apply here. LESSON-033 is about proving a property of CODE, where
 * "X must be present" rots into a shape somebody satisfies with a comment.
 * This is a published download from a PUBLIC repository: the risk is a file
 * arriving that nobody decided to publish, and only a closed list catches that.
 * Adding one means adding it here, in front of a reviewer.
 */
const ARTEFACT_FILES = [
  // The submission itself, and the manifest it was packed from.
  'CViperLight-store.msix',
  'Package.appxmanifest',
  // The public half of the per-run signer, so the package can be installed
  // for the one-time open test (L-119).
  'devcert-public.cer',
  // Evidence: what went into the package, and what the kit made of it.
  'target-inventory.txt',
  'wack-report.xml',
  'wack-verdict.md',
].sort();

describe('the artefact can be installed, and carries no private key', () => {
  const MSIX = read(`${WORKFLOW_DIRECTORY}/msix.yml`);

  /**
   * ==========================================================================
   * WHY THE PUBLIC CERTIFICATE HAS TO TRAVEL WITH THE PACKAGE
   * ==========================================================================
   * WACK is static analysis — its own report says "Running tests without
   * application deployment" — so a package can pass every certification check
   * and still fail to open. Nothing had ever installed this one (L-119).
   *
   * It cannot be installed by double-clicking, either. The package is signed
   * by a self-signed certificate generated during the run, which no machine
   * trusts, and `Add-AppxPackage -AllowUnsigned` does not apply: that switch
   * is for genuinely UNSIGNED packages carrying the unsigned-package OID,
   * while this one is signed and carries the real Store publisher. The
   * supported route is to trust the signer for the length of the test, which
   * needs its PUBLIC half — and only its public half.
   */

  it('anti-inert: the upload step publishes exactly the directory these rules scan', () => {
    // Every rule below reasons about `OUT_DIR`. That only means anything while
    // `OUT_DIR` is the directory that gets uploaded — so both halves are
    // pinned here, and a workflow that started uploading somewhere else fails
    // loudly rather than leaving the rules scanning a private folder.
    expect(MSIX, 'OUT_DIR must still be the temp `out` directory').toContain(
      'OUT_DIR=${{ runner.temp }}/out',
    );

    const uploads = workflowSteps(MSIX).filter((step) =>
      /uses:\s*actions\/upload-artifact/.test(step.body),
    );
    expect(uploads, 'exactly one artefact is published from this job').toHaveLength(1);
    expect(uploads[0]?.body).toMatch(/path:\s*\$\{\{\s*runner\.temp\s*\}\}\/out\s*$/m);
  });

  it('publishes exactly the files somebody decided to publish', () => {
    expect(
      artefactFileNames(MSIX),
      'The artefact is a download link for anyone signed in, and this repository is public. ' +
        'A file written into OUT_DIR that is not on this list is a file nobody agreed to ' +
        'publish. Add it here, with a reason, in the same commit that writes it.',
    ).toEqual(ARTEFACT_FILES);
  });

  it('exports the public certificate, in a step that is really there', () => {
    // Anti-inert, and the reason this reads the parsed STEP rather than the
    // file: `toContain('devcert-public.cer')` over the whole workflow would
    // still pass if the export were deleted and only the comment explaining it
    // survived — which is exactly how this repository has lost cover before.
    const exporters = workflowSteps(MSIX).filter((step) =>
      step.body
        .split('\n')
        .some((line) => !/^\s*#/.test(line) && line.includes('devcert-public.cer')),
    );

    expect(
      exporters,
      'No step writes `devcert-public.cer`. Without it the artefact is a package that cannot ' +
        'be installed on any machine: the signer is a per-run self-signed certificate nobody ' +
        'trusts, and `-AllowUnsigned` does not apply to a signed package.',
    ).toHaveLength(1);

    const exporter = exporters[0]?.body ?? '';
    expect(exporter, 'the certificate must land in the directory that is uploaded').toMatch(
      /\$env:OUT_DIR/,
    );
    expect(
      exporter,
      'export the PUBLIC content type — `X509ContentType::Cert` is a public key and a ' +
        'signature by construction, not by convention',
    ).toMatch(/X509ContentType\]::Cert\b/);
    expect(
      exporter,
      'the thumbprint goes to the job summary, so the owner can untrust exactly what they ' +
        'trusted rather than guessing at the certificate store afterwards',
    ).toMatch(/GITHUB_STEP_SUMMARY/);
  });

  it('writes no key material into the uploaded directory', () => {
    expect(
      keyMaterialIntoTheArtefact(MSIX),
      'The private half must never leave the runner. `devcert.pfx` lives in PACK_DIR, which ' +
        'is not uploaded; anything with a key in it that reaches OUT_DIR is published to a ' +
        'public repository the moment the run finishes.',
    ).toEqual([]);
  });

  it('asks the same question of the real files, not just of the YAML', () => {
    // The artefact-level half, named here so that deleting it from the
    // workflow is a failing test rather than a silent loss of cover. A static
    // scan cannot see a key written by a TOOL into a path nobody wrote down.
    expect(MSIX).toMatch(/\$forbiddenExtensions/);
    expect(MSIX).toMatch(/Signing material in the artefact/);
  });

  it('the detectors bite, and let the honest lines through', () => {
    // A leak: the export writing the private half instead of the public one.
    expect(keyMaterialIntoTheArtefact("$p = Join-Path $env:OUT_DIR 'devcert.pfx'")).toHaveLength(1);
    expect(keyMaterialIntoTheArtefact('Copy-Item k.p12 -Destination $env:OUT_DIR')).toHaveLength(1);
    // Honest: the key used where it is generated, and never sent to OUT_DIR.
    expect(keyMaterialIntoTheArtefact('winapp pack --cert devcert.pfx --output $out')).toEqual([]);
    // Honest: the comment that explains the rule must not trip the rule.
    expect(keyMaterialIntoTheArtefact('  # devcert.pfx never reaches OUT_DIR')).toEqual([]);
    // Honest: the public half is not key material.
    expect(keyMaterialIntoTheArtefact("Join-Path $env:OUT_DIR 'devcert-public.cer'")).toEqual([]);

    expect(artefactFileNames("$x = Join-Path $env:OUT_DIR 'a.txt'")).toEqual(['a.txt']);
    // A bare extension in a forbid-list is not a file this job writes.
    expect(artefactFileNames("$forbidden = @('.pfx') # near $env:OUT_DIR")).toEqual([]);
    expect(artefactFileNames("Join-Path $env:PACK_DIR 'b.txt'")).toEqual([]);

    const steps = workflowSteps(
      ['      - name: one', '        run: echo', '      - uses: x'].join('\n'),
    );
    expect(steps.map((step) => step.name)).toEqual(['one', '']);
    expect(steps[0]?.body).toContain('run: echo');
    expect(workflowSteps('')).toEqual([]);
  });
});
