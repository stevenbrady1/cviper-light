/**
 * Every workflow job sets `timeout-minutes`.
 *
 * GitHub's default is 360 minutes. A corepack prompt with no terminal, a hung
 * `notarytool`, or a smoke test waiting on a window that never draws then holds
 * a runner for six hours before anyone hears about it, and on a release day
 * that is six hours of not knowing. Each job names its own ceiling instead,
 * set well above how long it normally takes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const WORKFLOWS = join(REPO_ROOT, '.github', 'workflows');

const withoutComments = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1').trimEnd())
    .filter((line) => line.trim() !== '')
    .join('\n');

/** Ids of jobs with neither `timeout-minutes` nor a reusable-workflow `uses:`. */
export function jobsWithoutTimeout(workflow: string): string[] {
  const lines = withoutComments(workflow).split('\n');
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (start === -1) return [];
  const jobs: Array<{ id: string; body: string[] }> = [];
  let jobIndent = -1;
  for (const line of lines.slice(start + 1)) {
    const depth = line.length - line.trimStart().length;
    if (depth === 0) break;
    const header = /^(\s+)([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header && (jobIndent === -1 || depth === jobIndent)) {
      jobIndent = depth;
      jobs.push({ id: header[2] ?? '', body: [] });
      continue;
    }
    jobs.at(-1)?.body.push(line);
  }
  return jobs
    .filter(({ body }) => {
      const keyIndent = jobIndent + 2;
      const keys = body
        .filter((line) => line.length - line.trimStart().length === keyIndent)
        .map((line) => line.trim());
      const timed = keys.some((key) => /^timeout-minutes:\s*\d+\s*$/.test(key));
      const reusable = keys.some((key) => /^uses:\s*\S/.test(key));
      return !timed && !reusable;
    })
    .map(({ id }) => id);
}

describe('every workflow job names its own timeout', () => {
  const files = readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/.test(file));

  it('finds workflows to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(file, () => {
      expect(jobsWithoutTimeout(readFileSync(join(WORKFLOWS, file), 'utf8'))).toEqual([]);
    });
  }
});

describe('the guard itself', () => {
  it('negative: a job with no timeout is named', () => {
    const wf = 'jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n';
    expect(jobsWithoutTimeout(wf)).toEqual(['build']);
  });

  it('negative: a timeout on a STEP does not cover the job', () => {
    const wf =
      'jobs:\n  build:\n    runs-on: x\n    steps:\n      - run: echo\n        timeout-minutes: 5\n';
    expect(jobsWithoutTimeout(wf)).toEqual(['build']);
  });

  it('boundary: a commented-out timeout does not count', () => {
    const wf = 'jobs:\n  build:\n    # timeout-minutes: 5\n    runs-on: x\n';
    expect(jobsWithoutTimeout(wf)).toEqual(['build']);
  });

  it('happy: a timed job and a reusable-workflow job pass', () => {
    const wf =
      'jobs:\n  build:\n    runs-on: x\n    timeout-minutes: 30\n  call:\n    uses: ./.github/workflows/other.yml\n';
    expect(jobsWithoutTimeout(wf)).toEqual([]);
  });
});
