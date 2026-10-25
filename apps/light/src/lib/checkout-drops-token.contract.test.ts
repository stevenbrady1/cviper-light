/**
 * A checkout in a SHIPPING workflow must not leave the job's token on disk.
 *
 * `actions/checkout` writes the job's GITHUB_TOKEN into `.git/config` by
 * default (`persist-credentials: true`). In release.yml that token can write
 * releases, and the `bundle` job then runs every `build.rs`, Vite plugin and
 * `beforeBuildCommand` in the dependency tree. One compromised build
 * dependency could read the token from `.git/config` and replace
 * `CViper-Light-Windows-x64.exe` on the published release - the file
 * cviper.ai's Download button fetches, which carries no Authenticode
 * signature and sits outside the updater manifest's signature check.
 *
 * No step in these workflows runs a git command that needs the token: every
 * release operation is `gh` or tauri-action, which read GH_TOKEN /
 * GITHUB_TOKEN from the environment of that one step. So the token on disk is
 * pure exposure, and `persist-credentials: false` removes it.
 *
 * This is the interim fix. The real one gives `bundle` `contents: read` and
 * moves release creation to a job that builds nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const SHIPPING = ['release.yml', 'msix.yml'];

const withoutComments = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1').trimEnd())
    .join('\n');

/** 1-based line numbers of checkout steps that do not set persist-credentials: false. */
export function checkoutsKeepingTheToken(workflow: string): number[] {
  const lines = withoutComments(workflow).split('\n');
  const offences: number[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(?:-\s*)?uses:\s*['"]?actions\/checkout@/.test(line)) return;
    // The step is everything indented deeper than its `- uses:` line's dash,
    // up to the next line at the same or a shallower depth.
    const stepIndent = line.length - line.trimStart().length;
    let dropsToken = false;
    for (const next of lines.slice(index + 1)) {
      if (next.trim() === '') continue;
      const depth = next.length - next.trimStart().length;
      if (depth <= stepIndent) break;
      if (/^\s*persist-credentials:\s*['"]?false['"]?\s*$/.test(next)) dropsToken = true;
    }
    if (!dropsToken) offences.push(index + 1);
  });
  return offences;
}

describe('shipping workflows check out without persisting the token', () => {
  for (const name of SHIPPING) {
    it(`${name}: every checkout sets persist-credentials: false`, () => {
      const workflow = readFileSync(join(REPO_ROOT, '.github', 'workflows', name), 'utf8');
      expect(workflow).toMatch(/actions\/checkout@/);
      expect(checkoutsKeepingTheToken(workflow)).toEqual([]);
    });
  }
});

describe('the guard itself', () => {
  it('negative: a bare checkout keeps the token', () => {
    const wf = 'steps:\n  - uses: actions/checkout@abc\n  - run: echo hi\n';
    expect(checkoutsKeepingTheToken(wf)).toEqual([2]);
  });

  it('negative: persist-credentials true, or set on a LATER step, does not count', () => {
    const wf = [
      'steps:',
      '  - uses: actions/checkout@abc',
      '    with:',
      '      persist-credentials: true',
      '  - uses: actions/setup-node@def',
      '    with:',
      '      persist-credentials: false',
    ].join('\n');
    expect(checkoutsKeepingTheToken(wf)).toEqual([2]);
  });

  it('boundary: a commented-out setting does not count', () => {
    const wf =
      'steps:\n  - uses: actions/checkout@abc\n    with:\n      # persist-credentials: false\n';
    expect(checkoutsKeepingTheToken(wf)).toEqual([2]);
  });

  it('happy: a checkout with persist-credentials: false passes', () => {
    const wf =
      'steps:\n  - uses: actions/checkout@abc # v7\n    with:\n      persist-credentials: false\n  - run: echo\n';
    expect(checkoutsKeepingTheToken(wf)).toEqual([]);
  });
});
