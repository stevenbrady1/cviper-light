/**
 * Carry out one release-admin action (L-178).
 *
 * Usage, from the repository root, with `gh` authenticated:
 *
 *     ADMIN_ACTION=clear-prerelease ADMIN_TAG=light-v0.3.0 \
 *       node apps/light/src/release/runReleaseAdmin.ts
 *
 * Run by `release-admin.yml`. The judgement lives in `releaseAdmin.ts`, which
 * is pure and unit-tested offline; this is the shell that lists the releases,
 * runs the one `gh` command the plan names, and then CHECKS it took.
 *
 * Inputs arrive through the environment, never interpolated into a shell line,
 * so a tag typed into the dispatch box is only ever data.
 *
 * A refusal exits 1 with the reason. A failed listing throws. Neither is ever
 * reported as success, because a green run on a workflow that edits releases
 * is read as "it was done".
 */
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { parseReleaseRows, planReleaseAdmin, type ReleaseRow } from './releaseAdmin.ts';

function listReleases(): ReleaseRow[] {
  const raw = execFileSync(
    'gh',
    ['release', 'list', '--limit', '100', '--json', 'tagName,isDraft,isPrerelease'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  return parseReleaseRows(raw);
}

function report(line: string): void {
  console.log(line);
  const summaryFile = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryFile) appendFileSync(summaryFile, `${line}\n`);
}

/** Whether the listing after the command shows the state the action promised. */
function tookEffect(action: string, tag: string, after: readonly ReleaseRow[]): boolean {
  const release = after.find((row) => row.tagName === tag);
  if (action === 'delete-draft') return release === undefined;
  if (action === 'set-prerelease') return release?.isPrerelease === true;
  return release?.isPrerelease === false;
}

function main(): void {
  const action = process.env['ADMIN_ACTION'] ?? '';
  const tag = process.env['ADMIN_TAG'] ?? '';

  const plan = planReleaseAdmin(action, tag, listReleases());

  if (plan.kind === 'refuse') {
    console.error(`::error title=Refused, nothing was changed::${plan.why}`);
    process.exit(1);
  }
  if (plan.kind === 'noop') {
    report(plan.summary);
    return;
  }

  console.log(`gh ${plan.args.join(' ')}`);
  execFileSync('gh', [...plan.args], { stdio: 'inherit' });

  if (!tookEffect(action, tag, listReleases())) {
    console.error(
      `::error title=The command ran but the release did not change::gh ${plan.args.join(' ')} exited 0, yet the release list does not show it. Check the release by hand.`,
    );
    process.exit(1);
  }
  report(plan.summary);
}

main();
