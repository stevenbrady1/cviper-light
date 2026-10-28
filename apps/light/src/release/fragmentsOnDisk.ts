/**
 * Reads `changes/unreleased/` (L-303). Shared by the release script and the
 * contract test, so the two can never disagree about what a fragment is.
 *
 * Every entry that is not a dotfile is parsed, so a file with the wrong name
 * (`notes.md`, `L-12.txt`) FAILS rather than being skipped — a skipped file is
 * a change that silently never reaches the changelog. `.gitkeep` is the one
 * dotfile, there so git keeps the folder when a release has emptied it.
 *
 * A missing folder throws. It is never read as "no fragments".
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFragment, type Fragment } from './changelog.ts';

/** The repository root, relative to this file. */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const CHANGELOG_PATH = join(REPO_ROOT, 'CHANGELOG.md');
export const FRAGMENT_DIR = join(REPO_ROOT, 'changes', 'unreleased');

export interface FragmentFile {
  readonly path: string;
  readonly fragment: Fragment;
}

export function loadFragments(directory: string = FRAGMENT_DIR): FragmentFile[] {
  return readdirSync(directory)
    .filter((name) => !name.startsWith('.'))
    .sort()
    .map((name) => {
      const path = join(directory, name);
      if (!statSync(path).isFile()) {
        throw new Error(`${name}: changes/unreleased/ holds files only, one per change`);
      }
      return { path, fragment: parseFragment(name, readFileSync(path, 'utf8')) };
    });
}
