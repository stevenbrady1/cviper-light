/**
 * The checks the release gate reads are never cancelled on main.
 *
 * ci.yml and smoke.yml produce the checks `checkCiGate.ts` requires before a
 * release or a Store package is built. Both used `cancel-in-progress: true`
 * over `group: <workflow>-${{ github.ref }}`, so two merges to main in quick
 * succession cancelled the first commit's runs. Tag that first commit and the
 * gate reads `cancelled`, refuses, and the release waits for a manual re-run.
 * The gate fails safe, but on launch day that is a stall nobody needs.
 *
 * Cancelling stays on for branches and PRs, where it saves runner time and a
 * cancelled run gates nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const GATE_SOURCES = ['ci.yml', 'smoke.yml'];
const SPARES_MAIN = "${{ github.ref != 'refs/heads/main' }}";

const withoutComments = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1').trimEnd())
    .join('\n');

/** The workflow-level `cancel-in-progress:` value, or undefined if none is set. */
export function cancelInProgress(workflow: string): string | undefined {
  // Blank and comment-only lines dropped, so a comment inside the block does
  // not end it early.
  const text = withoutComments(workflow)
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
  const block = /^concurrency:\s*\n((?:[ \t]+.*\n?)*)/m.exec(text)?.[1] ?? '';
  return /^\s+cancel-in-progress:\s*(.+?)\s*$/m.exec(block)?.[1]?.replace(/^['"]|['"]$/g, '');
}

/** True when the setting can never cancel a run on main. */
export function sparesMain(value: string | undefined): boolean {
  return value === undefined || value === 'false' || value === SPARES_MAIN;
}

describe('runs the release gate reads are never cancelled on main', () => {
  for (const file of GATE_SOURCES) {
    it(`${file}`, () => {
      const workflow = readFileSync(join(REPO_ROOT, '.github', 'workflows', file), 'utf8');
      expect(cancelInProgress(workflow), `${file} cancel-in-progress`).toBe(SPARES_MAIN);
      expect(sparesMain(cancelInProgress(workflow))).toBe(true);
    });
  }
});

describe('the guard itself', () => {
  it('negative: a plain true cancels on main', () => {
    const wf = 'concurrency:\n  group: ci-x\n  cancel-in-progress: true\n\njobs:\n';
    expect(sparesMain(cancelInProgress(wf))).toBe(false);
  });

  it('negative: an expression that does not name main is not trusted', () => {
    expect(sparesMain("${{ github.event_name == 'pull_request' }}")).toBe(false);
  });

  it('boundary: no concurrency block, or false, spares main', () => {
    expect(sparesMain(cancelInProgress('jobs:\n  a:\n'))).toBe(true);
    expect(sparesMain('false')).toBe(true);
  });

  it('boundary: a job-level setting is not mistaken for the workflow one', () => {
    const wf = 'jobs:\n  a:\n    concurrency:\n      cancel-in-progress: true\n';
    expect(cancelInProgress(wf)).toBeUndefined();
  });

  it('boundary: a comment inside the block does not hide the setting', () => {
    const wf = 'concurrency:\n  group: ci-x\n  # why\n  cancel-in-progress: true\n';
    expect(cancelInProgress(wf)).toBe('true');
  });

  it('happy: the main-sparing expression is read whole', () => {
    const wf = `concurrency:\n  group: ci-x\n  cancel-in-progress: ${SPARES_MAIN}\n`;
    expect(cancelInProgress(wf)).toBe(SPARES_MAIN);
  });
});
