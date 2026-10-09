/**
 * The release CI contract (L-221): nothing in `release.yml` bundles a release
 * until the tagged commit has passed CI.
 *
 * `bundle` used to run on any pushed `light-v*` tag with no `needs:` at all, so
 * a tag pushed at a red commit produced a signed draft. A workflow cannot
 * `needs:` a job in another workflow, so the gate is a job of its own that runs
 * `checkCiGate.ts` against the check-runs API — and every bundling job must
 * need it.
 *
 * A FORBID-LIST, in the house style: it names what must be absent — a bundling
 * job that does not wait for the gate, or a gate that is allowed to fail — and
 * finds bundling jobs by their action, not their name, so a new or renamed
 * bundler is in scope the day it is written.
 *
 * Lexical on purpose, like the other workflow guards: no YAML parser, `#`
 * comments stripped first so the prose explaining the gate cannot satisfy it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REQUIRED_CHECKS } from '../release/ciGate.ts';
import { REPO_ROOT } from './repo-scan.ts';

const WORKFLOWS = join(REPO_ROOT, '.github', 'workflows');
const read = (file: string): string => readFileSync(join(WORKFLOWS, file), 'utf8');

const BUNDLES = /uses:\s*tauri-apps\/tauri-action@/;
const RUNS_THE_GATE = /node\s+apps\/light\/src\/release\/checkCiGate\.ts/;

interface Job {
  readonly id: string;
  readonly text: string;
}

/** Strip `#` comments that start a line or follow whitespace. Quoted `#` survives. */
function withoutComments(workflow: string): string {
  return workflow
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1').trimEnd())
    .join('\n');
}

/** The jobs of a workflow as blocks of text, keyed by their id. */
function jobsOf(workflow: string): Job[] {
  const jobs: Array<{ id: string; lines: string[] }> = [];
  let inJobs = false;
  let indent = -1;
  for (const line of withoutComments(workflow).split('\n')) {
    if (!inJobs) {
      inJobs = /^jobs:\s*$/.test(line);
      continue;
    }
    if (line.trim() === '') continue;
    const depth = line.length - line.trimStart().length;
    if (depth === 0) break;
    const header = /^(\s+)([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header && (indent === -1 || depth === indent)) {
      indent = depth;
      jobs.push({ id: header[2] ?? '', lines: [line] });
      continue;
    }
    jobs.at(-1)?.lines.push(line);
  }
  return jobs.map((job) => ({ id: job.id, text: job.lines.join('\n') }));
}

/** The ids in a job's `needs:`, written inline (`needs: a` / `needs: [a, b]`) or as a list. */
function needsOf(jobText: string): string[] {
  const lines = jobText.split('\n');
  const index = lines.findIndex((line) => /^\s+needs:/.test(line));
  if (index === -1) return [];
  const inline = (lines[index] ?? '').replace(/^\s+needs:\s*/, '').trim();
  if (inline !== '') {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((id) => id.trim().replace(/^['"]|['"]$/g, ''))
      .filter((id) => id !== '');
  }
  const listed: string[] = [];
  for (const line of lines.slice(index + 1)) {
    const item = /^\s+-\s*['"]?([A-Za-z0-9_-]+)['"]?\s*$/.exec(line);
    if (!item) break;
    listed.push(item[1] ?? '');
  }
  return listed;
}

/** Every way a workflow could bundle a release that CI never passed. */
export function releaseGateOffences(workflow: string): string[] {
  const jobs = jobsOf(workflow);
  const gates = new Set(jobs.filter((job) => RUNS_THE_GATE.test(job.text)).map((job) => job.id));
  const offences: string[] = [];

  for (const job of jobs.filter((candidate) => BUNDLES.test(candidate.text))) {
    if (!needsOf(job.text).some((id) => gates.has(id))) {
      offences.push(
        `the "${job.id}" job bundles a release without needing a job that runs checkCiGate.ts, ` +
          'so a tag pushed at a red commit still produces a signed draft.',
      );
    }
  }
  for (const job of jobs.filter((candidate) => gates.has(candidate.id))) {
    if (/continue-on-error/.test(job.text)) {
      offences.push(
        `the "${job.id}" gate sets continue-on-error, which turns its refusal into a green tick ` +
          'and lets the bundle through.',
      );
    }
  }
  return offences;
}

/** The names GitHub shows for a workflow's jobs: an explicit `name:`, else the id. */
function checkNamesOf(workflow: string): string[] {
  return jobsOf(workflow).map((job) => {
    const [header = '', ...body] = job.text.split('\n');
    const keyIndent = header.length - header.trimStart().length + 2;
    const named = body
      .map((line) => new RegExp(String.raw`^\s{${keyIndent}}name:\s*(.+)$`).exec(line)?.[1])
      .find((name) => name !== undefined);
    return (named ?? job.id).trim().replace(/^['"]|['"]$/g, '');
  });
}

describe('the premise: the release workflow has a bundler to hold', () => {
  it('finds at least one job that bundles', () => {
    expect(jobsOf(read('release.yml')).some((job) => BUNDLES.test(job.text))).toBe(true);
  });
});

describe('a release waits for CI', () => {
  it('release.yml is clean', () => {
    expect(releaseGateOffences(read('release.yml'))).toEqual([]);
  });

  it('every check the gate requires is a real job on a push to main', () => {
    const names = [...checkNamesOf(read('ci.yml')), ...checkNamesOf(read('smoke.yml'))];
    expect(REQUIRED_CHECKS.filter((required) => !names.includes(required))).toEqual([]);
    for (const file of ['ci.yml', 'smoke.yml']) {
      expect(withoutComments(read(file)), `${file} must run on a push to main`).toMatch(
        /^on:[\s\S]*?^\s+push:/m,
      );
    }
  });
});

const GATE = `
  ci-passed:
    runs-on: ubuntu-latest
    steps:
      - run: node apps/light/src/release/checkCiGate.ts`;
const BUNDLER = (needs: string): string => `
  bundle:
${needs}    runs-on: windows-latest
    steps:
      - uses: tauri-apps/tauri-action@v0`;

describe('the detector can actually fail', () => {
  it('flags a bundler with no needs at all', () => {
    expect(releaseGateOffences(`jobs:${GATE}${BUNDLER('')}`)).toHaveLength(1);
  });

  it('flags a bundler that needs some other job', () => {
    const workflow = `jobs:${GATE}${BUNDLER('    needs: refuse-a-bare-dispatch\n')}`;
    expect(releaseGateOffences(workflow)).toHaveLength(1);
  });

  it('flags a gate that is only mentioned in a comment', () => {
    const commented = `jobs:
  ci-passed:
    runs-on: ubuntu-latest
    steps:
      - run: echo skip  # node apps/light/src/release/checkCiGate.ts${BUNDLER('    needs: ci-passed\n')}`;
    expect(releaseGateOffences(commented)).toHaveLength(1);
  });

  it('flags a gate allowed to fail', () => {
    const lenient = GATE.replace('runs-on', 'continue-on-error: true\n    runs-on');
    expect(releaseGateOffences(`jobs:${lenient}${BUNDLER('    needs: ci-passed\n')}`)).toHaveLength(
      1,
    );
  });
});

describe('a correctly gated workflow walks through', () => {
  it('accepts needs written inline, as a flow list, or as a block list', () => {
    for (const needs of [
      '    needs: ci-passed\n',
      '    needs: [ci-passed, other]\n',
      '    needs:\n      - other\n      - ci-passed\n',
    ]) {
      expect(releaseGateOffences(`jobs:${GATE}${BUNDLER(needs)}`)).toEqual([]);
    }
  });

  it('boundary: a workflow with no bundler has nothing to say', () => {
    expect(releaseGateOffences(`jobs:${GATE}`)).toEqual([]);
    expect(releaseGateOffences('')).toEqual([]);
  });
});
