/**
 * One error box, not one per screen (L-380).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * About twenty red error messages were each built by hand, in two shapes: a
 * strip under a screen's header and a box inside a panel. Copies drift —
 * Profile's strip had a grey line where the others had a red one, and the stage
 * editor's box grew a border none of the others have — and none of them broke
 * a word too long for its line, so a file path ran off the edge. L-368, L-374,
 * L-377 and L-380 moved every one onto `ui/ErrorBox.tsx`. This check keeps a
 * new hand-built copy out.
 *
 * ============================================================================
 * WHAT COUNTS AS A HAND-BUILT ERROR BOX — A FORBID-LIST (LESSON-033)
 * ============================================================================
 * Outside `ui/ErrorBox.tsx`, in shipped source under `apps/light/src` and
 * `packages/ui/src`:
 *
 *   ALERT   an element with `role="alert"` whose classes include a danger-
 *           tinted background (`bg-danger/<n>`). That is an error box,
 *           whatever its padding or corners.
 *   COPY    an element whose classes hold EVERY class of the strip's or the
 *           box's base set (below), with or without a role. A box that drops
 *           `role="alert"` is still a copy — and an error a screen reader no
 *           longer hears.
 *   STRING  a string, anywhere outside a `className`, that holds every class
 *           of a base set: a copy kept in a constant to be handed on.
 *
 * Plain red text (`text-danger` on no tint) is not a box and is not flagged.
 *
 * And for the shared part's own row strip:
 *
 *   ROW     every `<ErrorBox variant="strip" layout="row">` must hold its
 *           message in a `<span>` that is its FIRST child and carries
 *           `min-w-0` (in every class list it can have). A flex item is never
 *           narrower than its longest word unless told, so without it a long
 *           path pushes the Retry button off screen however the words may
 *           break (L-374). A row strip whose first child is anything else — a
 *           bare `{message}`, a component, a fragment — is a NAMED failure: the
 *           check cannot see a message that may shrink.
 *
 * ============================================================================
 * HOW IT READS — THE PARSE TREE, NOT THE TEXT
 * ============================================================================
 * Each file is parsed with TypeScript, so comments can neither trip the check
 * nor satisfy it, and test files are never read (`walk` drops them). A
 * `className` is EVALUATED, the way `styles/contrast.contract.test.ts` reads
 * one: string and template literals, `+`, both branches of a ternary, `||`,
 * `??`, `&&`, constants in the same file, constants imported from a relative
 * path (re-exports and index files included) and lookups into a constant
 * object. Anything else — a function call, a prop, a parameter — is
 * UNREADABLE, and on an alert, or beside a danger tint, that is a named
 * failure, never a pass: the part it cannot read could be the tint.
 *
 * ============================================================================
 * EXCEPTIONS — EACH NAMED, EACH MATCHING EXACTLY ONCE
 * ============================================================================
 * `LOOK_ALIKES` excuses a COPY that is deliberately not an alert (the update
 * check's "could not check"). It names the file and the exact class list, and
 * excuses only that list in that file — never an ALERT. `UNREAD_ALLOWED`
 * excuses a class expression the reader cannot evaluate, named by file and
 * exact text, with the number of times it appears. A stale entry fails, and so
 * does an extra copy.
 */
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, walk } from './repo-scan';

/** The one file allowed to draw an error box. */
const SHARED = 'apps/light/src/ui/ErrorBox.tsx';

/**
 * The base classes of the two shapes, as every hand-built copy carried them
 * (L-368's survey). Written out, not imported: the check must not agree with
 * whatever the component says. `the shared part is caught` keeps them honest.
 */
export const STRIP_BASE: readonly string[] = [
  'border-b',
  'bg-danger/5',
  'px-4',
  'py-2',
  'text-danger',
];
export const BOX_BASE: readonly string[] = [
  'rounded-control',
  'bg-danger/5',
  'px-3',
  'py-2',
  'text-danger',
];

/** A danger-tinted background: `bg-danger/5`, `bg-danger/10`, … Not `bg-danger` (a button). */
const DANGER_TINT = /^bg-danger\/\d+$/;

/** More combinations than this is a class list nobody could check by eye either. */
const MAX_CLASS_LISTS = 256;

// ── What the check reports ──────────────────────────────────────────────────

export type Rule =
  'ALERT' | 'COPY of BOX' | 'COPY of STRIP' | 'STRING holds BOX' | 'STRING holds STRIP';

export interface Offence {
  readonly file: string;
  readonly line: number;
  /** `<p data-testid="…">`, or `a string` for a STRING offence. */
  readonly where: string;
  readonly rules: readonly Rule[];
  /** The class list (or the string) that matched, whitespace collapsed. */
  readonly classes: string;
}

export interface Unread {
  readonly file: string;
  readonly line: number;
  /** The exact source text the reader could not evaluate, whitespace collapsed. */
  readonly text: string;
  readonly why: string;
}

export interface RowStrip {
  readonly file: string;
  readonly line: number;
  readonly testId: string;
  /** Why the message cannot shrink, or `null` when it can. */
  readonly problem: string | null;
}

/** Every `role="alert"` element seen outside the shared part: the survey, for the negative checks. */
export interface AlertSeen {
  readonly file: string;
  readonly line: number;
  readonly tag: string;
  readonly testId: string | null;
}

export interface Scan {
  readonly files: number;
  readonly offences: readonly Offence[];
  readonly unread: readonly Unread[];
  readonly rowStrips: readonly RowStrip[];
  readonly alerts: readonly AlertSeen[];
}

export interface SourceFile {
  /** From the repository root, forward slashes. */
  readonly path: string;
  readonly source: string;
}

// ── Reading a className, across files ───────────────────────────────────────

interface Module {
  readonly path: string;
  readonly tree: ts.SourceFile;
  readonly locals: ReadonlyMap<string, readonly ts.Expression[]>;
  readonly imports: ReadonlyMap<string, { readonly from: string; readonly name: string }>;
  readonly exports: ReadonlyMap<string, string>;
  readonly reexports: ReadonlyMap<string, { readonly from: string; readonly name: string }>;
  readonly stars: readonly string[];
}

function parseModule(path: string, source: string): Module {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const locals = new Map<string, ts.Expression[]>();
  const imports = new Map<string, { from: string; name: string }>();
  const exports = new Map<string, string>();
  const reexports = new Map<string, { from: string; name: string }>();
  const stars: string[] = [];

  const declare = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      locals.set(node.name.text, [...(locals.get(node.name.text) ?? []), node.initializer]);
    }
    ts.forEachChild(node, declare);
  };
  declare(tree);

  for (const statement of tree.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const from = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (clause?.name) imports.set(clause.name.text, { from, name: 'default' });
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        imports.set(bindings.name.text, { from, name: '*' });
      } else if (bindings) {
        for (const element of bindings.elements) {
          imports.set(element.name.text, {
            from,
            name: (element.propertyName ?? element.name).text,
          });
        }
      }
    } else if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name))
          exports.set(declaration.name.text, declaration.name.text);
      }
    } else if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier;
      const from = specifier && ts.isStringLiteral(specifier) ? specifier.text : undefined;
      const clause = statement.exportClause;
      if (clause === undefined) {
        if (from !== undefined) stars.push(from);
      } else if (ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          const name = (element.propertyName ?? element.name).text;
          if (from === undefined) exports.set(element.name.text, name);
          else reexports.set(element.name.text, { from, name });
        }
      }
    }
  }
  return { path, tree, locals, imports, exports, reexports, stars };
}

interface Reading {
  readonly values: readonly string[];
  readonly unread: readonly Unread[];
}

type Binding =
  | { readonly node: ts.Expression; readonly module: Module; readonly chain: readonly string[] }
  | { readonly namespace: Module; readonly chain: readonly string[] };

/** Reads file text by repository path: the files handed in first, then the disk. */
type Reader = (path: string) => string | undefined;

function diskReader(extra: ReadonlyMap<string, string>): Reader {
  return (path) => {
    const given = extra.get(path);
    if (given !== undefined) return given;
    try {
      return readFileSync(join(REPO_ROOT, path), 'utf8');
    } catch {
      return undefined; // becomes a named "cannot find" failure, never a pass
    }
  };
}

function classReader(read: Reader, cache: Map<string, Module | null>) {
  const load = (importer: Module, specifier: string): Module | string => {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      return `'${specifier}' is a package; the reader follows only relative imports`;
    }
    const base = posix.join(posix.dirname(importer.path), specifier);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
    for (const path of candidates.filter((p) => /\.tsx?$/.test(p))) {
      if (!cache.has(path)) {
        const text = read(path);
        cache.set(path, text === undefined ? null : parseModule(path, text));
      }
      const found = cache.get(path);
      if (found) return found;
    }
    return `cannot find '${specifier}' imported by ${importer.path}`;
  };

  const step = (chain: readonly string[], key: string): readonly string[] | string =>
    chain.includes(key) ? `a cycle: ${[...chain, key].join(' -> ')}` : [...chain, key];

  const resolveName = (
    module: Module,
    name: string,
    chain: readonly string[],
  ): Binding | string => {
    const next = step(chain, `${module.path}#${name}`);
    if (typeof next === 'string') return next;
    const local = module.locals.get(name);
    if (local !== undefined) {
      if (local.length > 1)
        return `\`${name}\` is declared ${String(local.length)} times in ${module.path}`;
      return { node: local[0] as ts.Expression, module, chain: next };
    }
    const imported = module.imports.get(name);
    if (imported === undefined)
      return `\`${name}\` is not a constant in ${module.path} or an import`;
    const target = load(module, imported.from);
    return typeof target === 'string' ? target : resolveExport(target, imported.name, next);
  };

  const resolveExport = (
    module: Module,
    name: string,
    chain: readonly string[],
  ): Binding | string => {
    const next = step(chain, `${module.path}#export ${name}`);
    if (typeof next === 'string') return next;
    if (name === '*') return { namespace: module, chain: next };
    const local = module.exports.get(name);
    if (local !== undefined) return resolveName(module, local, next);
    const reexport = module.reexports.get(name);
    if (reexport !== undefined) {
      const target = load(module, reexport.from);
      return typeof target === 'string' ? target : resolveExport(target, reexport.name, next);
    }
    for (const from of module.stars) {
      const target = load(module, from);
      if (typeof target === 'string') return target;
      const found = resolveExport(target, name, next);
      if (typeof found !== 'string') return found;
    }
    return `${module.path} has no export \`${name}\``;
  };

  const unwrap = (node: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
      ? unwrap(node.expression)
      : node;

  /** The object literals a lookup's left-hand side can be. */
  const holders = (
    raw: ts.Expression,
    module: Module,
    chain: readonly string[],
  ): Binding[] | string => {
    const node = unwrap(raw);
    if (ts.isObjectLiteralExpression(node)) return [{ node, module, chain }];
    if (ts.isIdentifier(node)) {
      const bound = resolveName(module, node.text, chain);
      if (typeof bound === 'string') return bound;
      return 'namespace' in bound ? [bound] : holders(bound.node, bound.module, bound.chain);
    }
    return `\`${node.getText(module.tree)}\` is not an object the reader can look inside`;
  };

  const members = (
    node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    module: Module,
    chain: readonly string[],
  ): Binding[] | string => {
    let key: string | undefined;
    if (ts.isPropertyAccessExpression(node)) key = node.name.text;
    else {
      const argument = unwrap(node.argumentExpression);
      if (ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)) key = argument.text;
    }
    const bases = holders(node.expression, module, chain);
    if (typeof bases === 'string') return bases;
    const out: Binding[] = [];
    for (const base of bases) {
      if ('namespace' in base) {
        if (key === undefined) return 'a whole module indexed by a value the reader cannot know';
        const bound = resolveExport(base.namespace, key, base.chain);
        if (typeof bound === 'string') return bound;
        out.push(bound);
        continue;
      }
      const object = base.node as ts.ObjectLiteralExpression;
      let matched = false;
      for (const property of object.properties) {
        if (!ts.isPropertyAssignment(property)) {
          return `the object in ${base.module.path} has a member the reader cannot read (\`${property.getText(base.module.tree)}\`)`;
        }
        const name = property.name.getText(base.module.tree).replace(/^['"]|['"]$/g, '');
        if (key !== undefined && name !== key) continue;
        matched = true;
        out.push({ node: property.initializer, module: base.module, chain: base.chain });
      }
      if (!matched) return `the object has no member \`${key ?? '(any)'}\``;
    }
    return out;
  };

  const one = (value: string): Reading => ({ values: [value], unread: [] });
  const either = (...readings: Reading[]): Reading => ({
    values: [...new Set(readings.flatMap((r) => r.values))],
    unread: readings.flatMap((r) => r.unread),
  });

  const evaluate = (node: ts.Expression, module: Module, chain: readonly string[]): Reading => {
    const fail = (why: string): Reading => {
      const line = module.tree.getLineAndCharacterOfPosition(node.getStart(module.tree)).line + 1;
      const text = node.getText(module.tree).replace(/\s+/g, ' ');
      // '' keeps the readable rest of the class list judged beside this failure.
      return { values: [''], unread: [{ file: module.path, line, text, why }] };
    };
    const joined = (...readings: Reading[]): Reading => {
      let values: string[] = [''];
      for (const reading of readings) {
        values = [...new Set(values.flatMap((a) => reading.values.map((b) => a + b)))];
        if (values.length > MAX_CLASS_LISTS) {
          return fail(`more than ${String(MAX_CLASS_LISTS)} possible class lists`);
        }
      }
      return { values, unread: readings.flatMap((r) => r.unread) };
    };

    if (ts.isStringLiteralLike(node)) return one(node.text);
    const inner = unwrap(node);
    if (inner !== node) return evaluate(inner, module, chain);
    if (ts.isTemplateExpression(node)) {
      return joined(
        one(node.head.text),
        ...node.templateSpans.flatMap((span) => [
          evaluate(span.expression, module, chain),
          one(span.literal.text),
        ]),
      );
    }
    if (ts.isConditionalExpression(node)) {
      return either(
        evaluate(node.whenTrue, module, chain),
        evaluate(node.whenFalse, module, chain),
      );
    }
    if (ts.isBinaryExpression(node)) {
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken:
          return joined(evaluate(node.left, module, chain), evaluate(node.right, module, chain));
        case ts.SyntaxKind.BarBarToken:
        case ts.SyntaxKind.QuestionQuestionToken:
          return either(evaluate(node.left, module, chain), evaluate(node.right, module, chain));
        case ts.SyntaxKind.AmpersandAmpersandToken:
          return either(one(''), evaluate(node.right, module, chain));
        default:
          return fail('an operator the reader does not evaluate');
      }
    }
    if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
      return one('');
    }
    if (ts.isIdentifier(node)) {
      if (node.text === 'undefined') return one('');
      const bound = resolveName(module, node.text, chain);
      if (typeof bound === 'string') return fail(bound);
      if ('namespace' in bound) return fail('a whole module is not a class list');
      return evaluate(bound.node, bound.module, bound.chain);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const found = members(node, module, chain);
      if (typeof found === 'string') return fail(found);
      return either(
        ...found.map((b) =>
          'namespace' in b
            ? fail('a whole module is not a class list')
            : evaluate(b.node, b.module, b.chain),
        ),
      );
    }
    if (ts.isCallExpression(node))
      return fail('a function call, whose result the reader cannot know');
    return fail(`a ${ts.SyntaxKind[node.kind]} the reader does not evaluate`);
  };

  return evaluate;
}

// ── The scan ────────────────────────────────────────────────────────────────

const classesOf = (list: string): string[] => list.split(/\s+/).filter((name) => name !== '');
const holdsAll = (classes: readonly string[], base: readonly string[]): boolean =>
  base.every((name) => classes.includes(name));

function attributeNamed(
  element: ts.JsxOpeningLikeElement,
  name: string,
  tree: ts.SourceFile,
): ts.JsxAttribute | undefined {
  return element.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText(tree) === name,
  );
}

/** The expression an attribute holds: `"x"` or `{x}`. `null` for a bare attribute or `{}`. */
function valueOf(attribute: ts.JsxAttribute): ts.Expression | null {
  const initializer = attribute.initializer;
  if (initializer === undefined) return null;
  if (ts.isJsxExpression(initializer)) return initializer.expression ?? null;
  return initializer as ts.Expression;
}

/** Inside a `className` attribute, at any depth: such strings are judged with their element. */
function inClassName(node: ts.Node, tree: ts.SourceFile): boolean {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isJsxAttribute(at)) return at.name.getText(tree) === 'className';
  }
  return false;
}

/** Scan shipped files. `shared` is exempt (set it to `null` to prove the shared part is caught). */
export function scanErrorBoxes(files: readonly SourceFile[], shared: string | null = SHARED): Scan {
  const given = new Map(files.map((file) => [file.path, file.source]));
  const cache = new Map<string, Module | null>();
  const evaluate = classReader(diskReader(given), cache);

  const offences: Offence[] = [];
  const unread: Unread[] = [];
  const rowStrips: RowStrip[] = [];
  const alerts: AlertSeen[] = [];

  for (const { path, source } of files) {
    if (path === shared) continue;
    const module = parseModule(path, source);
    cache.set(path, module);
    const tree = module.tree;
    const lineOf = (node: ts.Node): number =>
      tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
    const read = (expression: ts.Expression): Reading => evaluate(expression, module, []);

    /** Is this tag the shared part? A renamed import and `ui.ErrorBox` count. */
    const isErrorBox = (tag: ts.JsxTagNameExpression): boolean => {
      if (ts.isIdentifier(tag)) return module.imports.get(tag.text)?.name === 'ErrorBox';
      return ts.isPropertyAccessExpression(tag) && tag.name.text === 'ErrorBox';
    };

    const visit = (node: ts.Node): void => {
      // STRING: a copy kept outside any className.
      if (
        (ts.isStringLiteralLike(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)) &&
        !inClassName(node, tree) &&
        !ts.isImportDeclaration(node.parent) &&
        !ts.isExportDeclaration(node.parent)
      ) {
        const classes = classesOf(node.text);
        const rules: Rule[] = [];
        if (holdsAll(classes, BOX_BASE)) rules.push('STRING holds BOX');
        if (holdsAll(classes, STRIP_BASE)) rules.push('STRING holds STRIP');
        if (rules.length > 0) {
          offences.push({
            file: path,
            line: lineOf(node),
            where: 'a string',
            rules,
            classes: classes.join(' '),
          });
        }
      }

      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const shared = isErrorBox(node.tagName);
        // The shared part takes `testId`; an element carries `data-testid`.
        const testIdAttribute = attributeNamed(node, shared ? 'testId' : 'data-testid', tree);
        const testIdValue = testIdAttribute === undefined ? null : valueOf(testIdAttribute);
        const testId =
          testIdValue === null
            ? null
            : ts.isStringLiteralLike(testIdValue)
              ? testIdValue.text
              : testIdValue.getText(tree);

        if (shared) checkRowStrip(node, testId);
        else checkElement(node, testId);
      }
      ts.forEachChild(node, visit);
    };

    const checkElement = (node: ts.JsxOpeningLikeElement, testId: string | null): void => {
      const tag = node.tagName.getText(tree);
      const where = `<${tag}${testId === null ? '' : ` data-testid="${testId}"`}>`;
      const line = lineOf(node);

      const roleAttribute = attributeNamed(node, 'role', tree);
      const roleValue = roleAttribute === undefined ? null : valueOf(roleAttribute);
      const role = roleValue === null ? null : read(roleValue);
      const isAlert = role?.values.includes('alert') ?? false;

      const classAttribute = attributeNamed(node, 'className', tree);
      const classValue = classAttribute === undefined ? null : valueOf(classAttribute);
      const classes = classValue === null ? { values: [''], unread: [] } : read(classValue);
      const lists = classes.values.map(classesOf);
      const tinted = lists.some((list) => list.some((name) => DANGER_TINT.test(name)));
      const spread = node.attributes.properties.find(ts.isJsxSpreadAttribute);

      if (isAlert) alerts.push({ file: path, line, tag, testId });

      // What the reader could not read matters only where it could hide a box.
      if (isAlert) unread.push(...classes.unread);
      if (tinted && role !== null) unread.push(...role.unread);
      if (spread !== undefined && (isAlert || tinted)) {
        unread.push({
          file: path,
          line: lineOf(spread),
          text: spread.getText(tree).replace(/\s+/g, ' '),
          why: `a spread on ${where} may set a role or classes the reader cannot see`,
        });
      }

      for (const list of lists) {
        const rules: Rule[] = [];
        if (isAlert && list.some((name) => DANGER_TINT.test(name))) rules.push('ALERT');
        if (holdsAll(list, BOX_BASE)) rules.push('COPY of BOX');
        if (holdsAll(list, STRIP_BASE)) rules.push('COPY of STRIP');
        if (rules.length > 0)
          offences.push({ file: path, line, where, rules, classes: list.join(' ') });
      }
    };

    const checkRowStrip = (node: ts.JsxOpeningLikeElement, testId: string | null): void => {
      const line = lineOf(node);
      const named = testId ?? '(no testId)';
      const spread = node.attributes.properties.find(ts.isJsxSpreadAttribute);
      const valuesOf = (name: string): Reading | null => {
        const attribute = attributeNamed(node, name, tree);
        const value = attribute === undefined ? null : valueOf(attribute);
        return value === null ? null : read(value);
      };
      const variant = valuesOf('variant');
      const layout = valuesOf('layout');
      const report = (problem: string | null): void => {
        rowStrips.push({ file: path, line, testId: named, problem });
      };

      if (spread !== undefined) {
        report(`a spread (\`${spread.getText(tree)}\`) hides whether it is a row strip`);
        return;
      }
      if ((variant?.unread.length ?? 0) > 0 || (layout?.unread.length ?? 0) > 0) {
        report('its variant or layout cannot be read');
        return;
      }
      const isRow =
        (variant?.values.includes('strip') ?? false) && (layout?.values.includes('row') ?? false);
      if (!isRow) return;

      const element = node.parent;
      if (!ts.isJsxElement(element)) {
        report('a row strip with no children has no message');
        return;
      }
      const children = element.children.filter(
        (child) =>
          !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces) &&
          !(ts.isJsxExpression(child) && child.expression === undefined),
      );
      const first = children[0];
      if (first === undefined) {
        report('a row strip with no children has no message');
        return;
      }
      const opening = ts.isJsxElement(first)
        ? first.openingElement
        : ts.isJsxSelfClosingElement(first)
          ? first
          : null;
      if (opening === null || opening.tagName.getText(tree) !== 'span') {
        report(
          `its first child (\`${first.getText(tree).replace(/\s+/g, ' ').slice(0, 60)}\`) is not a <span> holding the message`,
        );
        return;
      }
      const classAttribute = attributeNamed(opening, 'className', tree);
      const classValue = classAttribute === undefined ? null : valueOf(classAttribute);
      if (classValue === null) {
        report('the message <span> has no className, so no min-w-0');
        return;
      }
      const reading = read(classValue);
      if (reading.unread.length > 0) {
        report(
          `the message <span>'s className cannot be read: ${reading.unread.map((u) => u.why).join('; ')}`,
        );
        return;
      }
      const missing = reading.values.filter((list) => !classesOf(list).includes('min-w-0'));
      report(
        missing.length === 0
          ? null
          : `the message <span> lacks min-w-0 in ${missing.map((list) => `"${list}"`).join(', ')}`,
      );
    };

    visit(tree);
  }

  return { files: files.length, offences, unread, rowStrips, alerts };
}

// ── The exceptions ──────────────────────────────────────────────────────────

export interface LookAlike {
  readonly file: string;
  /** The exact class list, in source order, whitespace collapsed. */
  readonly classes: string;
  readonly reason: string;
}

/** A COPY that is deliberately not an alert. Never excuses an ALERT. Each must match exactly once. */
export const LOOK_ALIKES: readonly LookAlike[] = [
  {
    file: 'apps/light/src/features/settings/updates/UpdateCheck.tsx',
    classes: 'mt-2 rounded-control bg-danger/5 px-3 py-2 text-danger',
    reason:
      'The update check\'s "could not check" is drawn in the box red on purpose, but it must not ' +
      'interrupt: its words go to the polite status region, and UpdateCheck.test.tsx pins that it ' +
      'has no role and no aria-live (L-377). It is not an error the user must act on.',
  },
];

export interface UnreadAllowed {
  readonly file: string;
  /** The exact expression text the reader cannot evaluate, whitespace collapsed. */
  readonly text: string;
  /** How many times it appears in that file. */
  readonly times: number;
  readonly reason: string;
}

/** Class expressions the reader cannot evaluate, on an alert, that are known not to hide a box. */
export const UNREAD_ALLOWED: readonly UnreadAllowed[] = [
  {
    file: 'apps/light/src/app/ErrorBoundary.tsx',
    text: "cardClasses({ padding: 'none' })",
    times: 2,
    reason:
      'The crash card (the app-wide one and the one-screen one): `ui/Card.tsx` builds the card ' +
      'surface, `bg-card` with a line border, never a danger tint. It is a whole card with a ' +
      'heading and two buttons, not an error box.',
  },
  {
    file: 'apps/light/src/ui/StatusPill.tsx',
    text: '{...rest}',
    times: 1,
    reason:
      'The status pill: its danger tone is a small red label (`rounded-pill px-2 py-0.5 text-xs`), ' +
      'not a box. `className` is omitted from its props, so the spread cannot restyle it; it ' +
      'carries `data-testid`, `title` and the like.',
  },
];

export interface Verdict {
  readonly failures: readonly string[];
  readonly stale: readonly string[];
}

export function judge(
  scan: Scan,
  lookAlikes: readonly LookAlike[] = LOOK_ALIKES,
  unreadAllowed: readonly UnreadAllowed[] = UNREAD_ALLOWED,
): Verdict {
  const failures: string[] = [];
  const seenLike = new Map<LookAlike, number>(lookAlikes.map((entry) => [entry, 0]));
  const seenUnread = new Map<UnreadAllowed, number>(unreadAllowed.map((entry) => [entry, 0]));

  for (const offence of scan.offences) {
    const excuse = offence.rules.includes('ALERT')
      ? undefined
      : lookAlikes.find(
          (entry) => entry.file === offence.file && entry.classes === offence.classes,
        );
    if (excuse !== undefined) {
      seenLike.set(excuse, (seenLike.get(excuse) ?? 0) + 1);
      continue;
    }
    failures.push(
      `${offence.file}:${String(offence.line)} ${offence.where} is a hand-built error box ` +
        `(${offence.rules.join(', ')}: "${offence.classes}"); use ui/ErrorBox`,
    );
  }

  for (const item of scan.unread) {
    const excuse = unreadAllowed.find(
      (entry) => entry.file === item.file && entry.text === item.text,
    );
    if (excuse !== undefined) {
      seenUnread.set(excuse, (seenUnread.get(excuse) ?? 0) + 1);
      continue;
    }
    failures.push(`${item.file}:${String(item.line)} cannot read \`${item.text}\`: ${item.why}`);
  }

  for (const strip of scan.rowStrips) {
    if (strip.problem !== null) {
      failures.push(
        `${strip.file}:${String(strip.line)} row strip ${strip.testId}: ${strip.problem}`,
      );
    }
  }

  const stale = [
    ...lookAlikes
      .filter((entry) => seenLike.get(entry) !== 1)
      .map(
        (entry) =>
          `${entry.file}: "${entry.classes}" matched ${String(seenLike.get(entry))} times, not exactly once`,
      ),
    ...unreadAllowed
      .filter((entry) => seenUnread.get(entry) !== entry.times)
      .map(
        (entry) =>
          `${entry.file}: \`${entry.text}\` matched ${String(seenUnread.get(entry))} times, not ${String(entry.times)}`,
      ),
  ];
  return { failures, stale };
}

// ── The real tree ───────────────────────────────────────────────────────────

const FILES = [
  ...walk(join(REPO_ROOT, 'apps/light/src'), { extensions: ['.ts', '.tsx'] }),
  ...walk(join(REPO_ROOT, 'packages/ui/src'), { extensions: ['.ts', '.tsx'] }),
];

function shipped(): SourceFile[] {
  return FILES.map((file) => ({ path: displayPath(file), source: readFileSync(file, 'utf8') }));
}

/**
 * The nine plain red text lines (L-368's survey): red words on no tint, or the
 * crash card. Not boxes. Each must still be found, and none may be flagged.
 */
const PLAIN_RED_LINES: readonly {
  file: string;
  tag: string;
  testId: string | null;
  times: number;
}[] = [
  {
    file: 'apps/light/src/features/search/ResultCard.tsx',
    tag: 'p',
    testId: '`result-problem-${job.id}`',
    times: 1,
  },
  {
    file: 'apps/light/src/features/analysis/OllamaDownloadLink.tsx',
    tag: 'span',
    testId: '`${idPrefix}-ollama-link-problem`',
    times: 1,
  },
  {
    file: 'apps/light/src/features/tracker/SubstageEditor.tsx',
    tag: 'p',
    testId: 'errorId',
    times: 1,
  },
  {
    file: 'apps/light/src/features/profile/GapsPanel.tsx',
    tag: 'p',
    testId: 'profile-gaps-error',
    times: 1,
  },
  {
    file: 'apps/light/src/features/profile/ImportAiJobSearchPanel.tsx',
    tag: 'p',
    testId: 'profile-import-problem',
    times: 1,
  },
  {
    file: 'apps/light/src/features/tailor/CvTextPanel.tsx',
    tag: 'p',
    testId: 'tailor-cv-edit-problem',
    times: 2,
  },
  { file: 'apps/light/src/app/ErrorBoundary.tsx', tag: 'section', testId: null, times: 2 },
];

describe('one error box (L-380)', () => {
  const files = shipped();
  const scan = scanErrorBoxes(files);

  it('reads a real corpus, tests excluded (anti-inert)', () => {
    expect(scan.files).toBe(files.length);
    expect(files.length).toBeGreaterThan(200);
    const names = files.map((file) => file.path);
    for (const known of [
      SHARED,
      'apps/light/src/features/search/Search.tsx',
      'apps/light/src/features/search/SearchResults.tsx',
      'apps/light/src/features/tracker/FollowUpPanel.tsx',
      'apps/light/src/features/tracker/SubstageEditor.tsx',
      'apps/light/src/features/tracker/TrackerAlerts.tsx',
      'apps/light/src/features/settings/updates/UpdateCheck.tsx',
    ]) {
      expect(names, known).toContain(known);
    }
    expect(names.some((name) => /\.test\.tsx?$/.test(name))).toBe(false);
  });

  it('the shared part itself is caught, so the patterns match real markup', () => {
    const shared = files.filter((file) => file.path === SHARED);
    const own = scanErrorBoxes(shared, null);
    const rules = new Set(own.offences.flatMap((offence) => offence.rules));
    expect([...rules].sort()).toEqual([
      'ALERT',
      'COPY of BOX',
      'COPY of STRIP',
      'STRING holds BOX',
      'STRING holds STRIP',
    ]);
  });

  it('forbid-list: no hand-built error box outside ui/ErrorBox.tsx', () => {
    expect(judge(scan).failures).toEqual([]);
  });

  it('every exception still exists, as often as it says', () => {
    expect(judge(scan).stale).toEqual([]);
  });

  it('every exception says why', () => {
    for (const entry of [...LOOK_ALIKES, ...UNREAD_ALLOWED]) {
      expect(entry.reason.length, entry.file).toBeGreaterThan(60);
    }
  });

  it('finds the row strips (Tracker has two), and each holds its message in a min-w-0 span', () => {
    const tracker = scan.rowStrips.filter((strip) => strip.file.endsWith('/TrackerAlerts.tsx'));
    expect(tracker.map((strip) => strip.testId)).toEqual([
      'tracker-error',
      'tracker-substages-error',
    ]);
    expect(scan.rowStrips.filter((strip) => strip.problem !== null)).toEqual([]);
  });

  it('NEGATIVE: the nine plain red text lines are found, and none is flagged', () => {
    const failures = judge(scan).failures;
    for (const line of PLAIN_RED_LINES) {
      const found = scan.alerts.filter(
        (alert) =>
          alert.file === line.file && alert.tag === line.tag && alert.testId === line.testId,
      );
      expect(found.length, `${line.file} ${String(line.testId)}`).toBe(line.times);
      for (const alert of found) {
        const at = `${alert.file}:${String(alert.line)} `;
        expect(
          failures.filter((failure) => failure.startsWith(at)),
          at,
        ).toEqual([]);
      }
    }
    expect(PLAIN_RED_LINES.reduce((total, line) => total + line.times, 0)).toBe(9);
  });

  it('NEGATIVE: the update check is not flagged, and is not an alert', () => {
    const file = 'apps/light/src/features/settings/updates/UpdateCheck.tsx';
    expect(scan.alerts.filter((alert) => alert.file === file)).toEqual([]);
    const offences = scan.offences.filter((offence) => offence.file === file);
    expect(offences.map((offence) => offence.rules)).toEqual([['COPY of BOX']]);
    expect(judge(scan).failures.filter((failure) => failure.startsWith(file))).toEqual([]);
  });
});

describe('the checker can fail', () => {
  const FILE = 'apps/light/src/features/elsewhere/Elsewhere.tsx';
  const failuresIn = (source: string, extra: readonly SourceFile[] = []): readonly string[] =>
    judge(scanErrorBoxes([{ path: FILE, source }, ...extra]), [], []).failures;

  const MUST_FLAG: readonly (readonly [string, string])[] = [
    [
      'a pasted alert box',
      '<p role="alert" className="rounded-control bg-danger/5 px-3 py-2 text-danger">x</p>',
    ],
    [
      'an alert on any danger tint, any padding',
      '<div role="alert" className="bg-danger/10 p-4">x</div>',
    ],
    [
      'the box without its role',
      '<p className="mt-2 rounded-control bg-danger/5 px-3 py-2 text-danger">x</p>',
    ],
    [
      'the strip without its role',
      '<p className="border-b border-danger/30 bg-danger/5 px-4 py-2 text-danger md:px-6">x</p>',
    ],
    [
      'the classes in another order',
      '<p role="alert" className="text-danger py-2 px-3 bg-danger/5 rounded-control">x</p>',
    ],
    ['the role written as an expression', '<p role={\'alert\'} className="bg-danger/5 p-2">x</p>'],
    [
      'the tint chosen in one branch of a ternary',
      '<p role="alert" className={ok ? "bg-sunken" : "bg-danger/5"}>x</p>',
    ],
    [
      'the classes split across a template',
      'const GAP = "mt-2"; const T = "bg-danger/5"; export const A = () => <p className={`${GAP} rounded-control ${T} px-3 py-2 text-danger`}>x</p>;',
    ],
    [
      'a constant in the same file',
      'const LOOK = "rounded-control bg-danger/5 px-3 py-2 text-danger"; export const A = () => <p role="alert" className={LOOK}>x</p>;',
    ],
    [
      'a copy kept in a constant, used nowhere yet',
      'export const LOOK = "border-b border-danger/30 bg-danger/5 px-4 py-2 text-danger";',
    ],
    [
      'a copy in a constant object',
      'const TONES = { bad: "bg-danger/5 rounded-control px-3 py-2 text-danger" }; export const A = () => <p className={TONES.bad}>x</p>;',
    ],
  ];

  it.each(MUST_FLAG)('flags %s', (_name, source) => {
    expect(failuresIn(source).length).toBeGreaterThan(0);
    expect(failuresIn(source)[0]).toContain(FILE);
  });

  it('flags a box whose classes come from a constant imported from another file', () => {
    const tones = {
      path: 'apps/light/src/features/elsewhere/tones.ts',
      source: 'export const BAD = "bg-danger/5";',
    };
    const source =
      'import { BAD } from \'./tones\'; export const A = () => <p role="alert" className={`p-2 ${BAD}`}>x</p>;';
    // The constant file itself holds no base set, so only the element is reported.
    expect(failuresIn(source, [tones])).toEqual([
      `${FILE}:1 <p> is a hand-built error box (ALERT: "p-2 bg-danger/5"); use ui/ErrorBox`,
    ]);
  });

  it('names an alert whose classes it cannot read, rather than passing it', () => {
    expect(failuresIn('export const A = () => <p role="alert" className={pick()}>x</p>;')).toEqual([
      `${FILE}:1 cannot read \`pick()\`: a function call, whose result the reader cannot know`,
    ]);
    expect(
      failuresIn('export const A = (p: object) => <p className="bg-danger/5" {...p}>x</p>;'),
    ).toHaveLength(1);
  });

  const MUST_NOT_FLAG: readonly (readonly [string, string])[] = [
    [
      'the shared part used as meant',
      'import { ErrorBox } from "../../ui"; export const A = () => <ErrorBox variant="box" testId="x">y</ErrorBox>;',
    ],
    ['plain red text, announced', '<p role="alert" className="mt-2 text-xs text-danger">x</p>'],
    ['a grey note box', '<p className="rounded-control bg-sunken px-3 py-2 text-ink-muted">x</p>'],
    ['a gold notice', '<p className="rounded-control bg-gold/10 px-3 py-2 text-gold-ink">x</p>'],
    ['a crash card', '<section role="alert" className="max-w-md p-6">x</section>'],
    [
      'a danger button',
      '<button className="bg-danger text-ink-inverse px-3 py-2 rounded-control">x</button>',
    ],
    ['a red pill', 'const TONE = { danger: "bg-danger/10 text-danger" };'],
    [
      'the box base missing one class, no role',
      '<p className="rounded-control bg-danger/5 py-2 text-danger">x</p>',
    ],
    [
      'the classes only in comments',
      '// <p role="alert" className="rounded-control bg-danger/5 px-3 py-2 text-danger">\n/* border-b border-danger/30 bg-danger/5 px-4 py-2 text-danger */\nexport const a = 1;',
    ],
  ];

  it.each(MUST_NOT_FLAG)('does not flag %s', (_name, source) => {
    expect(failuresIn(source)).toEqual([]);
  });

  describe('the row strip', () => {
    const strip = (children: string, layout = '"row"'): string =>
      `import { ErrorBox } from "../../ui"; export const A = () => <ErrorBox variant="strip" layout=${layout} testId="s">${children}</ErrorBox>;`;

    it('passes a min-w-0 message span, then a button', () => {
      expect(
        failuresIn(strip('<span className="min-w-0">{m}</span><button>Retry</button>')),
      ).toEqual([]);
    });

    it('passes min-w-0 read from a constant, and the plain strip needs nothing', () => {
      expect(failuresIn(`const S = "min-w-0"; ${strip('<span className={S}>{m}</span>')}`)).toEqual(
        [],
      );
      expect(
        failuresIn(
          'import { ErrorBox } from "../../ui"; export const A = () => <ErrorBox variant="strip" testId="s">{m}</ErrorBox>;',
        ),
      ).toEqual([]);
    });

    it.each([
      [
        'a span without min-w-0',
        '<span className="font-medium">{m}</span><button>Retry</button>',
        'lacks min-w-0',
      ],
      [
        'min-w-0 in one branch only',
        '<span className={a ? "min-w-0" : ""}>{m}</span>',
        'lacks min-w-0',
      ],
      ['the message bare', '{m}<button>Retry</button>', 'is not a <span>'],
      ['the message in a component', '<Words text={m} /><button>Retry</button>', 'is not a <span>'],
      [
        'the button first',
        '<button>Retry</button><span className="min-w-0">{m}</span>',
        'is not a <span>',
      ],
      [
        'a span whose classes cannot be read',
        '<span className={pick()}>{m}</span>',
        'cannot be read',
      ],
      ['a span with no className', '<span>{m}</span>', 'no className'],
    ])('flags %s', (_name, children, why) => {
      const found = failuresIn(strip(children));
      expect(found).toHaveLength(1);
      expect(found[0]).toContain(why);
      expect(found[0]).toContain('row strip s');
    });

    it('flags a row strip whose layout cannot be read, a renamed import, and one behind a spread', () => {
      expect(failuresIn(strip('<span>{m}</span>', '{pick()}'))[0]).toContain('cannot be read');
      expect(
        failuresIn(
          'import { ErrorBox as Box } from "../../ui"; export const A = () => <Box variant="strip" layout="row" testId="s"><span>{m}</span></Box>;',
        ),
      ).toHaveLength(1);
      expect(
        failuresIn(
          'import { ErrorBox } from "../../ui"; export const A = (p: object) => <ErrorBox {...p}><span>{m}</span></ErrorBox>;',
        )[0],
      ).toContain('spread');
    });
  });

  describe('the exceptions', () => {
    const LIKE: LookAlike = {
      file: FILE,
      classes: 'mt-2 rounded-control bg-danger/5 px-3 py-2 text-danger',
      reason: 'a made-up look-alike for these tests, long enough to be a reason for one',
    };
    const COPY = '<p className="mt-2 rounded-control bg-danger/5 px-3 py-2 text-danger">x</p>';

    it('a look-alike excuses its own copy, exactly once', () => {
      expect(judge(scanErrorBoxes([{ path: FILE, source: COPY }]), [LIKE], [])).toEqual({
        failures: [],
        stale: [],
      });
    });

    it('a look-alike never excuses an alert', () => {
      const alert =
        '<p role="alert" className="mt-2 rounded-control bg-danger/5 px-3 py-2 text-danger">x</p>';
      const verdict = judge(scanErrorBoxes([{ path: FILE, source: alert }]), [LIKE], []);
      expect(verdict.failures).toHaveLength(1);
      expect(verdict.stale).toHaveLength(1);
    });

    it('a stale look-alike fails, and so does a second copy', () => {
      expect(
        judge(scanErrorBoxes([{ path: FILE, source: 'export const a = 1;' }]), [LIKE], []).stale,
      ).toEqual([`${FILE}: "${LIKE.classes}" matched 0 times, not exactly once`]);
      expect(
        judge(scanErrorBoxes([{ path: FILE, source: `${COPY}\n${COPY}` }]), [LIKE], []).stale,
      ).toEqual([`${FILE}: "${LIKE.classes}" matched 2 times, not exactly once`]);
    });

    it('an unread allowance counts its uses, and excuses nothing in another file', () => {
      const allowed: UnreadAllowed = { file: FILE, text: 'pick()', times: 1, reason: LIKE.reason };
      const once = '<p role="alert" className={pick()}>x</p>';
      expect(judge(scanErrorBoxes([{ path: FILE, source: once }]), [], [allowed])).toEqual({
        failures: [],
        stale: [],
      });
      expect(
        judge(scanErrorBoxes([{ path: FILE, source: `${once}\n${once}` }]), [], [allowed]).stale,
      ).toHaveLength(1);
      const other = judge(
        scanErrorBoxes([{ path: 'apps/light/src/other.tsx', source: once }]),
        [],
        [allowed],
      );
      expect(other.failures).toHaveLength(1);
      expect(other.stale).toHaveLength(1);
    });
  });
});
