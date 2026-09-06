/**
 * The iOS-target contract (L-80): the things that would silently break the
 * iPhone build while leaving every desktop check green.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `ci.yml` runs on Windows and `cargo check`s the desktop target. Nothing in it
 * would notice the updater plugin becoming an unconditional dependency, or its
 * permission drifting back into the all-platform capability, or the Mac
 * workflow losing its `cargo check` step — and each of those is an iOS build
 * that fails only on the Mac runner, or only in Xcode, weeks later. These are
 * forbid-list assertions (LESSON-033) over the three files that decide it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, walk } from './repo-scan.ts';

const CARGO_TOML = readFileSync(join(REPO_ROOT, 'apps/light/src-tauri/Cargo.toml'), 'utf8');
const LIB_RS = readFileSync(join(REPO_ROOT, 'apps/light/src-tauri/src/lib.rs'), 'utf8');
const IOS_WORKFLOW = readFileSync(join(REPO_ROOT, '.github/workflows/ios.yml'), 'utf8');
const CAPABILITY_FILES = walk(join(REPO_ROOT, 'apps/light/src-tauri/capabilities'), {
  extensions: ['.json'],
});

interface Capability {
  readonly identifier?: string;
  readonly platforms?: readonly string[];
  readonly permissions?: readonly (string | { identifier?: string })[];
}

function readCapability(file: string): Capability {
  return JSON.parse(readFileSync(file, 'utf8')) as Capability;
}

function permissionNames(capability: Capability): string[] {
  return (capability.permissions ?? []).map((permission) =>
    typeof permission === 'string' ? permission : (permission.identifier ?? ''),
  );
}

/** Does this capability apply on iOS? No `platforms` means every platform. */
function appliesOnIos(capability: Capability): boolean {
  return capability.platforms === undefined || capability.platforms.includes('iOS');
}

/** The `[dependencies]` table only — not any `[target.…]` table. */
function unconditionalDependencies(cargoToml: string): string {
  const start = cargoToml.indexOf('\n[dependencies]');
  const rest = cargoToml.slice(start + 1);
  const end = rest.indexOf('\n[');
  return end === -1 ? rest : rest.slice(0, end);
}

describe('the updater is desktop-only in every place that decides it', () => {
  it('is not an unconditional Cargo dependency', () => {
    expect(unconditionalDependencies(CARGO_TOML)).not.toMatch(/^\s*tauri-plugin-updater\b/m);
  });

  it('is registered only behind cfg(desktop) in lib.rs', () => {
    const registrations = [...LIB_RS.matchAll(/tauri_plugin_updater::/g)];
    expect(registrations.length).toBeGreaterThan(0);
    for (const registration of registrations) {
      const before = LIB_RS.slice(0, registration.index);
      const lastCfg = before.lastIndexOf('#[cfg(desktop)]');
      const lastStatementEnd = before.lastIndexOf(';');
      expect(lastCfg, 'a `.plugin(tauri_plugin_updater…)` without #[cfg(desktop)]').toBeGreaterThan(
        lastStatementEnd,
      );
    }
  });

  it('has no capability that names an updater permission on iOS', () => {
    expect(CAPABILITY_FILES.length).toBeGreaterThan(1);
    const offenders = CAPABILITY_FILES.filter((file) => {
      const capability = readCapability(file);
      return (
        appliesOnIos(capability) &&
        permissionNames(capability).some((name) => name.startsWith('updater:'))
      );
    });
    expect(
      offenders,
      'An updater permission in a capability that applies on iOS fails the iOS build: the plugin is not compiled in there.',
    ).toEqual([]);
  });

  it('still grants the updater on the desktop (anti-inert)', () => {
    const desktop = CAPABILITY_FILES.map(readCapability).filter(
      (capability) => !appliesOnIos(capability),
    );
    expect(
      desktop.some((capability) => permissionNames(capability).includes('updater:default')),
    ).toBe(true);
  });
});

describe('the Mac workflow checks the phone targets', () => {
  it('cargo checks both iOS targets and builds an unsigned simulator app', () => {
    expect(IOS_WORKFLOW).toMatch(/cargo check .*--target aarch64-apple-ios\b/);
    expect(IOS_WORKFLOW).toMatch(/cargo check .*--target aarch64-apple-ios-sim\b/);
    expect(IOS_WORKFLOW).toMatch(/runs-on: macos-/);
    expect(IOS_WORKFLOW).toMatch(/CODE_SIGNING_ALLOWED=NO/);
  });

  it('never carries a certificate, profile or team into the build', () => {
    // A forbid-list: the unsigned build is the promise that no secret is
    // needed to prove the app compiles for a phone.
    expect(IOS_WORKFLOW).not.toMatch(/secrets\.\w*(CERT|PROFILE|TEAM|APPLE_ID|PASSWORD)/i);
    expect(IOS_WORKFLOW).not.toMatch(/export-method/);
  });

  it('has a permissions block that keeps contents: read', () => {
    expect(IOS_WORKFLOW).toMatch(/^permissions:\n\s+contents: read/m);
  });
});
