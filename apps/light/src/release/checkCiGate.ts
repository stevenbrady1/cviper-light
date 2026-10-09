/**
 * Refuse to bundle a release until the tagged commit has passed CI (L-221).
 *
 * Usage, from the repository root, with `gh` authenticated:
 *
 *     GATE_SHA=<commit> node apps/light/src/release/checkCiGate.ts
 *
 * Run by the `ci-passed` job in `release.yml`, which `bundle` needs. The
 * judgement lives in `ciGate.ts`, which is pure and unit-tested offline; this
 * is the shell that asks GitHub and sets an exit code.
 *
 * It polls, because a tag is usually pushed moments after the merge while
 * main's own runs are still going. It gives up after GATE_TIMEOUT_MINUTES
 * (default 90) and exits 1 naming what it was still waiting for. A failed
 * lookup THROWS: a gate that cannot see must say so, never let the bundle in.
 */
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { isOnMain, judgeCiGate, parseCheckRuns, REQUIRED_CHECKS } from './ciGate.ts';

const POLL_SECONDS = 60;

function gh(args: readonly string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

function report(line: string): void {
  console.log(line);
  const summaryFile = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryFile) appendFileSync(summaryFile, `${line}\n`);
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function main(): Promise<void> {
  const repo = process.env['GITHUB_REPOSITORY'] ?? '';
  const sha = process.env['GATE_SHA'] ?? '';
  const timeoutMinutes = Number(process.env['GATE_TIMEOUT_MINUTES'] ?? '90');

  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error(`GITHUB_REPOSITORY is not owner/repo: "${repo}"`);
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`GATE_SHA is not a full commit SHA: "${sha}"`);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    throw new Error(`GATE_TIMEOUT_MINUTES must be a positive number, got "${timeoutMinutes}"`);
  }

  const compareStatus = gh([
    'api',
    `repos/${repo}/compare/main...${sha}`,
    '--jq',
    '.status',
  ]).trim();
  const onMain = isOnMain(compareStatus);
  report(`Commit ${sha} against main: ${compareStatus || '(no answer)'}`);

  const deadline = Date.now() + timeoutMinutes * 60 * 1000;
  for (;;) {
    const raw = gh([
      'api',
      '--paginate',
      `repos/${repo}/commits/${sha}/check-runs?per_page=100`,
      '--jq',
      '.check_runs[] | {name, status, conclusion}',
    ]);
    const verdict = judgeCiGate(onMain, parseCheckRuns(raw));

    if (verdict.kind === 'pass') {
      report(`CI passed on ${sha}: ${REQUIRED_CHECKS.join(', ')}. Bundling may proceed.`);
      return;
    }
    if (verdict.kind === 'fail') {
      for (const reason of verdict.reasons) report(`Refused: ${reason}`);
      report('Nothing was bundled. Fix the commit on main, then push a new tag at the fix.');
      process.exit(1);
    }
    if (Date.now() >= deadline) {
      report(
        `Gave up after ${timeoutMinutes} minutes still waiting for: ${verdict.pending.join(', ')}.`,
      );
      report(
        'Nothing was bundled. Once those checks are green, press "Re-run failed jobs" on this run.',
      );
      process.exit(1);
    }
    console.log(`Waiting for: ${verdict.pending.join(', ')}`);
    await sleep(POLL_SECONDS);
  }
}

await main();
