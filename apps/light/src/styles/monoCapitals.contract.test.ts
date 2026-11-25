/**
 * Labels are words in Inter, not small mono capitals (L-432).
 *
 * Small capitals in the mono face, spaced wide, read like a developer
 * dashboard, and they put a second typeface on every screen for text that is
 * not a number. The mono face stays where it earns its place: numbers and
 * dates, whose digits line up in a column (`tabular-nums`).
 *
 * FORBID-LIST (LESSON-033). No shipped class string holds both `font-mono` and
 * `uppercase`, unless it is listed in `ALLOWED` below with the reason it is
 * still there. A new one fails here without anyone editing this file.
 *
 * This reads the SOURCE, one quoted string at a time, because Tailwind class
 * names are the contract and jsdom resolves no stylesheet. Comments are
 * stripped first, so the comment explaining the rule can neither trip it nor
 * satisfy it. A `uppercase` inherited from a parent in another string is
 * invisible to it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const ROOTS = ['apps/light/src', 'packages/ui/src'];

// The literal grammar of the contrast and faint-text contracts: ' and " cannot
// span lines; only a template literal may.
const LITERAL =
  /'([^'\n\\]*(?:\\.[^'\n\\]*)*)'|"([^"\n\\]*(?:\\.[^"\n\\]*)*)"|`((?:\\[\s\S]|[^`\\])*)`/g;

/**
 * Each class by its whole name, with or without a variant in front: `md:uppercase`
 * is still capitals from that width up. Never `font-mono-x` or `normal-case`.
 */
const MONO = /(?<![\w-])font-mono(?![\w-])/;
const CAPITALS = /(?<![\w-])uppercase(?![\w-])/;

/**
 * The mono-capital strings still shipped, each with its reason. Keyed by file
 * AND the exact class string, so moving a line does not break an entry and a
 * new mono-capital string in the same file is still caught.
 */
const ALLOWED: readonly { file: string; classes: string; reason: string }[] = [
  {
    file: 'apps/light/src/app/Sidebar.tsx',
    classes: 'font-mono text-[11px] font-medium tracking-[0.18em] text-ink-inverse-muted uppercase',
    reason:
      'The logo: "LIGHT" under "CViper" is part of the wordmark, not a label, and is kept on ' +
      'purpose.',
  },
];

/**
 * Blank out comments, keeping every newline so line numbers stay true. Only
 * the code's own strings are then read.
 */
export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

interface MonoCapitals {
  readonly file: string;
  readonly line: number;
  readonly classes: string;
}

/** Every quoted string, outside comments, holding both `font-mono` and `uppercase`. */
export function monoCapitals(file: string, source: string): MonoCapitals[] {
  const code = withoutComments(source);
  const found: MonoCapitals[] = [];
  for (const literal of code.matchAll(LITERAL)) {
    const body = literal[1] ?? literal[2] ?? literal[3] ?? '';
    if (!MONO.test(body) || !CAPITALS.test(body)) continue;
    found.push({
      file,
      line: code.slice(0, literal.index).split('\n').length,
      classes: body.replace(/\s+/g, ' ').trim(),
    });
  }
  return found;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const FILES = ROOTS.flatMap((root) => walk(join(REPO, root)));
const MONO_USES = FILES.reduce(
  (count, path) => count + (readFileSync(path, 'utf8').match(/font-mono/g)?.length ?? 0),
  0,
);
const FOUND = FILES.flatMap((path) =>
  monoCapitals(relative(REPO, path).replace(/\\/g, '/'), readFileSync(path, 'utf8')),
);

function allowed(found: MonoCapitals): boolean {
  return ALLOWED.some((entry) => entry.file === found.file && entry.classes === found.classes);
}

describe('labels are not small mono capitals (L-432)', () => {
  it('finds the mono face that exists', () => {
    // Anti-inert: a broken walk would pass everything below.
    expect(FILES.length).toBeGreaterThan(100);
    expect(MONO_USES).toBeGreaterThan(30);
  });

  it('no shipped class string is both font-mono and uppercase, unless listed with a reason', () => {
    const offenders = FOUND.filter((found) => !allowed(found)).map(
      (found) => `${found.file}:${String(found.line)}  "${found.classes}"`,
    );
    expect(
      offenders,
      'A label is words: set it in Inter (text-xs), in normal case. The mono face is for ' +
        'numbers and dates. If it must stay, list it in ALLOWED with why.',
    ).toEqual([]);
  });

  it('no allowlist entry is stale', () => {
    // An entry nothing matches any more would quietly excuse the next string
    // that happens to read the same.
    for (const entry of ALLOWED) {
      expect(
        FOUND.some((found) => found.file === entry.file && found.classes === entry.classes),
        `${entry.file} "${entry.classes}" is allowed but no longer used`,
      ).toBe(true);
      expect(entry.reason.length).toBeGreaterThan(30);
    }
  });

  it('the four labels L-432 changed are not on the list', () => {
    for (const file of [
      'apps/light/src/features/tracker/TrackerColumn.tsx',
      'apps/light/src/features/tracker/FunnelStrip.tsx',
      'apps/light/src/app/StatusStrip.tsx',
    ]) {
      expect(
        ALLOWED.some((entry) => entry.file === file),
        file,
      ).toBe(false);
      expect(
        FOUND.filter((found) => found.file === file),
        file,
      ).toEqual([]);
    }
    // Sidebar.tsx keeps the logo only; the "Ctrl N" hints are not mono at all.
    expect(ALLOWED.filter((entry) => entry.file === 'apps/light/src/app/Sidebar.tsx')).toHaveLength(
      1,
    );
  });

  describe('the check can actually fail', () => {
    it('boundary: a made-up mono-capital label is reported, in either quote and in a template', () => {
      for (const source of [
        `<h2 className="font-mono text-[11px] uppercase">Saved</h2>`,
        `const EYEBROW = 'uppercase tracking-wide font-mono';`,
        'const LABEL = `font-mono ${tone} uppercase`;',
        'const LABEL = `font-mono\n  uppercase`;',
      ]) {
        expect(monoCapitals('x.tsx', source), source).toHaveLength(1);
      }
    });

    it('reports the line it is on', () => {
      expect(monoCapitals('x.tsx', 'a\nb\n"font-mono uppercase"')[0]?.line).toBe(3);
    });

    it('boundary: one inside a comment is ignored, and does not move the line of a real one', () => {
      const commented = [
        '/* the old head was "font-mono text-[11px] uppercase" */',
        '{/* <h2 className="font-mono uppercase"> */}',
        '// const OLD = "font-mono uppercase";',
        '<h2 className="text-xs font-semibold">Saved</h2>',
      ].join('\n');
      expect(monoCapitals('x.tsx', commented)).toEqual([]);

      // A comment cannot stand in for the fix either: the real string is still read.
      const both = `/* now "text-xs font-semibold" */\n<h2 className="font-mono uppercase">`;
      expect(monoCapitals('x.tsx', both)).toEqual([
        { file: 'x.tsx', line: 2, classes: 'font-mono uppercase' },
      ]);
    });

    it('negative: mono alone, capitals alone, or a lookalike class name is not reported', () => {
      for (const classes of [
        'font-mono tabular-nums text-ink',
        'text-xs font-medium uppercase',
        'font-mono normal-case',
        'font-mono-x uppercase',
        'font-mono x-uppercase',
      ]) {
        expect(monoCapitals('x.tsx', `"${classes}"`), classes).toEqual([]);
      }
    });
  });
});
