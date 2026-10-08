/**
 * No shipped code scrolls past its own screen (L-216).
 *
 * `scrollIntoView` (and Chromium's `scrollIntoViewIfNeeded`) scroll every box
 * between an element and the window — the app shell and the page included,
 * even though the page hides its overflow. On Tailor that slid the whole
 * window up and left half of it blank. A screen scrolls its own area with
 * `app/scrollWithin.ts`; the window itself is never scrolled.
 *
 * A forbid-list (LESSON-033): these calls must be ABSENT from shipped source.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, shippedText, walk } from './repo-scan.ts';

const FORBIDDEN: readonly RegExp[] = [
  /\.scrollIntoView(IfNeeded)?\s*\(/,
  /\bwindow\.scroll(To|By)?\s*\(/,
  /\bdocument\.(documentElement|body|scrollingElement)\.scroll(To|By|Top|Left)?\b/,
];

function offending(text: string): boolean {
  return FORBIDDEN.some((pattern) => pattern.test(text));
}

describe('no scrolling beyond a screen’s own area (L-216)', () => {
  it('forbid-list: no shipped file calls scrollIntoView or scrolls the window or the page', () => {
    const files = [join(REPO_ROOT, 'apps/light/src'), join(REPO_ROOT, 'packages')].flatMap(
      (directory) => walk(directory, { extensions: ['.ts', '.tsx'] }),
    );
    expect(files.length).toBeGreaterThan(50);
    expect(files.filter((file) => offending(shippedText(file))).map(displayPath)).toEqual([]);
  });

  describe('the check can fail', () => {
    it.each([
      "anchor.scrollIntoView({ behavior: 'smooth' })",
      'el?.scrollIntoViewIfNeeded()',
      'window.scrollTo(0, 0)',
      'window.scroll({ top: 0 })',
      'document.body.scrollTop = 40',
      'document.scrollingElement.scrollTo({ top: 0 })',
    ])('catches %s', (line) => {
      expect(offending(line)).toBe(true);
    });

    it('negative: scrolling a screen’s own area is allowed', () => {
      expect(offending("container.scrollTo({ top, behavior: 'smooth' })")).toBe(false);
      expect(offending('container.scrollTop = top')).toBe(false);
    });
  });
});
