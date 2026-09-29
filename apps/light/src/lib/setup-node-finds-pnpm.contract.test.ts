/**
 * The setup-node contract (L-178): no `actions/setup-node` step may go looking
 * for pnpm in a job that never installed it.
 *
 * setup-node v5 caches automatically from the root `package.json`'s
 * `packageManager` field, which here says pnpm. So a job that sets up Node
 * WITHOUT first running `corepack enable pnpm` dies inside setup-node with
 * "Unable to locate executable file: pnpm" — before a single line of the job's
 * own work runs. That is exactly how the first real run of `release-admin.yml`
 * failed: its script needs only Node, so it skipped corepack, and setup-node
 * went looking for pnpm anyway.
 *
 * A FORBID-LIST (LESSON-033): a setup-node step must not appear in a job with
 * no `corepack enable pnpm` before it, unless it opts out with
 * `package-manager-cache: false`. Comments are stripped first.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const WORKFLOW_DIRECTORY = join(REPO_ROOT, '.github/workflows');

/** ci, ios, monorepo-split, msix, release, release-admin, smoke. A floor, not a count. */
const WORKFLOW_FLOOR = 6;

function stripComments(text: string): string[] {
  return text.split('\n').map((line) => line.replace(/(^|\s)#.*$/, '$1').trimEnd());
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Each job's lines, keyed by job id. */
function jobsOf(text: string): Map<string, string[]> {
  const lines = stripComments(text);
  const jobs = new Map<string, string[]>();
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (start === -1) return jobs;
  let current: string[] | null = null;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    if (indentOf(line) === 0) break;
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = [];
      jobs.set(header[1] ?? '', current);
    } else {
      current?.push(line);
    }
  }
  return jobs;
}

export interface SetupNodeCount {
  readonly steps: number;
  readonly offences: string[];
}

export function setupNodeOffences(name: string, text: string): SetupNodeCount {
  let steps = 0;
  const offences: string[] = [];
  for (const [job, lines] of jobsOf(text)) {
    lines.forEach((line, index) => {
      if (!/uses:\s*actions\/setup-node@/.test(line)) return;
      steps += 1;
      const stepIndent = indentOf(line);
      const rest = lines.slice(index + 1);
      const end = rest.findIndex((next) => indentOf(next) < stepIndent || /^\s*-\s/.test(next));
      const withBlock = end === -1 ? rest : rest.slice(0, end);
      const optsOut = withBlock.some((next) => /package-manager-cache:\s*false\s*$/.test(next));
      const pnpmFirst = lines.slice(0, index).some((prior) => /corepack enable pnpm/.test(prior));
      if (!optsOut && !pnpmFirst) {
        offences.push(
          `${name} job '${job}': setup-node runs with no \`corepack enable pnpm\` before it and ` +
            'no `package-manager-cache: false`, so it will look for a pnpm that is not there.',
        );
      }
    });
  }
  return { steps, offences };
}

describe('every setup-node step can find pnpm or does not look for it', () => {
  const names = readdirSync(WORKFLOW_DIRECTORY).filter((name) => /\.ya?ml$/.test(name));
  const results = names.map((name) =>
    setupNodeOffences(name, readFileSync(join(WORKFLOW_DIRECTORY, name), 'utf8')),
  );

  it('reads the real workflows and finds setup-node steps in them (anti-inert)', () => {
    expect(names.length).toBeGreaterThanOrEqual(WORKFLOW_FLOOR);
    expect(names).toContain('release-admin.yml');
    expect(results.reduce((total, result) => total + result.steps, 0)).toBeGreaterThanOrEqual(3);
  });

  it('has no setup-node step that will fail looking for pnpm', () => {
    expect(results.flatMap((result) => result.offences)).toEqual([]);
  });
});

describe('the detector', () => {
  const job = (steps: string): string =>
    `on:\n  workflow_dispatch:\njobs:\n  tidy:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;

  it('fails a bare setup-node, the shape that broke release-admin.yml', () => {
    const text = job(
      '      - uses: actions/checkout@v5\n      - uses: actions/setup-node@v5\n        with:\n          node-version: 22\n      - run: node x.ts\n',
    );
    expect(setupNodeOffences('x.yml', text).offences).toHaveLength(1);
  });

  it('passes when corepack enables pnpm first', () => {
    const text = job(
      '      - run: corepack enable pnpm\n      - uses: actions/setup-node@v5\n        with:\n          node-version: 22\n          cache: pnpm\n',
    );
    expect(setupNodeOffences('x.yml', text)).toEqual({ steps: 1, offences: [] });
  });

  it('passes when the step opts out of package-manager caching', () => {
    const text = job(
      '      - uses: actions/setup-node@v5\n        with:\n          node-version: 22\n          package-manager-cache: false\n      - run: node x.ts\n',
    );
    expect(setupNodeOffences('x.yml', text)).toEqual({ steps: 1, offences: [] });
  });

  it('does not count corepack in a DIFFERENT job, or after the step', () => {
    const text =
      'on:\n  workflow_dispatch:\njobs:\n  one:\n    steps:\n      - run: corepack enable pnpm\n' +
      '  two:\n    steps:\n      - uses: actions/setup-node@v5\n        with:\n          node-version: 22\n      - run: corepack enable pnpm\n';
    expect(setupNodeOffences('x.yml', text).offences).toHaveLength(1);
  });

  it('does not read an opt-out from the NEXT step', () => {
    const text = job(
      '      - uses: actions/setup-node@v5\n        with:\n          node-version: 22\n      - uses: other/action@v1\n        with:\n          package-manager-cache: false\n',
    );
    expect(setupNodeOffences('x.yml', text).offences).toHaveLength(1);
  });

  it('ignores a commented-out opt-out', () => {
    const text = job(
      '      - uses: actions/setup-node@v5\n        with:\n          node-version: 22\n          # package-manager-cache: false\n',
    );
    expect(setupNodeOffences('x.yml', text).offences).toHaveLength(1);
  });
});
