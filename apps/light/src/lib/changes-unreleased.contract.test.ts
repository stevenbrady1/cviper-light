/**
 * L-303 — pull requests add a changelog fragment; they never edit the
 * Unreleased block of `CHANGELOG.md`.
 *
 * Every PR used to insert its entry at the top of `## [Unreleased]`, so any two
 * open PRs edited the same lines and the second always conflicted: 8 of the 10
 * conflict fixes across PRs #370–#419 were in that one file. A file per change
 * under `changes/unreleased/` cannot collide, and `pnpm changelog:release`
 * gathers them at release time. See `src/release/changelog.ts`.
 *
 * This fails the build when an entry is written straight into `CHANGELOG.md`
 * again, and when a fragment is one the release script would refuse — so a
 * bad fragment is caught on its own PR, not on release day.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CHANGELOG_PATH, FRAGMENT_DIR, loadFragments } from '../release/fragmentsOnDisk.ts';
import { unreleasedProblems } from '../release/changelog.ts';

describe('changelog entries are fragments, not edits to CHANGELOG.md (L-303)', () => {
  it('the Unreleased block of CHANGELOG.md holds no entries', () => {
    const problems = unreleasedProblems(readFileSync(CHANGELOG_PATH, 'utf8'));
    expect(
      problems,
      'Put the entry in changes/unreleased/L-NNN.md instead — see CONTRIBUTING.md, "The changelog"',
    ).toEqual([]);
  });

  it('the fragment folder exists, and git keeps it when a release empties it', () => {
    expect(existsSync(join(FRAGMENT_DIR, '.gitkeep'))).toBe(true);
  });

  it('every fragment is one the release script will accept', () => {
    // loadFragments throws, naming the file, on the first bad one.
    expect(() => loadFragments()).not.toThrow();
  });
});
