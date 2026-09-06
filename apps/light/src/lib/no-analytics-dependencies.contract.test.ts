/**
 * The no-analytics contract: no analytics, telemetry, crash-reporting or
 * session-recording SDK is a dependency of any package, in either language.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `features/settings/telemetry.contract.test.ts` proves nothing in OUR code
 * branches on the telemetry flag. It cannot see a vendor SDK, and a vendor SDK
 * is how telemetry actually arrives: `import * as Sentry from '@sentry/react'`
 * and one `init()` call, and every unhandled error — with the user's file
 * paths and CV text in the stack frames — goes to a third party on launch,
 * with no flag anywhere for the other guard to find.
 *
 * So this guard looks where that SDK would have to appear first: the
 * manifests and lockfiles. A package that is not installed cannot phone home.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * The list names what must be ABSENT. It will never be complete — there is
 * always another vendor — and that is fine: a name added here on the day
 * someone proposes it is a guard that fires the next time, and the
 * outbound-hosts contract catches the host the SDK would contact regardless.
 * An allow-list of permitted packages would break on every honest upgrade.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, walk } from './repo-scan.ts';

/**
 * npm names. A trailing `/` means "any package in this scope"; anything else
 * is matched exactly or as a `name@version` lockfile key.
 */
export const FORBIDDEN_NPM: readonly string[] = [
  '@sentry/',
  '@bugsnag/',
  '@datadog/',
  '@amplitude/',
  '@segment/',
  '@firebase/',
  '@hotjar/',
  '@vercel/analytics',
  '@vercel/speed-insights',
  '@microsoft/applicationinsights-web',
  '@microsoft/applicationinsights-react-js',
  '@fullstory/browser',
  '@logrocket/',
  'analytics',
  'analytics-node',
  'bugsnag-js',
  'firebase',
  'logrocket',
  'mixpanel',
  'mixpanel-browser',
  'newrelic',
  'posthog-js',
  'posthog-node',
  'react-ga',
  'react-ga4',
  'rollbar',
  'universal-analytics',
];

/** Cargo crate names, matched exactly or as a `name-*` family. */
export const FORBIDDEN_CRATES: readonly string[] = [
  'sentry',
  'sentry-*',
  'posthog-rs',
  'bugsnag',
  'rollbar',
  'opentelemetry-otlp',
  'datadog-*',
];

export function npmNameIsForbidden(name: string): boolean {
  return FORBIDDEN_NPM.some((forbidden) =>
    forbidden.endsWith('/') ? name.startsWith(forbidden) : name === forbidden,
  );
}

export function crateNameIsForbidden(name: string): boolean {
  return FORBIDDEN_CRATES.some((forbidden) =>
    forbidden.endsWith('-*') ? name.startsWith(forbidden.slice(0, -1)) : name === forbidden,
  );
}

/** Dependency names declared in one `package.json`, across every section. */
export function declaredNpmDependencies(manifestText: string): string[] {
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  const sections = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ] as const;
  return sections.flatMap((section) => {
    const block = manifest[section];
    return block && typeof block === 'object' ? Object.keys(block as object) : [];
  });
}

/**
 * Package names in a pnpm v9 lockfile: every `  'name@version':` or
 * `  name@version:` key under `packages:`. The scope's `@` is part of the
 * name; the version's `@` is the last one.
 */
export function lockfilePackageNames(lockText: string): string[] {
  return [...lockText.matchAll(/^ {2}'?((?:@[^/@'\s]+\/)?[^@'\s]+)@[^:'\n]+'?:\s*$/gm)].map(
    (match) => match[1] ?? '',
  );
}

/** Crate names in `Cargo.toml` dependency tables and every `Cargo.lock` package. */
export function cargoDependencyNames(cargoTomlText: string): string[] {
  return [...cargoTomlText.matchAll(/^([A-Za-z0-9_-]+)\s*=\s*(?:\{|")/gm)].map(
    (match) => match[1] ?? '',
  );
}

export function cargoLockPackageNames(cargoLockText: string): string[] {
  return [...cargoLockText.matchAll(/^name = "([^"]+)"$/gm)].map((match) => match[1] ?? '');
}

const MANIFESTS = [
  join(REPO_ROOT, 'package.json'),
  ...walk(join(REPO_ROOT, 'apps'), { extensions: ['package.json'] }),
  ...walk(join(REPO_ROOT, 'packages'), { extensions: ['package.json'] }),
];
const LOCKFILE = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
const CARGO_TOML = readFileSync(join(REPO_ROOT, 'apps/light/src-tauri/Cargo.toml'), 'utf8');
const CARGO_LOCK = readFileSync(join(REPO_ROOT, 'apps/light/src-tauri/Cargo.lock'), 'utf8');

describe('the forbid-list matchers', () => {
  it('match scopes, exact names and crate families — and nothing adjacent', () => {
    expect(npmNameIsForbidden('@sentry/react')).toBe(true);
    expect(npmNameIsForbidden('posthog-js')).toBe(true);
    expect(npmNameIsForbidden('analytics')).toBe(true);
    // Adjacent honest names must walk through: a guard that fires on
    // `react` because `react-ga` is forbidden is a guard that gets deleted.
    expect(npmNameIsForbidden('react')).toBe(false);
    expect(npmNameIsForbidden('@testing-library/react')).toBe(false);
    expect(crateNameIsForbidden('sentry-tracing')).toBe(true);
    expect(crateNameIsForbidden('serde')).toBe(false);
  });
});

describe('the manifest parsers see the real dependencies', () => {
  // Anti-inert: each parser is shown to find a dependency that is certainly
  // there, so an empty result can never be mistaken for a clean one.
  it('read every package.json', () => {
    expect(MANIFESTS.length).toBeGreaterThan(5);
    const root = declaredNpmDependencies(readFileSync(MANIFESTS[0] ?? '', 'utf8'));
    expect(root).toContain('vitest');
  });

  it('read the pnpm lockfile', () => {
    const names = lockfilePackageNames(LOCKFILE);
    expect(names.length).toBeGreaterThan(100);
    expect(names).toContain('react');
    expect(names).toContain('@tauri-apps/api');
  });

  it('read Cargo.toml and Cargo.lock', () => {
    expect(cargoDependencyNames(CARGO_TOML)).toContain('keyring');
    expect(cargoLockPackageNames(CARGO_LOCK)).toContain('tauri');
  });
});

describe('no analytics, telemetry, crash-reporting or session-recording SDK is installed', () => {
  it('in any package.json', () => {
    const found = MANIFESTS.flatMap((file) =>
      declaredNpmDependencies(readFileSync(file, 'utf8'))
        .filter(npmNameIsForbidden)
        .map((name) => `${displayPath(file)}: ${name}`),
    );
    expect(found).toEqual([]);
  });

  it('anywhere in pnpm-lock.yaml, transitively', () => {
    expect(lockfilePackageNames(LOCKFILE).filter(npmNameIsForbidden)).toEqual([]);
  });

  it('in Cargo.toml or, transitively, Cargo.lock', () => {
    expect(cargoDependencyNames(CARGO_TOML).filter(crateNameIsForbidden)).toEqual([]);
    expect(cargoLockPackageNames(CARGO_LOCK).filter(crateNameIsForbidden)).toEqual([]);
  });
});
