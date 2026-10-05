/**
 * Every call of `sanitizeForPrompt` outside the prompt builders names its bound
 * (L-207).
 *
 * The default bound (24,000 characters, 4 x the largest prompt field) is right
 * for the builders, which sanitise and then truncate to a field budget. It is a
 * trap for anyone who STORES the result: the default would silently cut a saved
 * advert. So outside `packages/ai-providers/src/prompt/` a call must pass an
 * explicit second argument, and has to decide.
 *
 * Derived, not listed: every non-test source file under `apps/` and `packages/`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, stripComments, walk } from './repo-scan';

const EXEMPT_DIRECTORY = 'packages/ai-providers/src/prompt/';
const DEFINITION = 'packages/cv-parsing/src/sanitize.ts';
/** Both entry points carry the default bound. */
const ENTRY_POINTS = ['sanitizeForPrompt(', 'sanitizeWithStats('] as const;

interface Call {
  readonly file: string;
  readonly args: number;
}

/** The number of top-level arguments of each `sanitizeForPrompt(` call in `text`. */
function callsOf(text: string, marker: string = 'sanitizeForPrompt('): number[] {
  const counts: number[] = [];
  let from = text.indexOf(marker);
  while (from !== -1) {
    let depth = 1;
    let args = 0;
    let sawToken = false;
    let i = from + marker.length;
    for (; i < text.length && depth > 0; i += 1) {
      const ch = text[i] ?? '';
      if ('([{'.includes(ch)) depth += 1;
      else if (')]}'.includes(ch)) depth -= 1;
      else if (ch === ',' && depth === 1) {
        args += 1;
        sawToken = false;
        continue;
      }
      if (depth > 0 && !/\s/.test(ch)) sawToken = true;
    }
    if (sawToken) args += 1;
    counts.push(args);
    from = text.indexOf(marker, i);
  }
  return counts;
}

const calls: Call[] = [];
for (const root of ['apps', 'packages']) {
  for (const path of walk(join(REPO_ROOT, root), { extensions: ['.ts', '.tsx'] })) {
    const file = displayPath(path);
    if (file.startsWith(EXEMPT_DIRECTORY) || file === DEFINITION) continue;
    const text = stripComments(readFileSync(path, 'utf8'));
    for (const marker of ENTRY_POINTS) {
      for (const args of callsOf(text, marker)) calls.push({ file, args });
    }
  }
}

describe('sanitizeForPrompt outside the prompt builders', () => {
  it('finds at least one call (a broken scan must not pass vacuously)', () => {
    expect(calls.length).toBeGreaterThan(0);
  });

  it.each(calls.map((call) => [call.file, call.args] as const))(
    '%s passes an explicit bound (args: %i)',
    (file, args) => {
      expect(
        args,
        `${file} calls sanitizeForPrompt without a second argument. The default cuts at 24,000 characters; a caller that stores the result must say how much it keeps.`,
      ).toBeGreaterThanOrEqual(2);
    },
  );

  it('the scanner counts arguments (one, two, nested commas)', () => {
    expect(callsOf('sanitizeForPrompt(a)')).toEqual([1]);
    expect(callsOf('sanitizeForPrompt(a, 50)')).toEqual([2]);
    expect(callsOf('sanitizeForPrompt(f(a, b))')).toEqual([1]);
    expect(callsOf('sanitizeForPrompt(\n  f(a, b),\n  MAX,\n)')).toEqual([2]);
  });
});
