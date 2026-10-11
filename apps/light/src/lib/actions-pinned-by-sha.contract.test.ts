/**
 * The supply-chain contract (L-222): every third-party GitHub Action is pinned
 * to a full commit SHA, and Dependabot keeps those pins — and the npm and cargo
 * dependencies — current.
 *
 * A tag such as `tauri-apps/tauri-action@v0` is a pointer its owner can move.
 * The release job hands that action the updater signing key, and a key that
 * leaks cannot be revoked (RELEASE-SIGNING.md §1): every installed copy would
 * accept whatever it signs. The tj-actions/changed-files incident was exactly
 * a retagged action reading secrets out of CI logs. A 40-character SHA cannot
 * be moved. The tag stays beside it as a comment, so a reader — and Dependabot
 * — still sees which release it is.
 *
 * Forbid-list shapes, read lexically with `#` comments stripped first:
 *   * a `uses:` that names a remote action by anything but a 40-hex SHA;
 *   * `dtolnay/rust-toolchain` pinned by SHA with no `toolchain:` input — that
 *     action reads the toolchain from its BRANCH name, so a SHA pin without
 *     the input fails at run time;
 *   * no `.github/dependabot.yml`, or one that does not cover all three of
 *     `github-actions`, `npm` and `cargo`. Pins nobody updates rot into the
 *     known-vulnerable versions the audit job exists to catch.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const WORKFLOWS = join(REPO_ROOT, '.github', 'workflows');
const DEPENDABOT = join(REPO_ROOT, '.github', 'dependabot.yml');

function withoutComments(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1').trimEnd())
    .join('\n');
}

/** Every way a workflow names an action that can move under it. */
export function pinOffences(workflow: string): string[] {
  const offences: string[] = [];
  const lines = withoutComments(workflow).split('\n');

  lines.forEach((line, index) => {
    const used = /^\s*(?:-\s*)?uses:\s*['"]?([^\s'"]+)['"]?\s*$/.exec(line)?.[1];
    if (used === undefined || used.startsWith('./') || used.startsWith('docker://')) return;

    const [action, ref = ''] = used.split('@');
    if (!/^[0-9a-f]{40}$/.test(ref)) {
      offences.push(`\`${used}\` is not pinned to a full commit SHA`);
      return;
    }

    if (action === 'dtolnay/rust-toolchain') {
      const indent = line.length - line.trimStart().length;
      const step: string[] = [];
      for (const next of lines.slice(index + 1)) {
        if (next.trim() === '') continue;
        const depth = next.length - next.trimStart().length;
        if (depth <= indent || /^\s*-\s/.test(next)) break;
        step.push(next);
      }
      if (!step.some((next) => /^\s*toolchain:\s*\S/.test(next))) {
        offences.push(
          '`dtolnay/rust-toolchain` pinned by SHA needs a `toolchain:` input: it reads the ' +
            'toolchain from its branch name otherwise',
        );
      }
    }
  });
  return offences;
}

/** The ecosystems a Dependabot config updates. */
function ecosystemsOf(config: string): string[] {
  return [...withoutComments(config).matchAll(/package-ecosystem:\s*['"]?([\w-]+)/g)].map(
    (match) => match[1] ?? '',
  );
}

const workflowFiles = readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/.test(file));

describe('every GitHub Action is pinned to a commit SHA', () => {
  it('there are workflows to read', () => {
    expect(workflowFiles.length).toBeGreaterThan(3);
  });

  for (const file of workflowFiles) {
    it(`${file} is clean`, () => {
      expect(pinOffences(readFileSync(join(WORKFLOWS, file), 'utf8'))).toEqual([]);
    });
  }
});

describe('Dependabot keeps the pins and dependencies current', () => {
  it('covers GitHub Actions, npm and cargo', () => {
    expect(existsSync(DEPENDABOT)).toBe(true);
    const ecosystems = ecosystemsOf(readFileSync(DEPENDABOT, 'utf8'));
    expect(ecosystems).toEqual(expect.arrayContaining(['github-actions', 'npm', 'cargo']));
  });
});

const SHA = 'a'.repeat(40);

describe('the detector can actually fail', () => {
  it('flags a tag, a branch and a short SHA', () => {
    const workflow = [
      '      - uses: actions/checkout@v5',
      '      - uses: dtolnay/rust-toolchain@stable',
      '      - uses: Swatinem/rust-cache@6323deb',
    ].join('\n');
    expect(pinOffences(workflow)).toHaveLength(3);
  });

  it('flags a SHA hidden behind a comment that is the real ref', () => {
    expect(pinOffences(`      - uses: actions/checkout@v5 # ${SHA}`)).toHaveLength(1);
  });

  it('flags rust-toolchain pinned by SHA with no toolchain input', () => {
    const workflow = [
      `      - uses: dtolnay/rust-toolchain@${SHA}`,
      '        with:',
      '          targets: aarch64-apple-ios',
      '      - run: cargo check',
    ].join('\n');
    expect(pinOffences(workflow)).toHaveLength(1);
  });

  it('a Dependabot config missing an ecosystem is caught', () => {
    const config = 'updates:\n  - package-ecosystem: npm\n  - package-ecosystem: cargo\n';
    expect(ecosystemsOf(config)).not.toContain('github-actions');
  });
});

describe('a correctly pinned workflow walks through', () => {
  it('accepts a SHA with the tag as a comment, quoted or not', () => {
    expect(pinOffences(`      - uses: actions/checkout@${SHA} # v5`)).toEqual([]);
    expect(pinOffences(`        uses: 'tauri-apps/tauri-action@${SHA}'`)).toEqual([]);
  });

  it('accepts rust-toolchain with a toolchain input', () => {
    const workflow = [
      `      - uses: dtolnay/rust-toolchain@${SHA} # stable`,
      '        with:',
      '          toolchain: stable',
      '          targets: aarch64-apple-ios',
    ].join('\n');
    expect(pinOffences(workflow)).toEqual([]);
  });

  it('boundary: local and docker actions are not remote pins', () => {
    expect(
      pinOffences('      - uses: ./.github/actions/setup\n      - uses: docker://alpine:3'),
    ).toEqual([]);
  });
});
