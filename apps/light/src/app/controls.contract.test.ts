/**
 * Every fold, drop-down and tick box wears the house look (L-469).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * The app had three looks for each of these controls: the browser's own ▶ on
 * a fold, the arrow Windows draws on a drop-down, and the plain grey tick box.
 * L-437, L-461 and L-462 to L-469 moved all of them onto one shared look, one
 * at a time. This keeps it that way: a new control that skips the look fails
 * here, naming its file, line and what is missing.
 *
 * ============================================================================
 * WHAT IT FORBIDS (a forbid-list, LESSON-033)
 * ============================================================================
 * In every shipped .ts/.tsx under `apps/light/src` (tests left out), none of
 * these may be present unless listed in `ALLOWED` with a reason:
 *   1. a `<summary>` whose className lacks `list-none` or
 *      `[&::-webkit-details-marker]:hidden` (the browser's ▶ still drawn);
 *   2. a `<summary>` whose first drawn child is not `<FoldMark />`;
 *   3. a `<details>` whose first drawn child is not a `<summary>` (the browser
 *      would draw its own "Details" title and ▶);
 *   4. a `<select>` whose className names neither a `FIELD_SELECT*` constant
 *      nor `FIELD_CHIP` (the `appearance-none` boxes in `fields.ts`; ChipSelect
 *      uses `FIELD_CHIP`);
 *   5. a `<select>` whose next drawn sibling is not `<SelectChevron />`;
 *   6. an `<input type="checkbox">` without both `size-4` and `accent-blue`;
 *   7. an `<input type="checkbox">` with no `<label>` around it that has both
 *      `min-h-11` and `md:min-h-0` (44px for a thumb on a phone);
 *   8. `group-open:` in any string: it turns a closed mark inside an open outer
 *      fold (the L-462 nested-fold bug). `FoldMark` turns for its own fold only.
 *
 * ============================================================================
 * HOW IT READS CODE
 * ============================================================================
 * Comments are blanked first (`withoutComments`, newlines kept so line numbers
 * stay true), so a comment can neither trip the guard nor satisfy it. Then the
 * TypeScript parser reads the JSX: a regular expression cannot find where a tag
 * ends here, because `[details[open]>summary>&]` and `onChange={(e) => …}` both
 * hold a `>`. "Drawn child" skips blank text and the empty `{ }` a blanked JSX
 * comment leaves behind.
 *
 * HONEST LIMITS: a control made with `createElement`, or one whose className
 * arrives through a variable or a prop, is invisible to this. Today there are
 * none. The WebKit checks in `e2e/contrast-webkit.spec.ts` measure the
 * rendered result for the screens they reach.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { displayPath, isTestFile, walk } from '../lib/repo-scan';

type Kind = 'summary' | 'details' | 'select' | 'checkbox' | 'group-open';

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly kind: Kind;
  /** The control's `data-testid` or `id`; its source text when computed. */
  readonly name: string;
  readonly why: string;
}

interface Allowed {
  readonly file: string;
  readonly kind: Kind;
  readonly name: string;
  readonly reason: string;
}

/**
 * Controls that may keep another look. EMPTY on purpose: every one in the app
 * wears the house look today. An entry needs the file (as `displayPath` prints
 * it), the kind, the control's name and a reason a reviewer can check.
 */
const ALLOWED: readonly Allowed[] = [];

/**
 * Blank out comments, keeping every newline so line numbers stay true.
 * Copied from `button-overrides.contract.test.ts`, not imported: importing one
 * test module from another re-registers its suite (see `lib/repo-scan.ts`).
 */
function withoutComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, (comment) => comment.replaceAll(/[^\n]/g, ' '))
    .replaceAll(/(^|\s)\/\/.*$/gm, '$1');
}

const FOLD_OFF = ['list-none', '[&::-webkit-details-marker]:hidden'];
const TICK = ['size-4', 'accent-blue'];
const THUMB = ['min-h-11', 'md:min-h-0'];
const SELECT_STYLE = /\bFIELD_(SELECT(_[A-Z]+)*|CHIP)\b/;

type Tag = ts.JsxElement | ts.JsxSelfClosingElement;

function opening(node: Tag): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

function tagName(node: ts.Node): string | null {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    return opening(node).tagName.getText();
  }
  return null;
}

function attribute(node: Tag, name: string): ts.JsxAttribute | undefined {
  return opening(node).attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

/** A string attribute's value, or the expression's source text when computed. */
function attributeText(node: Tag, name: string): string | null {
  const value = attribute(node, name)?.initializer;
  if (value === undefined) return null;
  if (ts.isStringLiteral(value)) return value.text;
  if (ts.isJsxExpression(value) && value.expression !== undefined) {
    const expression = value.expression;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.text;
    }
    return expression.getText();
  }
  return null;
}

/** Every class written as text in a className (string parts of templates and ternaries too). */
function classTokens(node: Tag): Set<string> {
  const value = attribute(node, 'className')?.initializer;
  const tokens = new Set<string>();
  if (value === undefined) return tokens;
  const visit = (part: ts.Node): void => {
    if (
      ts.isStringLiteral(part) ||
      ts.isNoSubstitutionTemplateLiteral(part) ||
      ts.isTemplateHead(part) ||
      ts.isTemplateMiddle(part) ||
      ts.isTemplateTail(part)
    ) {
      for (const token of part.text.split(/\s+/)) if (token !== '') tokens.add(token);
    }
    ts.forEachChild(part, visit);
  };
  visit(value);
  return tokens;
}

function classSource(node: Tag): string {
  return attribute(node, 'className')?.initializer?.getText() ?? '';
}

/** Children a reader sees: no blank text, no empty `{ }` left by a blanked comment. */
function drawnChildren(children: ts.NodeArray<ts.JsxChild>): ts.JsxChild[] {
  return children.filter((child) => {
    if (ts.isJsxText(child)) return !child.containsOnlyTriviaWhiteSpaces;
    if (ts.isJsxExpression(child)) return child.expression !== undefined;
    return true;
  });
}

function nameOf(node: Tag): string {
  return attributeText(node, 'data-testid') ?? attributeText(node, 'id') ?? '(unnamed)';
}

/** A summary is named by its own id, else its fold's, else its first words. */
function summaryName(node: Tag): string {
  const own = nameOf(node);
  if (own !== '(unnamed)') return own;
  const parent = node.parent;
  if (ts.isJsxElement(parent) && tagName(parent) === 'details') {
    const fold = nameOf(parent);
    if (fold !== '(unnamed)') return fold;
  }
  if (ts.isJsxElement(node)) {
    const text = node.children.find(
      (child): child is ts.JsxText => ts.isJsxText(child) && !child.containsOnlyTriviaWhiteSpaces,
    );
    if (text !== undefined) return text.text.trim().replaceAll(/\s+/g, ' ').slice(0, 40);
  }
  return own;
}

function missing(tokens: Set<string>, wanted: readonly string[]): string[] {
  return wanted.filter((name) => !tokens.has(name));
}

interface Scan {
  readonly findings: Finding[];
  readonly counts: Record<'summary' | 'select' | 'checkbox', number>;
}

/** Every offence in one file's source. Exported only to this file's own tests. */
function scan(file: string, raw: string): Scan {
  const source = withoutComments(raw);
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const findings: Finding[] = [];
  const counts = { summary: 0, select: 0, checkbox: 0 };
  const report = (node: ts.Node, what: Kind, name: string, why: string): void => {
    const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
    findings.push({ file, line, kind: what, name, why });
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)) &&
      node.text.includes('group-open:')
    ) {
      report(
        node,
        'group-open',
        node.text.trim().slice(0, 40),
        'uses group-open:, which turns a closed mark inside an open outer fold; use <FoldMark /> instead',
      );
    }

    const tag = tagName(node);
    if (tag !== null) {
      const element = node as Tag;

      if (tag === 'summary') {
        counts.summary += 1;
        const name = summaryName(element);
        const off = missing(classTokens(element), FOLD_OFF);
        if (off.length > 0) {
          report(
            node,
            'summary',
            name,
            `the browser's fold mark is still drawn (className lacks ${off.join(' and ')})`,
          );
        }
        const first = ts.isJsxElement(element) ? drawnChildren(element.children)[0] : undefined;
        if (first === undefined || tagName(first) !== 'FoldMark') {
          report(node, 'summary', name, 'its first drawn child is not <FoldMark />');
        }
      }

      if (tag === 'details') {
        const first = ts.isJsxElement(element) ? drawnChildren(element.children)[0] : undefined;
        if (first === undefined || tagName(first) !== 'summary') {
          report(
            node,
            'details',
            nameOf(element),
            'its first drawn child is not a <summary>, so the browser draws its own title and mark',
          );
        }
      }

      if (tag === 'select') {
        counts.select += 1;
        const name = nameOf(element);
        if (!SELECT_STYLE.test(classSource(element))) {
          report(
            node,
            'select',
            name,
            "the browser's arrow is still drawn (className names no FIELD_SELECT* constant or FIELD_CHIP, so no appearance-none)",
          );
        }
        const parent = element.parent;
        const siblings =
          ts.isJsxElement(parent) || ts.isJsxFragment(parent) ? drawnChildren(parent.children) : [];
        const next = siblings[siblings.indexOf(element as ts.JsxChild) + 1];
        if (next === undefined || tagName(next) !== 'SelectChevron') {
          report(node, 'select', name, 'its next drawn sibling is not <SelectChevron />');
        }
      }

      if (tag === 'input' && attributeText(element, 'type') === 'checkbox') {
        counts.checkbox += 1;
        const name = nameOf(element);
        const off = missing(classTokens(element), TICK);
        if (off.length > 0) {
          report(
            node,
            'checkbox',
            name,
            `not the house tick box (className lacks ${off.join(' and ')})`,
          );
        }
        let label: ts.Node | undefined = element.parent;
        while (label !== undefined && tagName(label) !== 'label') label = label.parent;
        if (label === undefined || missing(classTokens(label as Tag), THUMB).length > 0) {
          report(
            node,
            'checkbox',
            name,
            'no <label> around it with min-h-11 and md:min-h-0 (a 44px target on a phone)',
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return { findings, counts };
}

function allowedFor(finding: Finding): Allowed | undefined {
  return ALLOWED.find(
    (entry) =>
      entry.file === finding.file && entry.kind === finding.kind && entry.name === finding.name,
  );
}

function describeFinding(finding: Finding): string {
  return `${finding.file}:${finding.line} ${finding.kind} "${finding.name}": ${finding.why}`;
}

const SRC = fileURLToPath(new URL('../', import.meta.url));
const FILES = walk(SRC, { extensions: ['.ts', '.tsx'] });
const RESULTS = FILES.map((path) => scan(displayPath(path), readFileSync(path, 'utf8')));
const FINDINGS = RESULTS.flatMap((result) => result.findings);
const total = (key: keyof Scan['counts']): number =>
  RESULTS.reduce((sum, result) => sum + result.counts[key], 0);

const HOW_TO_FIX =
  'Fold: summary className gets "list-none [&::-webkit-details-marker]:hidden" and <FoldMark /> comes first. ' +
  'Drop-down: a relative wrapper, className from FIELD_SELECT (or ChipSelect), <SelectChevron /> straight after. ' +
  'Tick box: "size-4 accent-blue" on the input, "min-h-11 … md:min-h-0" on its label. ' +
  'If one truly must differ, list it in ALLOWED with a reason.';

describe('the walk is not inert', () => {
  it('reads the shipped source, and no test files', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.filter((path) => isTestFile(path))).toEqual([]);
  });

  it('finds the controls the app is known to hold', () => {
    // A broken walk or a mangled parse finds nothing and passes everything.
    expect(total('summary')).toBeGreaterThanOrEqual(9);
    expect(total('select')).toBeGreaterThanOrEqual(13);
    expect(total('checkbox')).toBeGreaterThanOrEqual(8);
  });
});

describe('every fold, drop-down and tick box wears the house look', () => {
  it('has no offence outside ALLOWED', () => {
    const offences = FINDINGS.filter((finding) => allowedFor(finding) === undefined);
    expect(offences.map(describeFinding), HOW_TO_FIX).toEqual([]);
  });

  it('keeps no stale or unexplained ALLOWED entry', () => {
    for (const entry of ALLOWED) {
      expect(entry.reason.trim().length, `${entry.file} ${entry.name}`).toBeGreaterThan(30);
      expect(
        FINDINGS.some((finding) => allowedFor(finding) === entry),
        `${entry.file} ${entry.kind} "${entry.name}" matches nothing any more: delete it`,
      ).toBe(true);
    }
  });
});

/** The reasons found in a synthetic source, as `kind name: why` lines. */
function offencesIn(source: string): string[] {
  return scan('Synthetic.tsx', source).findings.map(
    (finding) => `${finding.kind} ${finding.name}: ${finding.why}`,
  );
}

describe('the check can fail', () => {
  it('negative: a bare fold reports both the mark still on and no FoldMark', () => {
    const found = offencesIn(
      'export const A = () => <details data-testid="f"><summary>Hi</summary></details>;',
    );
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/^summary f: the browser's fold mark is still drawn/);
    expect(found[1]).toMatch(/^summary f: its first drawn child is not <FoldMark \/>/);
  });

  it('negative: a FoldMark that is not first is reported', () => {
    const found = offencesIn(
      'export const A = () => <details><summary className="list-none [&::-webkit-details-marker]:hidden">Hi <FoldMark /></summary></details>;',
    );
    expect(found).toEqual(['summary Hi: its first drawn child is not <FoldMark />']);
  });

  it('negative: a fold with no summary first is reported', () => {
    const found = offencesIn('export const A = () => <details id="d"><p>Body</p></details>;');
    expect(found).toEqual([
      'details d: its first drawn child is not a <summary>, so the browser draws its own title and mark',
    ]);
  });

  it('negative: a select on FIELD, and one on FIELD_SELECT with no chevron, are each reported by name', () => {
    const found = offencesIn(`
      export const A = () => (
        <div>
          <span className="relative"><select data-testid="plain" className={FIELD}></select><SelectChevron /></span>
          <span className="relative"><select id={pickerId} className={\`\${FIELD_SELECT} w-full\`}></select></span>
        </div>
      );`);
    expect(found).toEqual([
      "select plain: the browser's arrow is still drawn (className names no FIELD_SELECT* constant or FIELD_CHIP, so no appearance-none)",
      'select pickerId: its next drawn sibling is not <SelectChevron />',
    ]);
  });

  it('negative: a bare tick box has two offences, a house tick in a desktop-only label one', () => {
    const found = offencesIn(`
      export const A = () => (
        <div>
          <label><input type="checkbox" data-testid={\`toggle-\${id}\`} /></label>
          <label className="flex gap-2"><input type="checkbox" id="b" className="mt-1 size-4 accent-blue" /></label>
        </div>
      );`);
    expect(found).toEqual([
      'checkbox `toggle-${id}`: not the house tick box (className lacks size-4 and accent-blue)',
      'checkbox `toggle-${id}`: no <label> around it with min-h-11 and md:min-h-0 (a 44px target on a phone)',
      'checkbox b: no <label> around it with min-h-11 and md:min-h-0 (a 44px target on a phone)',
    ]);
  });

  it('negative: group-open: in a plain string is reported', () => {
    expect(offencesIn("export const TURN = 'group-open:rotate-90';")).toEqual([
      'group-open group-open:rotate-90: uses group-open:, which turns a closed mark inside an open outer fold; use <FoldMark /> instead',
    ]);
  });

  it('boundary: the house look passes, in every shape the app writes it', () => {
    const found = offencesIn(`
      export const A = ({ bad }: { bad: boolean }) => (
        <>
          <details data-testid="fold" className="[details[open]>summary>&]:mt-1">
            {/* why the mark is drawn */}
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <FoldMark />
              Where to look
            </summary>
          </details>
          <span className="relative mt-1 block">
            <select
              id="s"
              onChange={(e) => pick(e.currentTarget.value)}
              className={\`\${bad ? FIELD_SELECT_INVALID : FIELD_SELECT} w-full\`}
            >
              <option>One</option>
            </select>
            {/* the arrow sits over the padding */}
            <SelectChevron />
          </span>
          <span className="relative"><select className={\`\${FIELD_CHIP} min-w-0\`} /><SelectChevron /></span>
          <label className="flex min-h-11 items-start gap-2 md:min-h-0">
            <span><input type="checkbox" className="mt-1 size-4 accent-blue" /></span>
            Tick me
          </label>
          <label><input type="radio" name="r" /></label>
        </>
      );`);
    expect(found).toEqual([]);
  });

  it('comments: a control in a comment trips nothing, and a commented-out FoldMark does not count', () => {
    expect(
      offencesIn(`
        // <select className={FIELD}>
        /* <summary>Hi</summary> group-open:rotate-90 <input type="checkbox" /> */
        export const A = 1;`),
    ).toEqual([]);
    expect(
      offencesIn(
        'export const A = () => <details><summary className="list-none [&::-webkit-details-marker]:hidden">{/* <FoldMark /> */}Hi</summary></details>;',
      ),
    ).toEqual(['summary Hi: its first drawn child is not <FoldMark />']);
  });
});
