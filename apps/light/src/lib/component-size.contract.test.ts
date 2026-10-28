/**
 * L-305 — no screen file grows past 800 lines, and the ones already past it
 * only ever shrink.
 *
 * The merge-conflict retrospective (L-303) found the conflicts that were not
 * in the changelog were in the two biggest screens: features that have nothing
 * to do with each other both add a line "just before the return" of the same
 * 1,600-line component, and git cannot merge two insertions at one spot. A
 * smaller file per panel means two features usually edit two files.
 *
 * This is a RATCHET, not a rewrite order. `CEILINGS` names every file that was
 * already over the limit when the guard arrived, at its size that day. Each
 * may get smaller and never bigger; when one is split below the limit it must
 * come off the list, so the list cannot hold a stale, generous number. A new
 * file over the limit fails outright.
 *
 * Only shipped `.tsx` counts. Tests are exempt: a long test file is many small
 * independent cases, and they do not clash the same way.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, walk } from './repo-scan.ts';

export const LINE_LIMIT = 800;

/** Over the limit on the day the guard arrived (28 Oct 2026). May only shrink. */
export const CEILINGS: Readonly<Record<string, number>> = {
  'apps/light/src/features/search/Search.tsx': 1067,
  'apps/light/src/features/tracker/Tracker.tsx': 1000,
  'apps/light/src/features/profile/Profile.tsx': 890,
};

export interface SizedFile {
  readonly path: string;
  readonly lines: number;
}

/** Every way the files break the ratchet. Empty means all is well. */
export function sizeProblems(
  files: readonly SizedFile[],
  limit: number,
  ceilings: Readonly<Record<string, number>>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { path, lines } of files) {
    seen.add(path);
    const ceiling = ceilings[path];
    if (ceiling === undefined) {
      if (lines > limit) problems.push(`${path}: ${lines} lines, over the ${limit}-line limit`);
      continue;
    }
    if (lines > ceiling) {
      problems.push(`${path}: ${lines} lines, over its ceiling of ${ceiling} — it may only shrink`);
    } else if (lines <= limit) {
      problems.push(`${path}: ${lines} lines, now under ${limit} — take it off CEILINGS`);
    } else if (lines < ceiling) {
      problems.push(`${path}: ${lines} lines — lower its ceiling from ${ceiling} to ${lines}`);
    }
  }
  for (const path of Object.keys(ceilings)) {
    if (!seen.has(path)) problems.push(`${path}: on CEILINGS but not found — take it off`);
  }
  return problems;
}

function lineCount(text: string): number {
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

describe('screen files stay small enough to edit in parallel (L-305)', () => {
  it('no shipped .tsx file is over the limit, and the old ones only shrink', () => {
    const root = join(REPO_ROOT, 'apps', 'light', 'src');
    const files = walk(root, { extensions: ['.tsx'] }).map((file) => ({
      path: displayPath(file),
      lines: lineCount(readFileSync(file, 'utf8')),
    }));
    expect(files.length).toBeGreaterThan(50);
    expect(sizeProblems(files, LINE_LIMIT, CEILINGS)).toEqual([]);
  });
});

describe('the guard itself', () => {
  const ceilings = { 'big.tsx': 900 };

  it('passes small files and a listed file at exactly its ceiling', () => {
    expect(
      sizeProblems(
        [
          { path: 'small.tsx', lines: 10 },
          { path: 'big.tsx', lines: 900 },
        ],
        800,
        ceilings,
      ),
    ).toEqual([]);
  });

  it('boundary: exactly the limit passes, one line over fails', () => {
    expect(sizeProblems([{ path: 'a.tsx', lines: 800 }], 800, {})).toEqual([]);
    expect(sizeProblems([{ path: 'a.tsx', lines: 801 }], 800, {})).toEqual([
      'a.tsx: 801 lines, over the 800-line limit',
    ]);
  });

  it('negative: a listed file that grew', () => {
    expect(sizeProblems([{ path: 'big.tsx', lines: 901 }], 800, ceilings)).toEqual([
      'big.tsx: 901 lines, over its ceiling of 900 — it may only shrink',
    ]);
  });

  it('negative: a listed file that shrank keeps a stale ceiling, or got under the limit', () => {
    expect(sizeProblems([{ path: 'big.tsx', lines: 850 }], 800, ceilings)).toEqual([
      'big.tsx: 850 lines — lower its ceiling from 900 to 850',
    ]);
    expect(sizeProblems([{ path: 'big.tsx', lines: 800 }], 800, ceilings)).toEqual([
      'big.tsx: 800 lines, now under 800 — take it off CEILINGS',
    ]);
  });

  it('negative: a listed file that no longer exists', () => {
    expect(sizeProblems([], 800, ceilings)).toEqual([
      'big.tsx: on CEILINGS but not found — take it off',
    ]);
  });
});
