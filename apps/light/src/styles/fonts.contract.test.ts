/**
 * The font folder and the stylesheets say the same thing (L-414).
 *
 * The app once shipped a third family, a serif (Newsreader), for page titles
 * and the match score. Titles left it in L-405 and the score in L-407, and
 * `heading-ladder.contract.test.ts` forbids its class anywhere. L-414 took the
 * font itself out: three files, their licence, their `@font-face` rules and
 * the `--font-display` token.
 *
 * FORBID-LIST (LESSON-033). Each rule here names something that must be
 * ABSENT, read with comments stripped so the note explaining a rule can
 * neither trip it nor satisfy it:
 *
 *   - no shipped stylesheet or source file names the serif or its token
 *   - no serif file or licence is left in the font folder
 *   - no `@font-face` points at a file that is not there
 *   - no font file ships unused, and none ships without its licence
 *
 * The last two are not about the serif. They are what a removal like this one
 * gets wrong: a rule left pointing at a deleted file draws the fallback face
 * with no error anywhere, and a licence left behind (or taken by mistake)
 * makes the bundle's own notices untrue.
 *
 * The BUILT stylesheet is checked too, by `e2e/contrast-webkit.spec.ts`, which
 * reads the production build this file cannot see.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, shippedText, stripComments, walk } from '../lib/repo-scan';

const FONT_DIR = join(REPO_ROOT, 'apps/light/public/fonts');
const SHIPPED = [
  ...walk(join(REPO_ROOT, 'apps/light/src'), { extensions: ['.css', '.ts', '.tsx'] }),
  ...walk(join(REPO_ROOT, 'packages/ui/src'), { extensions: ['.css', '.ts', '.tsx'] }),
  join(REPO_ROOT, 'apps/light/index.html'),
];

/**
 * What in a file's text still names the removed serif: the family, or the
 * `--font-display` token (defined or read). The `font-display: block`
 * DESCRIPTOR inside an `@font-face` is a different thing and is not one.
 */
export function serifLeftovers(text: string): string[] {
  const shipped = stripComments(text);
  return [
    ...(/newsreader/i.test(shipped) ? ['names Newsreader'] : []),
    ...(/--font-display(?![\w-])/.test(shipped) ? ['names the --font-display token'] : []),
  ];
}

/** Every address an `@font-face` in a stylesheet loads, in order. */
export function fontFaceUrls(css: string): string[] {
  return [...stripComments(css).matchAll(/@font-face\s*\{([^}]*)\}/g)].flatMap((face) =>
    [...(face[1] ?? '').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((url) => url[1] ?? ''),
  );
}

const FONT_URLS = SHIPPED.filter((file) => file.endsWith('.css')).flatMap((file) =>
  fontFaceUrls(readFileSync(file, 'utf8')),
);
const FONT_FILES = readdirSync(FONT_DIR).filter((name) => name.endsWith('.woff2'));
/** `LICENSE-IBM-Plex.txt` → `ibm-plex`: what its font files' names start with. */
const LICENSED = readdirSync(FONT_DIR)
  .filter((name) => /^LICENSE-.+\.txt$/.test(name))
  .map((name) => name.slice('LICENSE-'.length, -'.txt'.length).toLowerCase());

describe('the unused serif font is gone, and stays gone (L-414)', () => {
  it('no shipped stylesheet or source file names the serif or its token', () => {
    // Proof the scan read the two files that held it last.
    for (const last of ['styles/fonts.css', 'styles/theme.css']) {
      expect(SHIPPED.map(displayPath).filter((file) => file.endsWith(last))).toHaveLength(1);
    }
    const offences = SHIPPED.flatMap((file) =>
      serifLeftovers(shippedText(file)).map((what) => `${displayPath(file)} ${what}`),
    );
    expect(offences).toEqual([]);
  });

  it('no serif font file or licence is left in the font folder', () => {
    expect(readdirSync(FONT_DIR).filter((name) => /newsreader/i.test(name))).toEqual([]);
  });
});

describe('the font folder matches the stylesheets', () => {
  it('every @font-face points at a file that ships', () => {
    // Anti-inert: Inter is two files and IBM Plex Mono four.
    expect(FONT_URLS.length).toBeGreaterThanOrEqual(6);
    const missing = FONT_URLS.filter(
      (url) =>
        !url.startsWith('/fonts/') || !existsSync(join(FONT_DIR, url.slice('/fonts/'.length))),
    );
    expect(missing).toEqual([]);
  });

  it('every font file that ships is loaded by an @font-face', () => {
    expect(FONT_FILES.length).toBeGreaterThanOrEqual(6);
    expect(FONT_FILES.filter((name) => !FONT_URLS.includes(`/fonts/${name}`))).toEqual([]);
  });

  it('every font file has its licence beside it, and every licence has a font', () => {
    expect(LICENSED.length).toBeGreaterThanOrEqual(2);
    expect(
      FONT_FILES.filter((name) => !LICENSED.some((slug) => name.startsWith(`${slug}-`))),
    ).toEqual([]);
    expect(
      LICENSED.filter((slug) => !FONT_FILES.some((name) => name.startsWith(`${slug}-`))),
    ).toEqual([]);
  });
});

describe('the font checks can fail', () => {
  it('sees the family and the token, in a rule, a value or a class list', () => {
    expect(serifLeftovers("@font-face { font-family: 'Newsreader'; }")).toEqual([
      'names Newsreader',
    ]);
    expect(serifLeftovers("  --font-display: 'Source Serif 4', serif;")).toEqual([
      'names the --font-display token',
    ]);
    expect(serifLeftovers('.x { font-family: var(--font-display); }')).toHaveLength(1);
    expect(serifLeftovers("url('/fonts/newsreader-400-latin.woff2')")).toHaveLength(1);
  });

  it('is not tripped by a comment, the font-display descriptor or a longer name', () => {
    expect(
      serifLeftovers('/* Newsreader was the display face; --font-display named it */'),
    ).toEqual([]);
    expect(serifLeftovers('// --font-display is gone\nconst a = 1;')).toEqual([]);
    expect(serifLeftovers('@font-face { font-display: block; }')).toEqual([]);
    expect(serifLeftovers('--font-display-2: serif;')).toEqual([]);
  });

  it('reads the addresses inside @font-face only, and not from a comment', () => {
    const css = `
      /* @font-face { src: url('/fonts/gone.woff2'); } */
      @font-face { font-family: 'A'; src: url('/fonts/a.woff2') format('woff2'); }
      @font-face { font-family: 'B'; src: url("/fonts/b.woff2"), url(/fonts/c.woff2); }
      .logo { background: url('/logo.svg'); }`;
    expect(fontFaceUrls(css)).toEqual(['/fonts/a.woff2', '/fonts/b.woff2', '/fonts/c.woff2']);
  });
});
