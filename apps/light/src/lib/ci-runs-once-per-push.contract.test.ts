/**
 * L-214 (#202) — one push to a pull request starts each workflow ONCE.
 *
 * `ci.yml` listened to `push` on every branch AND to `pull_request`. A push to
 * a branch with an open pull request is both events, so every job — the
 * Windows `verify` job included — ran twice: CI #974 (push) and #975
 * (pull_request) for the one commit c20a569, in different concurrency groups
 * (`refs/heads/<branch>` and `refs/pull/<n>/merge`), so neither cancelled the
 * other. Half of every CI minute on a pull request was a copy.
 *
 * `smoke.yml` and `ios.yml` already did it right: `push` on `main` only, and
 * `pull_request` for everything else. This holds every workflow to that.
 * Pushes to `main` still run, which is what the release gate reads.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const WORKFLOWS = join(REPO_ROOT, '.github', 'workflows');

/** The lines of the top-level `on:` block, without the `on:` line itself. */
function onBlock(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^on:\s*$/u.test(line));
  if (start === -1) return [];
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line)) break;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    block.push(line);
  }
  return block;
}

/**
 * True when the workflow runs on `pull_request` AND on `push` to any branch —
 * the shape that runs every job twice for one push to a pull request.
 */
export function runsTwicePerPullRequestPush(text: string): boolean {
  const block = onBlock(text);
  const triggerAt = (name: string) => block.findIndex((line) => line.trim() === `${name}:`);
  const push = triggerAt('push');
  if (push === -1 || triggerAt('pull_request') === -1) return false;

  const indent = (line: string) => line.length - line.trimStart().length;
  const own = indent(block[push] ?? '');
  const settings: string[] = [];
  for (const line of block.slice(push + 1)) {
    if (indent(line) <= own) break;
    settings.push(line.trim());
  }
  const branchesAt = settings.findIndex((line) => line.startsWith('branches:'));
  if (branchesAt === -1) {
    // No branch filter: every branch — unless the push trigger is for tags only.
    return !settings.some((line) => line.startsWith('tags:'));
  }
  // `branches: [main]`, or `branches:` followed by `- main` lines.
  const inline = /^branches:\s*\[(.*)\]\s*$/u.exec(settings[branchesAt] ?? '');
  const names = inline
    ? (inline[1] ?? '').split(',').map((name) => name.trim().replace(/^['"]|['"]$/gu, ''))
    : settings
        .slice(branchesAt + 1)
        .filter((line) => line.startsWith('- '))
        .map((line) =>
          line
            .slice(2)
            .trim()
            .replace(/^['"]|['"]$/gu, ''),
        );
  return names.length === 0 || names.some((name) => name !== 'main');
}

describe('one push to a pull request runs each workflow once (L-214)', () => {
  it('no workflow listens to push on every branch as well as to pull_request', () => {
    const files = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/u.test(name));
    expect(files).toContain('ci.yml');
    const twice = files.filter((name) =>
      runsTwicePerPullRequestPush(readFileSync(join(WORKFLOWS, name), 'utf8')),
    );
    expect(twice).toEqual([]);
  });
});

describe('runsTwicePerPullRequestPush', () => {
  it('negative: push on every branch plus pull_request', () => {
    expect(runsTwicePerPullRequestPush('on:\n  push:\n  pull_request:\n\njobs:\n')).toBe(true);
  });

  it('boundary: push on main only, written either way, is once', () => {
    expect(
      runsTwicePerPullRequestPush('on:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n'),
    ).toBe(false);
    expect(
      runsTwicePerPullRequestPush(
        'on:\n  push:\n    branches:\n      - main\n  pull_request:\njobs:\n',
      ),
    ).toBe(false);
  });

  it('boundary: a workflow on only one of the two, or on tags, is not this problem', () => {
    expect(runsTwicePerPullRequestPush('on:\n  pull_request:\njobs:\n')).toBe(false);
    expect(runsTwicePerPullRequestPush("on:\n  push:\n    tags:\n      - 'v*'\njobs:\n")).toBe(
      false,
    );
    expect(runsTwicePerPullRequestPush('on:\n  workflow_dispatch:\njobs:\n')).toBe(false);
  });
});
