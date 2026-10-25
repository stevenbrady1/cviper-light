/**
 * Every workflow builds with ONE pinned Rust version, the one in
 * rust-toolchain.toml at the repo root.
 *
 * The workflows said `toolchain: stable`. A new stable rustc ships every six
 * weeks, so the release binary changed compiler on a date nobody chose, and a
 * new lint or resolver change could turn `cargo test` red on the day of a
 * Store build. A pinned version moves only in a PR that says so, with CI
 * green on it first.
 *
 * The file is the source of truth: cargo and rustup read it locally too, so a
 * contributor builds with what CI builds with. It lives at the repo root
 * because rustup searches from the current directory upwards, and
 * `pnpm cargo:test` runs from the root with --manifest-path.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const WORKFLOWS = join(REPO_ROOT, '.github', 'workflows');
const TOOLCHAIN_FILE = join(REPO_ROOT, 'rust-toolchain.toml');

const withoutComments = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1').trimEnd())
    .join('\n');

/** The `channel` in a rust-toolchain.toml, when it is an exact x.y.z version. */
export function pinnedChannel(toml: string): string | undefined {
  const channel = /^\s*channel\s*=\s*"([^"]*)"\s*$/m.exec(withoutComments(toml))?.[1];
  return channel !== undefined && /^\d+\.\d+\.\d+$/.test(channel) ? channel : undefined;
}

/** Every `toolchain:` input a workflow passes to dtolnay/rust-toolchain. */
export function toolchainInputs(workflow: string): string[] {
  const lines = withoutComments(workflow).split('\n');
  const found: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(?:-\s*)?uses:\s*['"]?dtolnay\/rust-toolchain@/.test(line)) return;
    const indent = line.length - line.trimStart().length;
    for (const next of lines.slice(index + 1)) {
      if (next.trim() === '') continue;
      const depth = next.length - next.trimStart().length;
      if (depth <= indent || /^\s*-\s/.test(next)) break;
      const value = /^\s*toolchain:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(next)?.[1];
      if (value !== undefined) found.push(value);
    }
  });
  return found;
}

describe('Rust is pinned to one version everywhere', () => {
  const channel = pinnedChannel(readFileSync(TOOLCHAIN_FILE, 'utf8'));

  it('rust-toolchain.toml pins an exact x.y.z version', () => {
    expect(channel).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('every workflow that installs Rust installs that version', () => {
    const offences: string[] = [];
    let seen = 0;
    for (const file of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
      for (const value of toolchainInputs(readFileSync(join(WORKFLOWS, file), 'utf8'))) {
        seen += 1;
        if (value !== channel) offences.push(`${file}: toolchain: ${value}`);
      }
    }
    // The premise: a renamed action must not make this vacuous.
    expect(seen).toBeGreaterThan(0);
    expect(offences).toEqual([]);
  });
});

describe('the guard itself', () => {
  it('negative: a moving channel is not a pin', () => {
    expect(pinnedChannel('[toolchain]\nchannel = "stable"\n')).toBeUndefined();
    expect(pinnedChannel('[toolchain]\nchannel = "1.99"\n')).toBeUndefined();
  });

  it('boundary: a commented-out channel is not read', () => {
    expect(pinnedChannel('[toolchain]\n# channel = "1.99.1"\n')).toBeUndefined();
  });

  it('happy: an exact version is read', () => {
    expect(pinnedChannel('[toolchain]\nchannel = "1.99.1"\n')).toBe('1.99.1');
  });

  it('reads the toolchain input of each rust-toolchain step, and only those', () => {
    const wf = [
      'steps:',
      '  - uses: dtolnay/rust-toolchain@abc # stable',
      '    with:',
      '      toolchain: stable',
      '      targets: aarch64-apple-ios',
      '  - uses: other/action@def',
      '    with:',
      '      toolchain: nightly',
    ].join('\n');
    expect(toolchainInputs(wf)).toEqual(['stable']);
  });
});
