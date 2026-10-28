/**
 * L-299 (from L-238) — a status message is written into a live region that is
 * already on the page, never mounted with its words already in it.
 *
 * Screen readers announce CHANGES to a live region they already know about. A
 * `role="status"` element rendered only when it has something to say arrives
 * with its words in the same instant, and whether that is read out depends on
 * the screen reader and the browser (WCAG 4.1.3). So the visible message keeps
 * its look and loses the role, and `LiveStatus` — always rendered, visually
 * hidden — carries the words to the screen reader.
 *
 * This reads the source: a `role="status"` whose element is the result of a
 * conditional (`cond ? (`, `: (`, `&& (`, or the same without the bracket) is a
 * live region that mounts pre-filled.
 *
 * `role="alert"` is not checked. An alert is assertive and is announced when
 * it is inserted; that is what the role is for.
 *
 * A conditional right at the element is only one shape. A component whose
 * WHOLE body is conditional (`if (!x) return null; return <div role="status">`,
 * or a parent that mounts it with `&&`) is invisible to that lexical check, and
 * four did exactly this until L-238: `UpdateBanner`, `ResumeBanner`,
 * `LeftoverKeysNotice` and `FewResults`. So there is a second, stricter rule
 * that does not care how the element is mounted: a `role="status"` element is
 * a HIDDEN region (`sr-only`) that exists only to be spoken. A visible message
 * never carries the role; its words go through `LiveStatus`, mounted where the
 * message's own parent is always on the page.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, walk } from './repo-scan.ts';

/** Every `role="status"` element that is mounted by a conditional, as `line`. */
export function conditionalStatusRegions(source: string): number[] {
  const lines: number[] = [];
  for (const match of source.matchAll(/role="status"/g)) {
    const tagStart = source.lastIndexOf('<', match.index);
    if (tagStart === -1) continue;
    const before = source
      .slice(0, tagStart)
      .replace(/\{\/\*[\s\S]*?\*\/\}\s*$/u, '')
      .trimEnd();
    if (/(\?|:|&&)\s*\(?$/u.test(before)) {
      lines.push(source.slice(0, match.index).split('\n').length);
    }
  }
  return lines;
}

/** The opening tag around `index`, up to its closing `>` (an arrow's `=>` is not one). */
function openingTag(source: string, tagStart: number): string {
  let depth = 0;
  for (let index = tagStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0 && source[index - 1] !== '=') {
      return source.slice(tagStart, index + 1);
    }
  }
  return source.slice(tagStart);
}

/** Every `role="status"` element that is not a hidden (`sr-only`) region, as `line`. */
export function visibleStatusRegions(source: string): number[] {
  const lines: number[] = [];
  for (const match of source.matchAll(/role="status"/g)) {
    const tagStart = source.lastIndexOf('<', match.index);
    if (tagStart === -1) continue;
    if (!/\bsr-only\b/u.test(openingTag(source, tagStart))) {
      lines.push(source.slice(0, match.index).split('\n').length);
    }
  }
  return lines;
}

const FEATURES = join(REPO_ROOT, 'apps', 'light', 'src');

describe('status messages are written into a region already on the page (L-299)', () => {
  it('no role="status" element is mounted by a conditional', () => {
    const files = walk(FEATURES, { extensions: ['.tsx'] });
    expect(files.length).toBeGreaterThan(50);
    const offences = files.flatMap((file) =>
      conditionalStatusRegions(readFileSync(file, 'utf8')).map(
        (line) => `${displayPath(file)}:${line}`,
      ),
    );
    expect(offences).toEqual([]);
  });

  it('every role="status" element is a hidden region: visible messages speak through LiveStatus (L-238)', () => {
    const files = walk(FEATURES, { extensions: ['.tsx'] });
    const offences = files.flatMap((file) =>
      visibleStatusRegions(readFileSync(file, 'utf8')).map(
        (line) => `${displayPath(file)}:${line}`,
      ),
    );
    expect(offences).toEqual([]);
  });
});

describe('the guard itself', () => {
  it('negative: catches each conditional shape', () => {
    expect(
      conditionalStatusRegions('{note === null ? null : (\n  <p role="status">x</p>\n)}'),
    ).toEqual([2]);
    expect(
      conditionalStatusRegions('{busy ? (\n  <p\n    role="status"\n  >x</p>\n) : null}'),
    ).toEqual([3]);
    expect(conditionalStatusRegions('{busy && <p role="status">x</p>}')).toEqual([1]);
    expect(
      conditionalStatusRegions('{a ? (\n  {/* why */}\n  <p role="status">x</p>\n) : null}'),
    ).toEqual([3]);
  });

  it('boundary: an always-rendered region passes, and so does role="alert"', () => {
    expect(
      conditionalStatusRegions('<div>\n  <p role="status" className="sr-only">{t}</p>\n</div>'),
    ).toEqual([]);
    expect(conditionalStatusRegions('{p === null ? null : (\n  <p role="alert">x</p>\n)}')).toEqual(
      [],
    );
  });
});

describe('the visible-region guard itself (L-238)', () => {
  it('negative: a visible message with the role, however it is mounted', () => {
    expect(
      visibleStatusRegions(
        'if (x) return null;\nreturn <div role="status" className="border">hi</div>;',
      ),
    ).toEqual([2]);
    expect(
      visibleStatusRegions(
        '<p\n  data-testid="x"\n  role="status"\n  onClick={() => go()}\n  className="text-ink"\n>hi</p>',
      ),
    ).toEqual([3]);
  });

  it('boundary: a hidden region passes, wherever sr-only sits in the tag', () => {
    expect(visibleStatusRegions('<p role="status" className="sr-only">{t}</p>')).toEqual([]);
    expect(
      visibleStatusRegions('<p className="sr-only" role="status" aria-live="polite">{t}</p>'),
    ).toEqual([]);
    // sr-only in a CHILD does not make the visible parent hidden.
    expect(
      visibleStatusRegions(
        '<div role="status" className="p-2"><span className="sr-only">x</span></div>',
      ),
    ).toEqual([1]);
  });
});
