/**
 * The shared theme-colour reader (L-366). Every fixture here is an inline
 * string, so nothing in this file is ever picked up by the real scan.
 */
import { describe, expect, it } from 'vitest';

import {
  COLOUR_SETS,
  ThemeTokenError,
  darkClassVariants,
  lightColours,
  readColourSets,
  stripCssComments,
  styleSheetsOnDisk,
  type StyleSheet,
} from './themeTokens';

const LIGHT_FILE = COLOUR_SETS.light.file;
const FONTS_FILE = 'apps/light/src/styles/fonts.css';

const sheet = (text: string, path: string = LIGHT_FILE): StyleSheet => ({ path, text });
const theme = (body: string): StyleSheet => sheet(`@import 'tailwindcss';\n@theme {\n${body}\n}\n`);

/** Token name → resolved hex, in declaration order. */
const values = (...sheets: StyleSheet[]): [string, string][] =>
  [...readColourSets(sheets).light].map(([name, token]) => [name, token.hex]);

/** The problem codes a read fails with, in order; [] when it reads cleanly. */
function codes(...sheets: StyleSheet[]): string[] {
  try {
    readColourSets(sheets);
    return [];
  } catch (error) {
    if (error instanceof ThemeTokenError) return error.problems.map((p) => p.code);
    throw error;
  }
}

/** The whole message a read fails with. */
function message(...sheets: StyleSheet[]): string {
  try {
    readColourSets(sheets);
  } catch (error) {
    if (error instanceof ThemeTokenError) return error.message;
    throw error;
  }
  throw new Error('expected the read to fail');
}

describe('the theme reader knows exactly one colour set', () => {
  it('names the light set and nothing else', () => {
    expect(Object.keys(COLOUR_SETS)).toEqual(['light']);
    expect(COLOUR_SETS.light).toEqual({ file: 'apps/light/src/styles/theme.css', block: '@theme' });
  });
});

describe('reading the light set', () => {
  it('returns every colour token with its value, lowercased, in declaration order', () => {
    const light = readColourSets([
      theme('  --color-navy: #0F2044;\n  --color-card: #ffffff;\n  --color-ink-2: #0b1729;'),
    ]).light;
    expect([...light].map(([name, t]) => [name, t.hex])).toEqual([
      ['navy', '#0f2044'],
      ['card', '#ffffff'],
      ['ink-2', '#0b1729'],
    ]);
    expect(light.get('navy')!.rgb).toEqual([15, 32, 68]);
    expect(light.get('navy')!.at).toBe(`${LIGHT_FILE}:3`);
  });

  it('follows a token that refers to another token', () => {
    const light = readColourSets([
      theme('  --color-canvas: #f7f8fa;\n  --color-ink-inverse: var(--color-canvas);'),
    ]).light;
    expect(light.get('ink-inverse')!.hex).toBe('#f7f8fa');
    expect(light.get('ink-inverse')!.via).toEqual(['canvas']);
    expect(light.get('ink-inverse')!.written).toBe('var(--color-canvas)');
  });

  it('follows a chain of references, declared in any order', () => {
    expect(
      values(
        theme(
          '  --color-a: var(--color-b);\n  --color-b: var( --color-c );\n  --color-c: #123abc;',
        ),
      ),
    ).toEqual([
      ['a', '#123abc'],
      ['b', '#123abc'],
      ['c', '#123abc'],
    ]);
  });

  it('reads the last declaration of a block even without a trailing semicolon', () => {
    expect(values(sheet('@theme { --color-a: #000000 }'))).toEqual([['a', '#000000']]);
  });

  it('boundary: an empty theme is an empty set, not an error', () => {
    expect(values(sheet('@theme {}'))).toEqual([]);
    expect(values(sheet('@theme {\n  /* nothing yet */\n}'))).toEqual([]);
  });

  it('boundary: tokens whose value is not a colour (spacing, radius, type, shadow) are ignored', () => {
    const light = theme(
      [
        "  --font-sans: 'Inter', ui-sans-serif, sans-serif;",
        '  --text-xs: 0.8125rem;',
        '  --text-xs--line-height: calc(1.125 / 0.8125);',
        '  --radius-card: 12px;',
        '  --spacing-gutter: 1.5rem;',
        '  --shadow-raised: 0 0 0 1px rgb(11 23 41 / 0.08);',
      ].join('\n'),
    );
    expect(codes(light)).toEqual([]);
    expect(values(light)).toEqual([]);
  });

  it('boundary: using a colour outside the set is not declaring one', () => {
    const uses = sheet(
      [
        '@theme { --color-canvas: #f7f8fa; --color-blue: #1a56db; }',
        'body { background-color: var(--color-canvas); }',
        ':focus-visible { box-shadow: 0 0 0 4px var(--color-blue); }',
      ].join('\n'),
    );
    expect(codes(uses)).toEqual([]);
  });

  it('a colour named only in a comment is not a token, in the theme or another file', () => {
    const light = theme('  /* --color-ghost: #ffffff; */\n  --color-a: #000000;');
    const fonts = sheet('/* :root { --color-ink: #ffffff; } */\n', FONTS_FILE);
    expect(codes(light, fonts)).toEqual([]);
    expect(values(light, fonts)).toEqual([['a', '#000000']]);
  });

  it('a "/*" inside a quoted string does not start a comment', () => {
    expect(values(theme("  --font-x: '/*';\n  --color-a: #000000;\n  --font-y: '*/';"))).toEqual([
      ['a', '#000000'],
    ]);
  });
});

describe('negative: what the reader cannot read is a NAMED failure, never a skip', () => {
  it.each([
    ['an rgb() colour', 'rgb(14 159 110)'],
    ['a three-digit hex', '#fff'],
    ['an eight-digit hex (alpha)', '#0e9f6eff'],
    ['an oklch() colour', 'oklch(0.6 0.12 160)'],
    ['a named colour', 'teal'],
    ['a reference with a fallback', 'var(--color-b, #000000)'],
    ['a reference to a non-colour token', 'var(--radius-card)'],
    ['a value marked important', '#000000 !important'],
    ['an empty value', ''],
  ])('an unknown colour format: %s', (_name, value) => {
    const light = theme(`  --color-b: #111111;\n  --color-a: ${value};`);
    expect(codes(light)).toEqual(['unknown-colour-format']);
    expect(message(light)).toContain('--color-a');
  });

  it("Tailwind's namespace reset (--color-*: initial) is an unknown format, not a silent wipe", () => {
    expect(codes(theme('  --color-*: initial;\n  --color-a: #000000;'))).toEqual([
      'unknown-colour-format',
    ]);
  });

  it('a token declared twice in the set, even to the same value, names both lines', () => {
    const light = theme('  --color-a: #000000;\n  --color-b: #111111;\n  --color-a: #000000;');
    expect(codes(light)).toEqual(['declared-twice']);
    expect(message(light)).toMatch(/--color-a.*theme\.css:3.*theme\.css:5/s);
  });

  it.each([
    ['a :root block in the same file', LIGHT_FILE, ':root { --color-ink: #ffffff; }'],
    [
      'a dark media query',
      LIGHT_FILE,
      '@media (prefers-color-scheme: dark) { :root { --color-ink: #ffffff; } }',
    ],
    ['a .dark selector', LIGHT_FILE, '.dark { --color-ink: #ffffff; }'],
    ['a data-theme selector', LIGHT_FILE, "[data-theme='night'] { --color-ink: #ffffff; }"],
    ['an innocently named selector', LIGHT_FILE, '.theme-night { --color-ink: #ffffff; }'],
    ['a base layer', LIGHT_FILE, '@layer base { :root { --color-card: #fffffe; } }'],
    ['an @theme inline block', LIGHT_FILE, '@theme inline { --color-x: #000000; }'],
    ['the top level of another file', FONTS_FILE, '--color-x: #000000;'],
    ['a :root block in the fonts file', FONTS_FILE, ':root { --color-teal-ink: #0e9f6e; }'],
    [
      'an @theme block in another file',
      'packages/ui/src/extra.css',
      '@theme { --color-x: #000000; }',
    ],
  ])('a colour token outside the light set: %s', (_name, path, css) => {
    const sheets =
      path === LIGHT_FILE
        ? [sheet(`@theme { --color-ink: #0b1729; --color-card: #ffffff; }\n${css}\n`)]
        : [theme('  --color-ink: #0b1729;'), sheet(css, path)];
    expect(codes(...sheets)).toEqual(['colour-outside-light-set']);
    expect(message(...sheets)).toContain(path);
  });

  it('a colour token in a block nested inside the light set is outside it', () => {
    expect(
      codes(
        sheet(
          '@theme {\n  --color-a: #000000;\n  @media (min-width: 1px) { --color-x: #000000; }\n}',
        ),
      ),
    ).toEqual(['colour-outside-light-set']);
  });

  it('even a block with an unparseable colour outside the set is reported as outside', () => {
    expect(
      codes(theme('  --color-a: #000000;'), sheet(':root { --color-a: red; }', FONTS_FILE)),
    ).toEqual(['colour-outside-light-set']);
  });

  it('a second @theme block in the theme file is a second set, not more of the first', () => {
    expect(codes(sheet('@theme { --color-a: #000000; }\n@theme { }'))).toEqual([
      'light-set-declared-twice',
    ]);
  });

  it('no @theme block, or no theme file at all, is a named failure, not an empty palette', () => {
    expect(codes(sheet('body { margin: 0; }'))).toEqual(['no-light-set']);
    expect(codes(sheet('@theme { }', FONTS_FILE))).toEqual(['no-light-set']);
    expect(codes()).toEqual(['no-light-set']);
  });

  it('a reference to a token that does not exist', () => {
    const light = theme('  --color-a: var(--color-nope);');
    expect(codes(light)).toEqual(['missing-reference']);
    expect(message(light)).toContain('--color-nope');
  });

  it('a reference cycle finishes as a named failure, not a hang', () => {
    expect(codes(theme('  --color-a: var(--color-b);\n  --color-b: var(--color-a);'))).toEqual([
      'reference-cycle',
      'reference-cycle',
    ]);
    expect(message(theme('  --color-a: var(--color-a);'))).toContain('--color-a -> --color-a');
  });

  it('a reference to a broken token reports the broken token once, not a cascade', () => {
    expect(codes(theme('  --color-a: var(--color-b);\n  --color-b: rgb(0 0 0);'))).toEqual([
      'unknown-colour-format',
    ]);
  });

  it.each([
    ['a hex colour', '--brand-accent: #17a2b8;'],
    ['an rgb() colour', '--brand-accent: rgb(23 162 184);'],
    ['an alias of a colour token', '--ring: var(--color-a);'],
  ])('a colour under a name outside --color-*, which nothing would check: %s', (_name, line) => {
    expect(codes(theme(`  --color-a: #000000;\n  ${line}`))).toEqual([
      'colour-outside-colour-namespace',
    ]);
  });

  it('a stylesheet the reader cannot parse is a named failure', () => {
    expect(codes(sheet('@theme { --color-a: #000000;'))).toEqual(['unreadable-stylesheet']);
    expect(codes(sheet('@theme { --color-a: #000000; }\n/* never closed'))).toEqual([
      'unreadable-stylesheet',
    ]);
    expect(codes(sheet('@theme { --color-a: #000000; } }'))).toEqual(['unreadable-stylesheet']);
  });

  it('reports every problem at once, not only the first', () => {
    expect(
      codes(
        theme('  --color-a: #fff;\n  --color-a: #000000;\n  --color-b: var(--color-z);'),
        sheet('.dark { --color-a: #ffffff; }', FONTS_FILE),
      ),
    ).toEqual([
      'declared-twice',
      'unknown-colour-format',
      'missing-reference',
      'colour-outside-light-set',
    ]);
  });
});

describe('stripCssComments', () => {
  it('drops comments and keeps strings, line numbers included', () => {
    const stripped = stripCssComments("a /* x\ny */ b '/* kept */' c");
    expect(stripped).toContain("'/* kept */'");
    expect(stripped).not.toContain('x');
    expect(stripped.split('\n')).toHaveLength(2);
  });
});

describe('dark: class variants in source', () => {
  it.each([
    ['a plain variant', "const c = 'px-2 dark:bg-navy';", ['dark:bg-navy']],
    ['after a breakpoint', "const c = 'md:dark:text-ink';", ['md:dark:text-ink']],
    ['before a state', "const c = 'dark:hover:bg-card';", ['dark:hover:bg-card']],
    ['important modifier', "const c = 'dark:!bg-card';", ['dark:!bg-card']],
    ['in a JSX attribute', 'const A = () => <p className="dark:bg-card" />;', ['dark:bg-card']],
    ['in a template literal', 'const c = `px-2 ${x} dark:bg-card`;', ['dark:bg-card']],
  ])('finds %s', (_name, source, expected) => {
    expect(darkClassVariants('x.tsx', source).map((hit) => hit.found)).toEqual(expected);
  });

  it('reports the file and line', () => {
    expect(darkClassVariants('x.tsx', "\nconst c = 'dark:bg-card';")).toEqual([
      { at: 'x.tsx:2', found: 'dark:bg-card' },
    ]);
  });

  it.each([
    ['a line comment', '// no dark:bg-navy here\nconst c = 1;'],
    ['a block comment', '/* dark:bg-navy */ const c = 1;'],
    ['JSX text', 'const A = () => <p>dark:bg-navy</p>;'],
    ['prose with a space after the colon', "const c = 'It is dark: very';"],
    ['a longer word ending in dark', "const c = 'xdark:bg-navy';"],
    ['a colour name', "const c = 'text-dark-blue darkness';"],
  ])('ignores %s', (_name, source) => {
    expect(darkClassVariants('x.tsx', source)).toEqual([]);
  });
});

describe('on the real tree', () => {
  it('reads the real light set without error', () => {
    const light = lightColours();
    expect(light.size).toBeGreaterThan(10);
    expect(light.get('teal')?.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('scans every style file, not only the theme (a broken walker must not pass vacuously)', () => {
    const paths = styleSheetsOnDisk().map((s) => s.path);
    expect(paths).toContain(LIGHT_FILE);
    expect(paths).toContain(FONTS_FILE);
  });

  it('returns every colour the old per-test patterns read, with the same values', () => {
    // The pattern the three checks used before L-366, run over the theme with
    // its comments removed. Every token it can see, the reader must return
    // unchanged. (The reader may return MORE: a reference, which the old
    // pattern could not read at all.)
    const themeCss = stripCssComments(styleSheetsOnDisk().find((s) => s.path === LIGHT_FILE)!.text);
    const legacy = [...themeCss.matchAll(/--color-([a-z-]+):\s*#([0-9a-fA-F]{6})\s*;/g)].map(
      (m) => [m[1]!, `#${m[2]!.toLowerCase()}`] as const,
    );
    expect(legacy.length).toBeGreaterThan(10);
    const light = lightColours();
    for (const [name, hex] of legacy) expect(light.get(name)?.hex, `--color-${name}`).toBe(hex);
  });
});
