/**
 * The signposts have no state: no storage, no clock, no counter, no timer.
 *
 * L-87's rule is that the same sentence appears every time, so a signpost can
 * never become a nag. `Signpost.test.tsx` proves the rendered behaviour; this
 * guard holds the SOURCE to it, so a `useState` for "dismissed" or a
 * `localStorage` read for "shown 3 times" cannot be added without the build
 * saying so. Forbid-list shape (LESSON-033): it lists what must be absent.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const FOLDERS = [join(__dirname), join(__dirname, '..', 'settings', 'about')];

const FORBIDDEN: readonly RegExp[] = [
  /\buse(State|Reducer|Effect|LayoutEffect|Ref|SyncExternalStore)\b/,
  /\b(local|session)Storage\b/,
  /\bindexedDB\b/,
  /\bdocument\.cookie\b/,
  /\bDate\b|\bperformance\.now\b/,
  /\bMath\.random\b/,
  /\bset(Timeout|Interval)\b/,
  /\bfetch\s*\(/,
  /plugin-sql|\/db\//,
];

function shippedFiles(folder: string): string[] {
  return readdirSync(folder)
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => join(folder, name))
    .filter((file) => statSync(file).isFile());
}

describe('signposts and About are stateless', () => {
  const files = FOLDERS.flatMap(shippedFiles);

  it('scans the real modules', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it('none of them reads or writes state, time or the network', () => {
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return FORBIDDEN.filter((pattern) => pattern.test(text)).map(
        (pattern) => `${file}: ${pattern.source}`,
      );
    });
    expect(offenders).toEqual([]);
  });
});
