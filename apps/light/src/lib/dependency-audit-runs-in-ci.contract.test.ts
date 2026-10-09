/**
 * The dependency-audit contract (L-224): CI fails on a high or critical
 * advisory in a dependency that ships.
 *
 * Nothing used to look. `@xmldom/xmldom` 0.8.14, reached through `mammoth`,
 * carried six high advisories with every check green. The audit lives in its
 * own CI job because it needs a network — so, like the other checks outside
 * `pnpm verify`, this test exists to fail if that job disappears or is
 * quietly defanged. A check nobody runs is not a check.
 *
 * Forbid-list shapes, read lexically with `#` comments stripped first:
 *
 *   * no step in ci.yml runs `pnpm audit` at all;
 *   * the audit drops `--prod` (it would fail on dev tooling that never ships,
 *     and the first person to hit that deletes the job) — or drops
 *     `--audit-level high`/`critical` (it would fail on every moderate, same
 *     outcome);
 *   * its failure is swallowed — `|| true`, `|| exit 0`, `continue-on-error`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const CI = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

function withoutComments(workflow: string): string {
  return workflow
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1').trimEnd())
    .join('\n');
}

/** The job blocks of a workflow, as text. */
function jobBlocks(workflow: string): string[] {
  const body = withoutComments(workflow).split(/^jobs:\s*$/m)[1] ?? '';
  return body
    .split(/^(?= {2}[A-Za-z0-9_-]+:\s*$)/m)
    .filter((block) => /^ {2}[A-Za-z0-9_-]+:/.test(block));
}

export function auditOffences(workflow: string): string[] {
  const auditing = jobBlocks(workflow).filter((job) => /pnpm audit\b/.test(job));
  if (auditing.length === 0) {
    return [
      'no job runs `pnpm audit`, so a known-vulnerable dependency ships with every check green.',
    ];
  }

  const offences: string[] = [];
  for (const job of auditing) {
    const name = /^ {2}([A-Za-z0-9_-]+):/.exec(job)?.[1] ?? '?';
    const command = /pnpm audit\b.*$/m.exec(job)?.[0] ?? '';
    if (!/--prod\b/.test(command)) {
      offences.push(`"${name}": the audit is missing --prod, so dev-only tooling can fail it.`);
    }
    if (!/--audit-level[ =](high|critical)\b/.test(command)) {
      offences.push(
        `"${name}": the audit is missing --audit-level high, so every moderate fails it.`,
      );
    }
    if (/\|\|\s*(true|exit 0|:)/.test(command) || /continue-on-error:\s*true/.test(job)) {
      offences.push(`"${name}": the audit's failure is swallowed, so it can never go red.`);
    }
  }
  return offences;
}

const JOB = (run: string, extra = ''): string => `jobs:
  dependency-audit:
    runs-on: ubuntu-latest
${extra}    steps:
      - run: ${run}
`;

describe('CI fails on a vulnerable shipped dependency', () => {
  it('ci.yml is clean', () => {
    expect(auditOffences(readFileSync(CI, 'utf8'))).toEqual([]);
  });
});

describe('the detector can actually fail', () => {
  it('flags a workflow with no audit', () => {
    expect(auditOffences(JOB('pnpm test'))).toHaveLength(1);
  });

  it('flags an audit that only appears in a comment', () => {
    expect(auditOffences(JOB('echo hi  # pnpm audit --prod --audit-level high'))).toHaveLength(1);
  });

  it('flags a missing --prod and a missing level', () => {
    expect(auditOffences(JOB('pnpm audit'))).toHaveLength(2);
  });

  it('flags a swallowed failure, either way it is written', () => {
    expect(auditOffences(JOB('pnpm audit --prod --audit-level high || true'))).toHaveLength(1);
    expect(
      auditOffences(JOB('pnpm audit --prod --audit-level high', '    continue-on-error: true\n')),
    ).toHaveLength(1);
  });
});

describe('a correct audit walks through', () => {
  it('accepts high or critical, with = or a space', () => {
    expect(auditOffences(JOB('pnpm audit --prod --audit-level high'))).toEqual([]);
    expect(auditOffences(JOB('pnpm audit --prod --audit-level=critical'))).toEqual([]);
  });

  it('boundary: --audit-level moderate is not high', () => {
    expect(auditOffences(JOB('pnpm audit --prod --audit-level moderate'))).toHaveLength(1);
  });
});
