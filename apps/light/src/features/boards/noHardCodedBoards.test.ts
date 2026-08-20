/**
 * No component names a job board. The list is data, and this proves it stays
 * data.
 *
 * ============================================================================
 * WHY A SCAN AND NOT A CODE REVIEW
 * ============================================================================
 * The whole value of a configurable board list evaporates the first time
 * somebody adds "and a quick LinkedIn button up here as well". It would be a
 * two-line change, it would work, it would be defensible in review, and from
 * then on there would be one board nobody could switch off, reorder, or see
 * next to one they added themselves — and it would be the one that got missed
 * when the shipped list changed.
 *
 * ============================================================================
 * `reed` AND `adzuna` ARE TWO DIFFERENT THINGS IN THIS CODEBASE
 * ============================================================================
 * They are keyless BOARDS in `job-boards.json`, and they are also the two
 * keyed job-search API PROVIDERS (`JOB_PROVIDER_IDS`), which the status strip,
 * the provider toggles and every result card name for entirely legitimate
 * reasons. A scan that forbade the words outright would fail on a dozen files
 * that are not doing anything wrong, and it would be deleted within a week.
 *
 * So the words are exempt and the HOSTS are not. A hard-coded Reed button
 * still needs `reed.co.uk` in a component, and no component has any business
 * with that — which makes the host list the check that actually bites, and the
 * label list a second net for the six boards that are unambiguous.
 *
 * ============================================================================
 * WHAT WOULD MAKE THIS GUARD USELESS, AND WHAT STOPS IT
 * ============================================================================
 *   * A walker that finds no files would make every assertion vacuous, so the
 *     file count and one known filename are asserted first.
 *   * A scanner that no longer matches would pass a file full of violations,
 *     so `the scan can actually fail` feeds it one of each kind.
 *
 * This file is `.ts` and scans only `.tsx`, so it cannot trip on its own
 * examples. Do not rename it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JOB_PROVIDER_IDS } from '@cviper/job-apis';
import { describe, expect, it } from 'vitest';

import { SHIPPED_BOARDS } from './defaults';

/** `src/` — this file lives in `src/features/boards/`. */
const SRC = fileURLToPath(new URL('../..', import.meta.url));

/** The words that mean a board here and ONLY a board. See the header. */
const AMBIGUOUS = new Set<string>(JOB_PROVIDER_IDS);

/** Every shipped board's host — `www.linkedin.com`, `reed.co.uk`, ... */
const FORBIDDEN_HOSTS = [
  ...new Set(SHIPPED_BOARDS.map((board) => new URL(board.urlTemplate).hostname.toLowerCase())),
];

/** Every shipped board's label and id, minus the two that mean something else. */
const FORBIDDEN_NAMES = [
  ...new Set(
    SHIPPED_BOARDS.flatMap((board) => [board.label, board.id])
      .map((word) => word.toLowerCase())
      .filter((word) => !AMBIGUOUS.has(word)),
  ),
];

function tsxFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...tsxFiles(full));
    else if (entry.name.endsWith('.tsx')) found.push(full);
  }
  return found.sort();
}

/**
 * Drop comments before looking for names.
 *
 * A sentence explaining why no board is named here is not a board being named
 * here, and a guard that fires on its own documentation is a guard the next
 * person deletes.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Which forbidden hosts or whole-word names appear in this source. */
export function boardNamesIn(
  source: string,
  names: readonly string[],
  hosts: readonly string[],
): string[] {
  const code = stripComments(source).toLowerCase();

  return [
    ...hosts.filter((host) => code.includes(host)),
    ...names.filter((word) =>
      // `.` for every separator so `cv-library` also catches `cv_library` and
      // `cvLibrary`; word boundaries so `indeedly` and `reedited` do not match.
      new RegExp(`(?<![a-z0-9])${word.replace(/[^a-z0-9]/g, '.')}(?![a-z0-9])`).test(code),
    ),
  ];
}

/**
 * COMPONENTS only. A test may name a board — `search.zeroKeys.test.tsx` clicks
 * the LinkedIn button by name on purpose, and forbidding that would be
 * forbidding the test that proves the feature works.
 */
const FILES = tsxFiles(SRC).filter((file) => !file.endsWith('.test.tsx'));

describe('no component names a job board', () => {
  it('has files to scan, and knows what to look for', () => {
    // Half of the anti-inert guard: with any of these empty, every assertion
    // below would be vacuously true.
    expect(FILES.length).toBeGreaterThan(0);
    expect(FILES.some((file) => file.endsWith('KeylessBar.tsx'))).toBe(true);
    expect(FORBIDDEN_HOSTS.length).toBe(8);
    expect(FORBIDDEN_NAMES.length).toBeGreaterThanOrEqual(6);
  });

  it.each(FILES.map((file) => [relative(SRC, file).replaceAll('\\', '/'), file]))(
    '%s',
    (name, file) => {
      const found = boardNamesIn(readFileSync(file, 'utf8'), FORBIDDEN_NAMES, FORBIDDEN_HOSTS);
      expect(found, `${name} names ${found.join(', ')} — read it from the config instead`).toEqual(
        [],
      );
    },
  );
});

describe('the scan can actually fail', () => {
  it('catches a board named in a component', () => {
    const source = 'const b = <button>Search LinkedIn</button>;';
    expect(boardNamesIn(source, FORBIDDEN_NAMES, FORBIDDEN_HOSTS)).toEqual(['linkedin']);
  });

  it('catches a board id used as a key', () => {
    const source = 'const url = BOARDS["cv-library"].urlTemplate;';
    expect(boardNamesIn(source, FORBIDDEN_NAMES, FORBIDDEN_HOSTS)).toContain('cv-library');
  });

  it('catches a host even for a board whose NAME is allowed', () => {
    // The gap the exemption would otherwise leave: `reed` is a legitimate word
    // in this app, but `reed.co.uk` in a component never is.
    const source = 'const url = `https://www.reed.co.uk/jobs/${q}`;';
    expect(boardNamesIn(source, FORBIDDEN_NAMES, FORBIDDEN_HOSTS)).toContain('www.reed.co.uk');
  });

  it('does not fire on a comment that explains the rule', () => {
    const source = ['// no LinkedIn button here', '/* and no Indeed one */', 'const a = 1;'].join(
      '\n',
    );
    expect(boardNamesIn(source, FORBIDDEN_NAMES, FORBIDDEN_HOSTS)).toEqual([]);
  });

  it('does not fire on the API provider ids, which are a different thing', () => {
    const source = "const label = PROVIDER_LABEL.reed; if (job.source === 'adzuna') {}";
    expect(boardNamesIn(source, FORBIDDEN_NAMES, FORBIDDEN_HOSTS)).toEqual([]);
  });

  it('boundary: does not fire on a longer word that merely contains a name', () => {
    const source = 'const indeedly = 1; const guardianship = 2;';
    expect(boardNamesIn(source, FORBIDDEN_NAMES, FORBIDDEN_HOSTS)).toEqual([]);
  });
});
