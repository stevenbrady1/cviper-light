/**
 * Gather `changes/unreleased/` into `CHANGELOG.md` (L-303).
 *
 * Usage, from the repository root:
 *
 *     pnpm changelog:preview                       # print the next release's notes
 *     pnpm changelog:release <version> <date>      # e.g. 0.11.1 2026-10-29
 *
 * `release` writes the new version into `CHANGELOG.md`, deletes the fragments it
 * wrote (keeping `.gitkeep`), and prints what it did. Commit the result as the
 * release commit. It changes nothing on any error: `CHANGELOG.md` is written
 * first and the fragments are deleted only after that write succeeds.
 *
 * The judgement lives in `changelog.ts`, which is pure and unit-tested
 * offline; this file is the shell that reads and writes the files.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

import { foldRelease, renderRelease } from './changelog.ts';
import { CHANGELOG_PATH, loadFragments } from './fragmentsOnDisk.ts';

function main(argv: readonly string[]): void {
  const [command, version, date] = argv;
  const files = loadFragments();
  const fragments = files.map((file) => file.fragment);

  if (command === 'preview') {
    if (fragments.length === 0) {
      console.log('changes/unreleased/ is empty: nothing would be released.');
      return;
    }
    console.log(renderRelease(fragments, '<version>', '<date>'));
    return;
  }

  if (command === 'release' && version !== undefined && date !== undefined) {
    const changelog = readFileSync(CHANGELOG_PATH, 'utf8');
    writeFileSync(CHANGELOG_PATH, foldRelease(changelog, fragments, version, date));
    for (const file of files) rmSync(file.path);
    console.log(
      `CHANGELOG.md: wrote ${version} (${date}) from ${fragments.length} fragment(s) and deleted them.`,
    );
    console.log('Add the one-paragraph summary under the new heading by hand, then commit.');
    return;
  }

  throw new Error('usage: releaseChangelog.ts preview | release <version> <YYYY-MM-DD>');
}

main(process.argv.slice(2));
