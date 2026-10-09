/**
 * A hostile page must not freeze the app (L-225).
 *
 * Fetch reads up to 5 MB of somebody else's HTML, and `htmlToText` runs on the
 * UI thread. Its patterns were lazy cross-tag regexes — `<nav>…</nav>`,
 * `<!--…-->`, `<…>` — and on an opener with no closer each attempt scans to the
 * end of the input and then retries one character later. Measured before the
 * fix: 400 KB of `<nav>` took 7.3 s and 400 KB of `<!--` 7.1 s, growing with
 * the square of the size, so a 5 MB page meant a window frozen for many
 * minutes. Nothing about such a page is exotic: it is one repeated string.
 *
 * Each case is ~500 KB. The budget is one second — five times the 200 ms the
 * ticket asks for, so a loaded CI runner cannot flake it, and still more than
 * ten times under what the quadratic code took at this size.
 */
import { describe, expect, it } from 'vitest';

import { htmlToText, jobPostingText } from './htmlToText';

const BUDGET_MS = 1000;

function timed(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

const HOSTILE: ReadonlyArray<readonly [string, string]> = [
  ['unclosed drop-with-content openers', '<nav>'.repeat(100_000)],
  ['unclosed scripts', '<script>'.repeat(60_000)],
  ['unclosed comments', '<!--'.repeat(125_000)],
  ['bare angle brackets with no closing >', '<'.repeat(500_000)],
  ['unclosed block openers', '<div'.repeat(125_000)],
  ['unclosed drop openers without >', '<aside '.repeat(70_000)],
  ['openers followed by one late >', `${'<nav'.repeat(100_000)}>`],
];

describe('htmlToText stays linear on hostile pages', () => {
  for (const [name, page] of HOSTILE) {
    it(`${name} (${Math.round(page.length / 1000)} KB) finish within ${BUDGET_MS} ms`, () => {
      expect(timed(() => htmlToText(page))).toBeLessThan(BUDGET_MS);
    });
  }
});

describe('jobPostingText stays linear on hostile pages', () => {
  it('unclosed structured-data blocks finish within budget', () => {
    const page = '<script type="application/ld+json">{'.repeat(15_000);
    expect(timed(() => jobPostingText(page))).toBeLessThan(BUDGET_MS);
  });
});

describe('the linear rewrite still reads ordinary pages the same way', () => {
  it('drops an element with its content, case-insensitively, and keeps what follows', () => {
    expect(htmlToText('<p>Before</p><NAV class="x">menu</nav ><p>After</p>')).toBe('Before\nAfter');
  });

  it('leaves an unclosed drop element as text rather than eating the page', () => {
    // There is no `</aside>` to end it, so the opener is an ordinary tag.
    expect(htmlToText('<aside>Similar jobs<p>Real advert</p>')).toBe('Similar jobs\nReal advert');
  });

  it('pairs each opener with its own name, not the next closer of any kind', () => {
    expect(htmlToText('<p>A</p><script>x</style>y</script><p>B</p>')).toBe('A\nB');
  });

  it('removes comments, including one hiding a script', () => {
    expect(htmlToText('<p>A</p><!-- <script>bad()</script> --><p>B</p>')).toBe('A\nB');
  });

  it('boundary: an unclosed comment is cut as an unfinished tag, not kept as text', () => {
    // Unchanged from before the rewrite: no `-->`, so the comment step leaves
    // it, and the trailing-`<` rule then cuts it as a tag the page never closed.
    expect(htmlToText('<p>A</p><!-- never closed')).toBe('A');
  });

  it('boundary: a trailing tag with no > is dropped, an earlier closed one is a space', () => {
    expect(htmlToText('<b>£45k</b><span>to</span> £55k <a href="x')).toBe('£45k to £55k');
  });

  it('boundary: empty input is empty text', () => {
    expect(htmlToText('')).toBe('');
  });
});
