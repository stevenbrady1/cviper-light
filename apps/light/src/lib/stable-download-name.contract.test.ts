/**
 * Every release carries the Windows installer under one name that never
 * changes, so cviper.ai's "Download for Windows" button can download it in one
 * click (L-245).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * The installer tauri-action uploads is named after the version
 * (`CViper Light_0.9.0_x64-setup.exe`), so a website cannot link to it without
 * carrying a version number and going stale at every release. The site used
 * to link to `/releases/latest` instead, which opens the GitHub release page
 * and leaves the visitor to find the right file among seven.
 *
 * GitHub serves `/releases/latest/download/<asset name>` from the newest
 * published, non-draft release. So the `stable-download` job in release.yml
 * copies the setup installer to {@link STABLE_NAME} on the draft, before it is
 * published, and the site links to that address. The link is held by the
 * `cviper-landing` repository's own test; this file holds the other end.
 *
 * What is asserted, lexically (comments stripped, house style):
 *
 *   1. release.yml has a `stable-download` job that waits for `bundle` and
 *      runs only on a tag push — the only time there is a draft to add to.
 *   2. It refuses to guess: exactly one `*-setup.exe` on the draft, or it fails.
 *   3. It uploads {@link STABLE_NAME} with `--clobber`, so a re-run replaces
 *      the copy rather than failing on it.
 *   4. {@link STABLE_NAME} matches none of the patterns the `sign` job
 *      downloads. If it did, the copy would be signed and listed in
 *      `latest.json` twice, and the manifest verifier would see an installer
 *      nobody meant to ship as an update.
 *
 * `/releases/latest/` stays forbidden for the UPDATER endpoint
 * (`updater-endpoint.contract.test.ts`): Latest moves the moment a release is
 * published, before a person has promoted its manifest. That is the wrong
 * moment for every installed copy to update and the right moment for a new
 * visitor to download.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const STABLE_NAME = 'CViper-Light-Windows-x64.exe';
const RELEASE = '.github/workflows/release.yml';
const JOB = 'stable-download';

const stripComments = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.replace(/\s+#\s.*$/, ''))
    .join('\n');

/** The top-level jobs of a workflow, each as its own text. */
function jobs(workflow: string): Map<string, string> {
  const found = new Map<string, string>();
  let inJobs = false;
  let current: string | null = null;
  for (const line of stripComments(workflow).split('\n')) {
    if (/^\S/.test(line)) {
      inJobs = /^jobs:\s*$/.test(line);
      current = null;
      continue;
    }
    const header = inJobs ? /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line) : null;
    if (header) {
      current = header[1] ?? null;
      if (current) found.set(current, '');
      continue;
    }
    if (current) found.set(current, `${found.get(current) ?? ''}${line}\n`);
  }
  return found;
}

/** The `--pattern` globs a job downloads with, as regular expressions. */
function downloadPatterns(job: string): RegExp[] {
  return [...job.matchAll(/--pattern\s+'([^']+)'/g)].map(
    ([, glob]) =>
      new RegExp(`^${(glob ?? '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`),
  );
}

function stableDownloadOffences(workflow: string): string[] {
  const all = jobs(workflow);
  const job = all.get(JOB);
  if (job === undefined) return [`${RELEASE} has no \`${JOB}\` job.`];
  const offences: string[] = [];
  if (!/needs:\s*\[?\s*bundle\b/.test(job))
    offences.push(`\`${JOB}\` does not wait for \`bundle\`.`);
  if (!/github\.event_name == 'push' && github\.ref_type == 'tag'/.test(job))
    offences.push(`\`${JOB}\` is not limited to a tag push.`);
  if (!/--pattern\s+'\*-setup\.exe'/.test(job))
    offences.push(`\`${JOB}\` does not fetch the setup installer by its pattern.`);
  if (!/-ne 1\b|!= 1\b|-eq 1\b|== 1\b/.test(job))
    offences.push(`\`${JOB}\` does not refuse when there is not exactly one setup installer.`);
  if (
    !new RegExp(
      `gh release upload[^\\n]*${STABLE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*--clobber`,
    ).test(job)
  )
    offences.push(`\`${JOB}\` does not upload ${STABLE_NAME} with --clobber.`);
  const sign = all.get('sign') ?? '';
  for (const pattern of downloadPatterns(sign)) {
    if (pattern.test(STABLE_NAME))
      offences.push(
        `${STABLE_NAME} matches the sign job's download pattern ${pattern}; it would be signed into latest.json.`,
      );
  }
  return offences;
}

const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

describe('the Windows installer has a name that never changes (L-245)', () => {
  it('release.yml copies the setup installer to the stable name on every tag', () => {
    expect(stableDownloadOffences(read(RELEASE))).toEqual([]);
  });

  it('the sign job still downloads by pattern, so the check above is not vacuous', () => {
    expect(downloadPatterns(jobs(read(RELEASE)).get('sign') ?? '')).not.toEqual([]);
  });
});

describe('the checker itself', () => {
  const good = [
    'on: push',
    'jobs:',
    '  sign:',
    '    steps:',
    "      - run: gh release download x --pattern '*.msi' --pattern '*-setup.exe'",
    '  stable-download:',
    '    needs: bundle',
    "    if: github.event_name == 'push' && github.ref_type == 'tag'",
    '    steps:',
    "      - run: gh release download x --pattern '*-setup.exe'",
    '      - run: if [ "$n" -ne 1 ]; then exit 1; fi',
    `      - run: gh release upload x ${STABLE_NAME} --clobber`,
  ];

  it('passes a well-formed job', () => {
    expect(stableDownloadOffences(good.join('\n'))).toEqual([]);
  });

  it('fails when the job is missing', () => {
    expect(stableDownloadOffences(good.slice(0, 5).join('\n'))).not.toEqual([]);
  });

  it('fails when the job is only a comment', () => {
    const commented = good.map((line, i) => (i >= 5 ? `#${line}` : line));
    expect(stableDownloadOffences(commented.join('\n'))).not.toEqual([]);
  });

  it('fails when the upload forgets --clobber', () => {
    const text = good.join('\n').replace(' --clobber', '');
    expect(stableDownloadOffences(text).join('\n')).toMatch(/--clobber/);
  });

  it('fails when the stable name would be picked up by the sign job', () => {
    const text = good.join('\n').replace("--pattern '*.msi'", "--pattern '*.exe'");
    expect(stableDownloadOffences(text).join('\n')).toMatch(/signed into latest\.json/);
  });
});
