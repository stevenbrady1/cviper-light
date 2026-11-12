/**
 * The shared text-box style lives in `fields.ts`, and only there (L-365).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Most of the app's 55 text boxes repeated the same base classes by hand and
 * differed only in layout. A change to how a text box looks meant editing every
 * copy, and copies drift: the date box, the search box and the stage editor
 * each grew a slightly different set. `fields.ts` holds the base once.
 *
 * ============================================================================
 * THE THREE RULES
 * ============================================================================
 * 1. The constants hold EXACTLY the classes the boxes carried before they moved
 *    onto them, class for class. Adopting a constant must change nothing on
 *    screen, so the values are pinned here, and a new export arrives with a pin
 *    of its own or this fails.
 * 2. A forbid-list: anywhere in the app's shipped source (every non-test
 *    .ts/.tsx under `apps/light/src`, L-379; it was three folders before), no
 *    string holds every class of a shared constant apart from its edge colour
 *    (the edge is often picked by a ternary in a string of its own). That is a
 *    hand-made copy, and it is the thing that drifts. `fields.ts` itself is
 *    the one file left out: it is where the classes live.
 * 3. A forbid-list on the edge (L-379): `border-field-line` is the text box's
 *    edge colour, made for text boxes (L-212), so a string outside `fields.ts`
 *    that names it is a hand-written text box. Rule 2 cannot see one that
 *    genuinely differs (it lacks a class of the base), so each of those is
 *    listed in `HAND_WRITTEN` with its file, its exact class text and why. An
 *    entry excuses those classes in that file and nothing else, and must match
 *    EXACTLY ONCE: a stale entry (the box moved or changed) fails, and so does
 *    a second copy in the same file (a new box needs its own decision). Each
 *    such box also carries a comment at the call site saying why.
 *
 * Strings are read with the TypeScript parser, so a comment can neither trip
 * the guard nor satisfy it. Each string literal and each fixed part of a
 * template literal is judged on its own, in any class order.
 *
 * Checkboxes, radios, range and file inputs are a different kind of control:
 * they carry none of these classes (today: `size-4 accent-blue`, `mt-1`, or no
 * className), so neither rule touches them, and the field-edge contrast check
 * skips them by their literal `type` (its `BOXLESS_INPUTS`).
 *
 * HONEST LIMITS: a box styled from a class list built at run time, or one that
 * takes another edge colour entirely, is not a copy by these rules. The second
 * is still judged by the field-edge contrast check (3:1 on every surface).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { displayPath, walk } from '../lib/repo-scan';

import * as fields from './fields';
import { FIELD, FIELD_COMPACT, FIELD_INVALID } from './fields';

/** `apps/light/src`. */
const SRC = fileURLToPath(new URL('../', import.meta.url));

/**
 * The one shipped file allowed to hold the shared classes: their home. Every
 * other non-test .ts/.tsx under `apps/light/src` is scanned (L-379). It was
 * `SHARED_FOLDERS`, three folders wide, while the screens moved one by one.
 */
const HOME = 'app/fields.ts';

/** The text box's edge colour (L-212). Outside `HOME`, only `HAND_WRITTEN` may name it. */
const FIELD_EDGE = 'border-field-line';

/** A box that stays hand-written on purpose. */
interface HandWritten {
  /** Relative to `apps/light/src`. */
  readonly file: string;
  /** The exact class text of the string that names the edge, in its order. */
  readonly text: string;
  readonly reason: string;
}

/** Every text box that is NOT on a shared style, and why. Each must match exactly once. */
const HAND_WRITTEN: readonly HandWritten[] = [
  {
    file: 'features/tracker/TrackerBoard.tsx',
    text: 'min-h-11 min-w-0 flex-1 rounded-control border border-field-line bg-card px-3 py-2 text-ink placeholder:text-ink-faint focus:border-blue focus:outline-none md:min-h-0',
    reason:
      'The Tracker search box (L-365) is bigger than FIELD: px-3 py-2 instead of px-2.5 py-1.5, ' +
      'a 44px phone height (min-h-11 md:min-h-0), a fainter placeholder and a blue focus edge.',
  },
  {
    file: 'features/tracker/ApplicationDetail.tsx',
    text: 'mt-1 w-full rounded-control border border-field-line bg-card px-2.5 py-1.5',
    reason:
      'The next-action date box (L-365) takes its text colour from NEXT_ACTION_TONES (faint, ' +
      'gold or danger by urgency), which would clash with the text-ink inside FIELD.',
  },
];

function classesOf(style: string): string[] {
  return style.split(/\s+/).filter((name) => name !== '');
}

/** Every string literal and fixed template part in a file, with its line. */
function stringsIn(file: string, source: string): { text: string; line: number }[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const found: { text: string; line: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
      found.push({ text: node.text, line });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

const SHARED = Object.entries(fields);

/**
 * What marks a copy: a shared style's classes WITHOUT its edge colour. The
 * edge is often the part chosen by a ternary (`'border-field-line' :
 * 'border-danger'`), so a copy whose colour sits in a separate string is still
 * a copy. Styles with the same shape share one entry, named together.
 */
const SHAPES: { names: string; classes: string[] }[] = [];
for (const [name, style] of SHARED) {
  const classes = classesOf(style).filter((cls) => !cls.startsWith('border-'));
  const same = SHAPES.find((shape) => shape.classes.join(' ') === classes.join(' '));
  if (same === undefined) SHAPES.push({ names: name, classes });
  else same.names = `${same.names} / ${name}`;
}

/** Every hand-made copy of a shared style in one file: `file:line copies NAME`. */
function handMadeCopies(file: string, source: string): string[] {
  const offences: string[] = [];
  for (const { text, line } of stringsIn(file, source)) {
    const present = new Set(classesOf(text));
    for (const { names, classes } of SHAPES) {
      if (classes.every((cls) => present.has(cls))) {
        offences.push(`${file}:${line} copies ${names} by hand; import it from app/fields`);
      }
    }
  }
  return offences;
}

/** One shipped file: its path relative to `apps/light/src`, and its text. */
interface SourceFile {
  readonly path: string;
  readonly source: string;
}

interface EdgeReport {
  /** `file:line names border-field-line by hand: "…"`, one per unexcused string. */
  readonly offences: readonly string[];
  /** Hand-written entries that did not match exactly once. */
  readonly stale: readonly string[];
}

/** Rule 3, pure, so it can be shown failing on made-up files. */
function handWrittenEdges(
  files: readonly SourceFile[],
  kept: readonly HandWritten[] = HAND_WRITTEN,
): EdgeReport {
  const offences: string[] = [];
  const matched = new Map<HandWritten, number>(kept.map((entry) => [entry, 0]));
  for (const { path, source } of files) {
    for (const { text, line } of stringsIn(path, source)) {
      const classes = classesOf(text);
      // The edge behind a state variant (`focus:` and the like) names it too.
      if (!classes.some((cls) => cls.split(':').pop() === FIELD_EDGE)) continue;
      const entry = kept.find(
        (one) => one.file === path && classesOf(one.text).join(' ') === classes.join(' '),
      );
      if (entry === undefined) {
        offences.push(
          `${path}:${String(line)} names ${FIELD_EDGE} by hand: "${classes.join(' ')}"; use app/fields, or list it in HAND_WRITTEN with a reason`,
        );
      } else {
        matched.set(entry, (matched.get(entry) ?? 0) + 1);
      }
    }
  }
  const stale = kept
    .filter((entry) => matched.get(entry) !== 1)
    .map(
      (entry) =>
        `${entry.file}: "${entry.text}" matched ${String(matched.get(entry))} times, not exactly once`,
    );
  return { offences, stale };
}

function relativeToSrc(path: string): string {
  return displayPath(path).replace(/^apps\/light\/src\//, '');
}

/** Every shipped .ts/.tsx under `apps/light/src` (tests excluded by `walk`), except `HOME`. */
const FILES = walk(SRC, { extensions: ['.ts', '.tsx'] }).filter(
  (path) => relativeToSrc(path) !== HOME,
);

function shipped(): SourceFile[] {
  return FILES.map((path) => ({ path: relativeToSrc(path), source: readFileSync(path, 'utf8') }));
}

describe('the shared text-box styles hold exactly what the boxes carried (L-365)', () => {
  it('exports these constants and no others, so a new one arrives with a pin', () => {
    expect(Object.keys(fields).sort()).toEqual(['FIELD', 'FIELD_COMPACT', 'FIELD_INVALID']);
  });

  it('FIELD is the standard box, class for class', () => {
    expect(classesOf(FIELD)).toEqual([
      'rounded-control',
      'border',
      'border-field-line',
      'bg-card',
      'px-2.5',
      'py-1.5',
      'text-ink',
    ]);
  });

  it('FIELD_INVALID is the same box with the danger edge, class for class', () => {
    expect(classesOf(FIELD_INVALID)).toEqual([
      'rounded-control',
      'border',
      'border-danger',
      'bg-card',
      'px-2.5',
      'py-1.5',
      'text-ink',
    ]);
  });

  it('the two differ in the edge colour and nothing else', () => {
    const valid = new Set(classesOf(FIELD));
    const invalid = new Set(classesOf(FIELD_INVALID));
    expect([...valid].filter((name) => !invalid.has(name))).toEqual(['border-field-line']);
    expect([...invalid].filter((name) => !valid.has(name))).toEqual(['border-danger']);
  });

  it('FIELD_COMPACT is the smaller picker box, class for class (L-376)', () => {
    expect(classesOf(FIELD_COMPACT)).toEqual([
      'rounded-control',
      'border',
      'border-field-line',
      'bg-card',
      'px-2.5',
      'py-1',
      'text-ink',
    ]);
  });

  it('FIELD_COMPACT differs from FIELD in the vertical padding and nothing else (L-376)', () => {
    const standard = new Set(classesOf(FIELD));
    const compact = new Set(classesOf(FIELD_COMPACT));
    expect([...standard].filter((name) => !compact.has(name))).toEqual(['py-1.5']);
    expect([...compact].filter((name) => !standard.has(name))).toEqual(['py-1']);
  });

  it.each(SHARED)('%s carries no layout, which stays at the call site', (_name, style) => {
    const layout = /^-?(?:m[trblxy]?|w|h|min-[wh]|max-[wh]|flex|basis|grow|shrink|self|order)-/;
    expect(classesOf(style).filter((name) => layout.test(name))).toEqual([]);
  });

  it.each(SHARED)('%s has no repeated class', (_name, style) => {
    expect(new Set(classesOf(style)).size).toBe(classesOf(style).length);
  });
});

describe('no box in a shared folder copies the style by hand (L-365)', () => {
  it('finds the files, so this contract cannot pass by reading nothing', () => {
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES.some((path) => path.endsWith('NewApplicationForm.tsx'))).toBe(true);
  });

  it('reads the analysis and tailor folders too (L-376)', () => {
    expect(FILES.some((path) => path.endsWith('AnalysisAdvert.tsx'))).toBe(true);
    expect(FILES.some((path) => path.endsWith('TailorAdvert.tsx'))).toBe(true);
  });

  it('no string in shipped source holds every class of a shared style', () => {
    const offences = FILES.flatMap((path) =>
      handMadeCopies(
        displayPath(path).replace(/^apps\/light\/src\//, ''),
        readFileSync(path, 'utf8'),
      ),
    );
    expect(offences).toEqual([]);
  });

  it('scans the whole app: every folder that can hold a text box, and no test file (L-379)', () => {
    const names = FILES.map(relativeToSrc);
    expect(names.length).toBeGreaterThan(200);
    for (const known of [
      'features/search/SearchFields.tsx',
      'features/search/SearchSaved.tsx',
      'features/boards/BoardSettings.tsx',
      'features/settings/keys/AiKeySetup.tsx',
      'features/settings/keys/CustomServiceCard.tsx',
      'features/settings/keys/KeySetup.tsx',
      'features/profile/ProfileForm.tsx',
      'features/onboarding/Welcome.tsx',
      'features/tracker/TrackerBoard.tsx',
      'app/App.tsx',
    ]) {
      expect(names, known).toContain(known);
    }
    expect(names.some((name) => /\.test\.tsx?$/.test(name))).toBe(false);
    expect(names).not.toContain(HOME);
  });

  it('forbid-list: no string outside fields.ts names the field edge, bar the reasoned hand-written boxes (L-379)', () => {
    expect(handWrittenEdges(shipped()).offences).toEqual([]);
  });

  it('every hand-written box is still there, exactly once (L-379)', () => {
    expect(handWrittenEdges(shipped()).stale).toEqual([]);
  });

  it('every hand-written box names the field edge, is not a copy, and says why (L-379)', () => {
    for (const entry of HAND_WRITTEN) {
      const label = `${entry.file}: ${entry.text}`;
      expect(classesOf(entry.text), label).toContain(FIELD_EDGE);
      expect(handMadeCopies(entry.file, `const A = '${entry.text}';`), label).toEqual([]);
      expect(entry.reason.length, label).toBeGreaterThan(40);
    }
  });

  describe('the checker itself can fail', () => {
    const COPY = (file: string): string =>
      `${file}:1 copies FIELD / FIELD_INVALID by hand; import it from app/fields`;

    it('reads both constants as one shape, differing only in the edge colour', () => {
      expect(SHAPES.map((shape) => shape.names)).toEqual([
        'FIELD / FIELD_INVALID',
        'FIELD_COMPACT',
      ]);
    });

    it('negative: catches the compact base pasted into a className, named as FIELD_COMPACT (L-376)', () => {
      const source = `export const A = () => <select className="min-w-0 flex-1 ${FIELD_COMPACT}" />;`;
      expect(handMadeCopies('a.tsx', source)).toEqual([
        'a.tsx:1 copies FIELD_COMPACT by hand; import it from app/fields',
      ]);
    });

    it('negative: catches a compact copy in another class order (L-376)', () => {
      const shuffled = [...classesOf(FIELD_COMPACT)].reverse().join(' ');
      expect(handMadeCopies('a.ts', `const PICK = 'min-w-0 ${shuffled}';`)).toEqual([
        'a.ts:1 copies FIELD_COMPACT by hand; import it from app/fields',
      ]);
    });

    it('boundary: the standard base is not read as a compact copy, nor the compact as standard (L-376)', () => {
      expect(handMadeCopies('a.ts', `const A = '${FIELD}';`)).toEqual([COPY('a.ts')]);
      expect(handMadeCopies('a.ts', `const A = '${FIELD_COMPACT}';`)).toEqual([
        'a.ts:1 copies FIELD_COMPACT by hand; import it from app/fields',
      ]);
    });

    it('boundary: FIELD_COMPACT used at the call site is not a copy (L-376)', () => {
      const source =
        'export const A = () => <select className={`${FIELD_COMPACT} min-w-0 flex-1`} />;';
      expect(handMadeCopies('a.tsx', source)).toEqual([]);
    });

    it('negative: catches the base string pasted into a className', () => {
      const source = `export const A = () => <input className="mt-1 w-full ${FIELD}" />;`;
      expect(handMadeCopies('a.tsx', source)).toEqual([COPY('a.tsx')]);
    });

    it('negative: catches a copy in another class order, inside a template literal', () => {
      const shuffled = [...classesOf(FIELD_INVALID)].reverse().join(' ');
      const source = `export const A = (x: string) => <textarea className={\`\${x} ${shuffled}\`} />;`;
      expect(handMadeCopies('a.tsx', source)).toEqual([COPY('a.tsx')]);
    });

    it('negative: catches a copy in a plain constant, not only in JSX', () => {
      expect(handMadeCopies('a.ts', `const BOX = '${FIELD} placeholder:text-ink-muted';`)).toEqual([
        COPY('a.ts'),
      ]);
    });

    it('negative: catches a copy whose edge colour is chosen in a separate string', () => {
      const shape = classesOf(FIELD)
        .filter((cls) => cls !== 'border-field-line')
        .join(' ');
      const source = `export const A = (e?: string) => <select className={\`mt-1 w-full ${shape} \${e === undefined ? 'border-field-line' : 'border-danger'}\`} />;`;
      expect(handMadeCopies('a.tsx', source)).toEqual([COPY('a.tsx')]);
    });

    it('a comment can neither trip the guard nor satisfy it', () => {
      const source = [
        `// className="${FIELD}"`,
        `/* ${FIELD_INVALID} */`,
        'export const A = () => <input className={FIELD} />;',
      ].join('\n');
      expect(handMadeCopies('a.tsx', source)).toEqual([]);
    });

    it('boundary: a box missing one class of the base is not a copy (the date box shape)', () => {
      const withoutText = classesOf(FIELD)
        .filter((name) => name !== 'text-ink')
        .join(' ');
      const source = `export const A = (t: string) => <input className={\`mt-1 w-full ${withoutText} \${t}\`} />;`;
      expect(handMadeCopies('a.tsx', source)).toEqual([]);
    });

    it('boundary: the constants used at the call site are not copies', () => {
      const source =
        'export const A = (b: boolean) => <input className={`mt-1 w-full ${b ? FIELD_INVALID : FIELD}`} />;';
      expect(handMadeCopies('a.tsx', source)).toEqual([]);
    });
  });

  describe('the hand-written-edge checker can fail (L-379)', () => {
    const FILE = 'features/search/Elsewhere.tsx';
    const BIG =
      'min-h-11 rounded-control border border-field-line bg-card px-3 py-2 text-ink focus:border-blue';
    const KEEP_BIG: HandWritten = {
      file: FILE,
      text: BIG,
      reason: 'a made-up hand-written box for these tests, long enough to be a reason',
    };
    const edges = (source: string, kept: readonly HandWritten[] = []): EdgeReport =>
      handWrittenEdges([{ path: FILE, source }], kept);

    it('negative: a box that differs from FIELD, unlisted, is reported with its file and line', () => {
      const source = `export const A = () => (\n  <input className="${BIG}" />\n);`;
      expect(edges(source).offences).toEqual([
        `${FILE}:2 names border-field-line by hand: "${BIG}"; use app/fields, or list it in HAND_WRITTEN with a reason`,
      ]);
    });

    it('negative: the edge chosen by a ternary, in a string of its own, is reported', () => {
      const source =
        "export const A = (bad: boolean) => <input className={`mt-1 ${bad ? 'border-danger' : 'border-field-line'}`} />;";
      expect(edges(source).offences).toHaveLength(1);
    });

    it('negative: the edge behind a state variant is reported', () => {
      // Built, not typed: Tailwind reads test files too, and a typed
      // `focus:` edge class here would add a rule to the shipped stylesheet.
      const focusEdge = ['focus', FIELD_EDGE].join(':');
      expect(edges(`const A = 'border border-line ${focusEdge}';`).offences).toHaveLength(1);
    });

    it('a comment naming the edge neither trips the check nor satisfies an entry', () => {
      const report = edges(
        `// className="${BIG}"\nexport const A = () => <input className={FIELD} />;`,
        [KEEP_BIG],
      );
      expect(report.offences).toEqual([]);
      expect(report.stale).toHaveLength(1);
    });

    it('boundary: an entry excuses its exact class text in its file, and nothing else', () => {
      expect(edges(`const A = '${BIG}';`, [KEEP_BIG])).toEqual({ offences: [], stale: [] });
      // The same classes in another order, or with one more, are a new box.
      const reordered = classesOf(BIG).reverse().join(' ');
      expect(edges(`const A = '${reordered}';`, [KEEP_BIG]).offences).toHaveLength(1);
      expect(edges(`const A = '${BIG} w-full';`, [KEEP_BIG]).offences).toHaveLength(1);
    });

    it('boundary: an entry excuses nothing in another file', () => {
      const report = handWrittenEdges(
        [{ path: 'features/profile/Other.tsx', source: `const A = '${BIG}';` }],
        [KEEP_BIG],
      );
      expect(report.offences).toHaveLength(1);
      expect(report.stale).toHaveLength(1);
    });

    it('a stale entry fails, and so does a second copy of its box', () => {
      expect(edges('export const a = 1;', [KEEP_BIG]).stale).toEqual([
        `${FILE}: "${BIG}" matched 0 times, not exactly once`,
      ]);
      expect(edges(`const A = '${BIG}';\nconst B = '${BIG}';`, [KEEP_BIG]).stale).toEqual([
        `${FILE}: "${BIG}" matched 2 times, not exactly once`,
      ]);
    });

    it('boundary: a box on the shared constants names no edge by hand', () => {
      const source =
        'export const A = (b: boolean) => <input className={`${b ? FIELD_INVALID : FIELD} mt-1 w-full`} />;';
      expect(edges(source)).toEqual({ offences: [], stale: [] });
    });
  });
});
