/**
 * No two source files in one directory may differ only by letter case.
 *
 * ============================================================================
 * WHY THIS EXISTS: IT HAPPENED TWICE
 * ============================================================================
 * L-167: `importAiJobSearch.ts` (a parser) beside `ImportAiJobSearch.tsx` (a
 * panel). L-198: `atsStep.ts` (a model) beside `AtsStep.tsx` (a component).
 * Both times every check on Linux was green, and the iOS job's `tsc` on macOS
 * failed with TS1149, because macOS (and Windows) filesystems ignore case:
 * `import … from './AtsStep'` resolved to whichever file the filesystem found
 * first. The second time, the first fix's commit message described the trap
 * exactly, and nothing enforced it.
 *
 * ============================================================================
 * WHAT COUNTS AS A COLLISION
 * ============================================================================
 * Two files in the same directory whose names, lower-cased and with their
 * TypeScript/JavaScript extension removed, are equal. The extension is
 * removed because that is how a module specifier is written: `./AtsStep`
 * names `atsStep.ts` and `AtsStep.tsx` at once. `foo.test.ts` and `foo.ts`
 * are different stems (`foo.test` vs `foo`), so a file and its test never
 * collide.
 *
 * Test files are in scope: a test that imports the wrong half of a pair
 * fails on a Mac for the same reason.
 */
import { basename, dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, walk } from './repo-scan';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** The name a module specifier uses for this file, folded for a case-insensitive disk. */
export function specifierStem(fileName: string): string {
  return fileName.replace(/\.[cm]?[jt]sx?$/, '').toLowerCase();
}

/** Every group of two or more paths that collide, as display paths. */
export function caseCollisions(paths: readonly string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const key = `${dirname(path)}\u0000${specifierStem(basename(path))}`;
    const group = groups.get(key) ?? [];
    group.push(path);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

const FILES = walk(REPO_ROOT, { extensions: SOURCE_EXTENSIONS, excludeTests: false });

describe('no two source files differ only by case (L-167, L-198)', () => {
  it('the scan found the repository (a broken walk must not pass vacuously)', () => {
    const names = FILES.map((file) => displayPath(file));
    expect(names.some((name) => name.endsWith('apps/light/src/features/tailor/Tailor.tsx'))).toBe(
      true,
    );
    expect(names.some((name) => name.startsWith('packages/'))).toBe(true);
  });

  it('no directory holds two files a case-insensitive filesystem would confuse', () => {
    const collisions = caseCollisions(FILES).map((group) => group.map(displayPath));
    expect(
      collisions,
      'These files resolve to the same module on macOS and Windows. Rename one so the ' +
        'names differ by more than letter case (e.g. `atsComparison.ts` beside `AtsStep.tsx`).',
    ).toEqual([]);
  });

  it('the detector bites: the two real incidents, and a cross-extension pair', () => {
    expect(caseCollisions(['/a/importAiJobSearch.ts', '/a/ImportAiJobSearch.tsx'])).toHaveLength(1);
    expect(caseCollisions(['/a/atsStep.ts', '/a/AtsStep.tsx'])).toHaveLength(1);
    expect(caseCollisions(['/a/Foo.js', '/a/foo.ts'])).toHaveLength(1);
  });

  it('and lets the honest shapes through', () => {
    // A file and its test, the same name in two directories, and a stem that
    // merely starts with another.
    expect(caseCollisions(['/a/foo.ts', '/a/foo.test.ts'])).toEqual([]);
    expect(caseCollisions(['/a/Foo.tsx', '/b/foo.ts'])).toEqual([]);
    expect(caseCollisions(['/a/atsStep.ts', '/a/tailor.atsStep.test.tsx'])).toEqual([]);
  });
});
