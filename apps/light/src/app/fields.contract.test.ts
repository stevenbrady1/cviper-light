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
 * THE TWO RULES
 * ============================================================================
 * 1. The constants hold EXACTLY the classes the boxes carried before they moved
 *    onto them, class for class. Adopting a constant must change nothing on
 *    screen, so the values are pinned here, and a new export arrives with a pin
 *    of its own or this fails.
 * 2. A forbid-list: within `SHARED_FOLDERS`, no string in shipped source holds
 *    every class of a shared constant apart from its edge colour (the edge is
 *    often picked by a ternary in a string of its own). That is a hand-made
 *    copy, and it is the thing that drifts. A box that genuinely differs (the
 *    next-action date box, the Tracker search box) does not hold every class,
 *    so it is not caught — and it carries a comment saying why it is
 *    hand-written.
 *
 * Strings are read with the TypeScript parser, so a comment can neither trip
 * the guard nor satisfy it. Each string literal and each fixed part of a
 * template literal is judged on its own, in any class order.
 *
 * `SHARED_FOLDERS` is a list so that the later items (analysis, tailor, search,
 * boards, settings, profile) widen it by one line each as they move.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { displayPath, walk } from '../lib/repo-scan';

import * as fields from './fields';
import { FIELD, FIELD_INVALID } from './fields';

/** `apps/light/src`. */
const SRC = fileURLToPath(new URL('../', import.meta.url));

/** Folders (relative to `apps/light/src`) whose boxes must use `fields.ts`. */
const SHARED_FOLDERS: readonly string[] = ['features/tracker'];

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

const FILES = SHARED_FOLDERS.flatMap((folder) =>
  walk(`${SRC}${folder}`, { extensions: ['.ts', '.tsx'] }),
);

describe('the shared text-box styles hold exactly what the boxes carried (L-365)', () => {
  it('exports these constants and no others, so a new one arrives with a pin', () => {
    expect(Object.keys(fields).sort()).toEqual(['FIELD', 'FIELD_INVALID']);
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

  it('no string in shipped source holds every class of a shared style', () => {
    const offences = FILES.flatMap((path) =>
      handMadeCopies(
        displayPath(path).replace(/^apps\/light\/src\//, ''),
        readFileSync(path, 'utf8'),
      ),
    );
    expect(offences).toEqual([]);
  });

  describe('the checker itself can fail', () => {
    const COPY = (file: string): string =>
      `${file}:1 copies FIELD / FIELD_INVALID by hand; import it from app/fields`;

    it('reads both constants as one shape, differing only in the edge colour', () => {
      expect(SHAPES.map((shape) => shape.names)).toEqual(['FIELD / FIELD_INVALID']);
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
});
