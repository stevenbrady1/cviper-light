/**
 * Dependabot holds back the two major upgrades that break the build.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Dependabot groups every npm update into ONE pull request (L-222). On
 * 15 Oct 2026 that group (#286) carried 32 updates, two of them majors:
 *
 *   * TypeScript 6 -> 7. TypeScript 7 drops the JavaScript compiler API that
 *     `src/lib/copy-text.ts` imports (`ts.Node`, `ts.isImportDeclaration`...),
 *     so typecheck and the production build fail.
 *   * Vitest 4 -> 5, a major for the whole test runner.
 *
 * One breaking major turns the whole group red, so the 30 safe updates were
 * stuck behind it. Each of these majors is a planned migration, not a weekly
 * bump; until it is done, Dependabot must not propose it. Remove an entry
 * here, and from the test, in the PR that does the migration.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const DEPENDABOT = join(REPO_ROOT, '.github', 'dependabot.yml');

const withoutComments = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');

/** The npm block: from its `package-ecosystem` line to the next one. */
function npmBlock(text: string): string {
  const clean = withoutComments(text);
  const start = clean.search(/package-ecosystem:\s*npm\b/);
  if (start === -1) return '';
  const rest = clean.slice(start + 1);
  const next = rest.search(/package-ecosystem:/);
  return next === -1 ? rest : rest.slice(0, next);
}

/** True when `block` ignores semver-major updates for `name`. */
function holdsMajor(block: string, name: string): boolean {
  const entry = new RegExp(
    String.raw`-\s*dependency-name:\s*['"]?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\s*\n\s*update-types:\s*\[[^\]]*['"]version-update:semver-major['"][^\]]*\]`,
  );
  return entry.test(block);
}

describe('dependabot.yml holds back the npm majors that break the build', () => {
  const block = npmBlock(readFileSync(DEPENDABOT, 'utf8'));

  it('has an npm block at all', () => {
    expect(block).not.toBe('');
  });

  for (const name of ['typescript', 'vitest']) {
    it(`ignores ${name} major updates`, () => {
      expect(holdsMajor(block, name)).toBe(true);
    });
  }
});

describe('the guard itself', () => {
  const yml = (ignores: string) =>
    `version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n${ignores}\n  - package-ecosystem: cargo\n    directory: /x\n`;

  it('negative: no ignore block means nothing is held', () => {
    expect(holdsMajor(npmBlock(yml('')), 'typescript')).toBe(false);
  });

  it('negative: holding minors is not holding majors', () => {
    const minor =
      "    ignore:\n      - dependency-name: typescript\n        update-types: ['version-update:semver-minor']";
    expect(holdsMajor(npmBlock(yml(minor)), 'typescript')).toBe(false);
  });

  it('boundary: a commented-out entry does not count', () => {
    const commented =
      "    ignore:\n      # - dependency-name: typescript\n      #   update-types: ['version-update:semver-major']";
    expect(holdsMajor(npmBlock(yml(commented)), 'typescript')).toBe(false);
  });

  it('negative: an ignore under cargo does not count for npm', () => {
    const text =
      "version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n  - package-ecosystem: cargo\n    ignore:\n      - dependency-name: typescript\n        update-types: ['version-update:semver-major']\n";
    expect(holdsMajor(npmBlock(text), 'typescript')).toBe(false);
  });

  it('happy: a real entry counts', () => {
    const held =
      "    ignore:\n      - dependency-name: typescript\n        update-types: ['version-update:semver-major']";
    expect(holdsMajor(npmBlock(yml(held)), 'typescript')).toBe(true);
  });
});
