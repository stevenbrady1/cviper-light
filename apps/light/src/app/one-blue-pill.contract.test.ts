/**
 * Exactly one blue pill in the app, and it is "Start here" (L-378).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * The written rule is in `ui/StatusPill.tsx`: "There is no blue pill and no
 * navy pill. Blue is action and navy is structure." The colour grammar at the
 * top of `styles/theme.css` gives blue to the one primary button per view, to
 * links and to the focus ring. One pill breaks the rule on purpose — the blue
 * "Start here" badge on the welcome page's featured card, which is the one
 * featured thing on that screen (`ui/IconTile.tsx` says the same of its blue
 * tile). Nothing stopped a second one. This check does.
 *
 * ============================================================================
 * WHAT COUNTS (owner-approved definition, 12 Nov 2026)
 * ============================================================================
 *   PILL       an element whose class list has a resting `rounded-pill` or
 *              `rounded-full` (a screen-width prefix such as `md:` still
 *              counts as resting) AND padding around its words (`p-`, `px-`, `pl-`,
 *              `pr-`, `ps-` or `pe-`, not `-0`). A status dot, a score bar or a
 *              tick is rounded but holds no words, so it is not a pill.
 *   BLUE PILL  a pill with a class from the blue token family (the theme's
 *              `--color-blue` and any `--color-blue-*`):
 *                * `bg-blue…`, `border-blue…` (any side) or a gradient stop
 *                  (`from-`/`via-`/`to-blue…`), in any state but focus — paint
 *                  makes a blue pill whatever the element is;
 *                * `text-blue…`, in any state but focus, UNLESS the element is
 *                  a `<button>` or `<a>`: blue words on a control are a link,
 *                  which the colour grammar gives blue to (the job board link
 *                  on a search result is a grey pill with blue words).
 *              Never counted: `ring-`, `outline-`, `accent-` and `decoration-`
 *              classes, and any class under a `focus…` state — the focus ring
 *              is blue everywhere and is not a pill.
 *
 * ============================================================================
 * HOW IT READS A CLASS LIST
 * ============================================================================
 * Off the TypeScript parse tree, so a class named in a comment, or in a string
 * that never reaches a `className`, is not seen. Every JSX `className` in every
 * shipped .ts/.tsx under `apps/light/src` and `packages/ui/src` (tests and
 * test helpers excluded) is EVALUATED with the same reader as the contrast
 * contract's field check (L-357): literals, templates, `+`, ternaries (both
 * branches), `&&`, `||`, `??`, constants in the file, constants IMPORTED by a
 * relative path (so the search buttons' `QUIET_BUTTON` from `app/buttons.ts`
 * is read), and lookups into a constant object (an unknowable key reads every
 * value, so a `TONE[tone]` with a blue entry is caught). Two additions:
 *   * `[...].join(' ')`, how the nav builds its classes;
 *   * a PROP inside one file: when a pill's class comes from a destructured
 *     prop of a component (`TermChips`' `tone`), every `<TermChips tone=…>` in
 *     that file is read. A component that is exported may have callers
 *     elsewhere, so its prop is not followed — it fails as unreadable.
 * A pill whose colour cannot be read (a function call, an unfollowed prop, a
 * spread after `className`) FAILS by name: a pill this check cannot see is a
 * pill it cannot vouch for.
 *
 * ============================================================================
 * THE ONE EXCEPTION — `ALLOWED`
 * ============================================================================
 * Named by file and the exact class text, with a reason. It must match EXACTLY
 * ONCE: a stale entry (the badge lost its blue, or moved) fails, and so does a
 * second copy of the same classes in that file.
 *
 * HONEST LIMITS: a class list built entirely by a function (`cardClasses()`) is
 * not seen as a pill at all; a `className` passed through a prop from another
 * file is read only where it is written as a `className`; inline `style` is
 * not read (`tokens.contract` and `rawColours.contract` forbid raw colours).
 */
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, walk } from '../lib/repo-scan';
import { lightColours } from '../styles/themeTokens';

// ── The definition ─────────────────────────────────────────────────────────

/** The theme's blue family: `blue` and any `blue-*`. Read, not written down. */
const BLUE_TOKENS = [...lightColours().keys()].filter(
  (name) => name === 'blue' || name.startsWith('blue-'),
);

const FAMILY = [...BLUE_TOKENS].sort((a, b) => b.length - a.length).join('|');
/** Paint: a blue fill, tint, edge or gradient stop. */
const BLUE_PAINT = new RegExp(
  `^(?:bg|border(?:-[xytrblse])?|from|via|to)-(?:${FAMILY})(?:/\\d+)?$`,
);
/** Words. */
const BLUE_WORDS = new RegExp(`^text-(?:${FAMILY})(?:/\\d+)?$`);
/** The pill shape, resting. */
const PILL_SHAPE = /^rounded-(?:pill|full)$/;
/** Padding round the words; `-0` is none. */
const PADDING = /^p[xlrse]?-(?!0$)\S+$/;
/** Elements whose blue words are a link, not a blue label. */
const CONTROLS = new Set(['button', 'a']);

interface ClassToken {
  readonly states: readonly string[];
  readonly utility: string;
}

function tokens(classes: string): ClassToken[] {
  return classes
    .split(/\s+/)
    .filter((word) => word !== '')
    .map((word) => {
      const parts = word.split(':');
      return {
        states: parts.slice(0, -1),
        utility: (parts.at(-1) ?? '').replace(/^!/, '').replace(/^-/, ''),
      };
    });
}

/** Screen widths are not states: an `md:rounded-pill` IS a pill on a wide window. */
const WIDTHS = /^(?:max-)?(?:sm|md|lg|xl|2xl)$/;

/** Pill-shaped: a resting round shape (at any width) with padding round its words. */
export function isPillShaped(classes: string): boolean {
  const resting = tokens(classes).filter((token) =>
    token.states.every((state) => WIDTHS.test(state)),
  );
  return (
    resting.some((token) => PILL_SHAPE.test(token.utility)) &&
    resting.some((token) => PADDING.test(token.utility))
  );
}

/** The blue classes that make a pill blue, for a pill drawn by `tag`. */
export function blueClasses(classes: string, tag: string): string[] {
  return tokens(classes)
    .filter((token) => !token.states.some((state) => state.includes('focus')))
    .filter(
      (token) =>
        BLUE_PAINT.test(token.utility) || (BLUE_WORDS.test(token.utility) && !CONTROLS.has(tag)),
    )
    .map((token) => [...token.states, token.utility].join(':'));
}

// ── Reading a className (the contrast contract's L-357 reader, plus join and props) ──

/** Where the reader gets the text of a file it follows an import into. */
export interface Reader {
  read(path: string): string | undefined;
}

const DISK: Reader = {
  read: (path) => {
    try {
      return readFileSync(join(REPO_ROOT, path), 'utf8');
    } catch {
      return undefined; // becomes a named "cannot find" failure, never a pass
    }
  },
};

const MAX_CLASS_LISTS = 256;

interface Module {
  readonly path: string;
  readonly tree: ts.SourceFile;
  readonly locals: ReadonlyMap<string, readonly ts.Expression[]>;
  readonly imports: ReadonlyMap<string, { readonly from: string; readonly name: string }>;
  readonly exports: ReadonlyMap<string, string>;
  readonly reexports: ReadonlyMap<string, { readonly from: string; readonly name: string }>;
  readonly starExports: readonly string[];
  readonly defaultExport: ts.Expression | undefined;
  /** Names declared with an `export` keyword, functions included. */
  readonly exported: ReadonlySet<string>;
}

function parseModule(path: string, source: string): Module {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const locals = new Map<string, ts.Expression[]>();
  const imports = new Map<string, { from: string; name: string }>();
  const exports = new Map<string, string>();
  const reexports = new Map<string, { from: string; name: string }>();
  const starExports: string[] = [];
  const exported = new Set<string>();
  let defaultExport: ts.Expression | undefined;

  const declare = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      locals.set(node.name.text, [...(locals.get(node.name.text) ?? []), node.initializer]);
    }
    ts.forEachChild(node, declare);
  };
  declare(tree);

  const isExported = (statement: ts.Statement): boolean =>
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

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
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          exports.set(declaration.name.text, declaration.name.text);
          exported.add(declaration.name.text);
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name && isExported(statement)) {
      exported.add(statement.name.text);
    } else if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier;
      const from = specifier && ts.isStringLiteral(specifier) ? specifier.text : undefined;
      const clause = statement.exportClause;
      if (clause === undefined) {
        if (from !== undefined) starExports.push(from);
      } else if (ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          const name = (element.propertyName ?? element.name).text;
          if (from === undefined) {
            exports.set(element.name.text, name);
            exported.add(name);
          } else reexports.set(element.name.text, { from, name });
        }
      } else if (from !== undefined) {
        reexports.set(clause.name.text, { from, name: '*' });
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      defaultExport = statement.expression;
      if (ts.isIdentifier(statement.expression)) exported.add(statement.expression.text);
    }
  }
  return {
    path,
    tree,
    locals,
    imports,
    exports,
    reexports,
    starExports,
    defaultExport,
    exported,
  };
}

type Binding =
  | { readonly node: ts.Expression; readonly module: Module; readonly chain: readonly string[] }
  | { readonly namespace: Module; readonly chain: readonly string[] };

interface Reading {
  readonly values: readonly string[];
  readonly unreadable: readonly string[];
}

/** The destructured prop `name` is bound to at `node`, with its component, or undefined. */
function propBinding(
  node: ts.Identifier,
): { component: string; prop: string; fallback: ts.Expression | undefined } | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (!ts.isFunctionDeclaration(at) && !ts.isArrowFunction(at) && !ts.isFunctionExpression(at)) {
      continue;
    }
    const first = at.parameters[0];
    if (first === undefined || !ts.isObjectBindingPattern(first.name)) continue;
    const element = first.name.elements.find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === node.text,
    );
    if (element === undefined) continue;
    const prop =
      element.propertyName !== undefined && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : node.text;
    let component: string | undefined;
    if (ts.isFunctionDeclaration(at)) component = at.name?.text;
    else if (ts.isVariableDeclaration(at.parent) && ts.isIdentifier(at.parent.name)) {
      component = at.parent.name.text;
    }
    return component === undefined ? undefined : { component, prop, fallback: element.initializer };
  }
  return undefined;
}

function classReader(reader: Reader, entry: Module): (start: ts.Expression) => Reading {
  const cache = new Map<string, Module | null>([[entry.path, entry]]);

  const load = (importer: Module, specifier: string): Module | string => {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      return `'${specifier}' is a package; the reader follows only relative imports`;
    }
    const base = posix.join(posix.dirname(importer.path), specifier);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
    for (const path of candidates.filter((p) => /\.tsx?$/.test(p))) {
      if (!cache.has(path)) {
        const text = reader.read(path);
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
      if (local.length > 1) {
        return `\`${name}\` is declared ${local.length} times in ${module.path}, so which one applies cannot be read`;
      }
      return { node: local[0]!, module, chain: next };
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
    if (name === 'default') {
      return module.defaultExport === undefined
        ? `${module.path} has no default export`
        : { node: module.defaultExport, module, chain: next };
    }
    const local = module.exports.get(name);
    if (local !== undefined) return resolveName(module, local, next);
    const reexport = module.reexports.get(name);
    if (reexport !== undefined) {
      const target = load(module, reexport.from);
      return typeof target === 'string' ? target : resolveExport(target, reexport.name, next);
    }
    for (const from of module.starExports) {
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
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
      ? unwrap(node.expression)
      : node;

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
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const found = members(node, module, chain);
      if (typeof found === 'string') return found;
      const all: Binding[] = [];
      for (const binding of found) {
        const inner =
          'namespace' in binding ? [binding] : holders(binding.node, binding.module, binding.chain);
        if (typeof inner === 'string') return inner;
        all.push(...inner);
      }
      return all;
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
        const name =
          (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
          (ts.isIdentifier(property.name) ||
            ts.isStringLiteralLike(property.name) ||
            ts.isNumericLiteral(property.name))
            ? property.name.text
            : undefined;
        if (name === undefined) {
          const at = base.module.tree.getLineAndCharacterOfPosition(
            property.getStart(base.module.tree),
          );
          return `the object at ${base.module.path}:${at.line + 1} has a member the reader cannot read (\`${property.getText(base.module.tree)}\`)`;
        }
        if (key !== undefined && name !== key) continue;
        matched = true;
        out.push({
          node: ts.isPropertyAssignment(property)
            ? property.initializer
            : (property.name as ts.Identifier),
          module: base.module,
          chain: base.chain,
        });
      }
      if (!matched) return `the object has no member \`${key ?? '(any)'}\``;
    }
    return out;
  };

  const one = (value: string): Reading => ({ values: [value], unreadable: [] });
  const either = (...readings: Reading[]): Reading => ({
    values: [...new Set(readings.flatMap((r) => r.values))],
    unreadable: readings.flatMap((r) => r.unreadable),
  });

  /** Every value a component's prop is given by the JSX that draws it in `module`. */
  const propValues = (
    module: Module,
    binding: { component: string; prop: string; fallback: ts.Expression | undefined },
    chain: readonly string[],
    fail: (why: string) => Reading,
  ): Reading => {
    const next = step(chain, `${module.path}#<${binding.component} ${binding.prop}>`);
    if (typeof next === 'string') return fail(next);
    if (module.exported.has(binding.component)) {
      return fail(
        `\`${binding.prop}\` is a prop of the exported \`${binding.component}\`, whose callers in other files are not followed`,
      );
    }
    const readings: Reading[] = [];
    const visit = (node: ts.Node): void => {
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        ts.isIdentifier(node.tagName) &&
        node.tagName.text === binding.component
      ) {
        let given: Reading | undefined;
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(attribute)) {
            given = fail(`a spread into \`<${binding.component}>\` may set \`${binding.prop}\``);
          } else if (attribute.name.getText(module.tree) === binding.prop) {
            const value = attribute.initializer;
            if (value === undefined) given = one('');
            else if (ts.isStringLiteral(value)) given = one(value.text);
            else if (ts.isJsxExpression(value) && value.expression !== undefined) {
              given = evaluate(value.expression, module, next);
            } else given = fail(`an attribute value the reader does not evaluate`);
          }
        }
        readings.push(
          given ??
            (binding.fallback === undefined ? one('') : evaluate(binding.fallback, module, next)),
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(module.tree);
    if (readings.length === 0) {
      return fail(
        `\`${binding.component}\` is never drawn in ${module.path}, so \`${binding.prop}\` is unknown`,
      );
    }
    return either(...readings);
  };

  const evaluate = (node: ts.Expression, module: Module, chain: readonly string[]): Reading => {
    const fail = (why: string): Reading => {
      const at = module.tree.getLineAndCharacterOfPosition(node.getStart(module.tree)).line + 1;
      const text = node.getText(module.tree).replace(/\s+/g, ' ');
      const shown = text.length > 80 ? `${text.slice(0, 77)}...` : text;
      return { values: [''], unreadable: [`\`${shown}\` at ${module.path}:${at}: ${why}`] };
    };
    const joined = (...readings: Reading[]): Reading => {
      let values: string[] = [''];
      for (const reading of readings) {
        values = [...new Set(values.flatMap((a) => reading.values.map((b) => a + b)))];
        if (values.length > MAX_CLASS_LISTS) {
          return fail(`more than ${MAX_CLASS_LISTS} possible class lists`);
        }
      }
      return { values, unreadable: readings.flatMap((r) => r.unreadable) };
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
      const left = (): Reading => evaluate(node.left, module, chain);
      const right = evaluate(node.right, module, chain);
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken:
          return joined(left(), right);
        case ts.SyntaxKind.BarBarToken:
        case ts.SyntaxKind.QuestionQuestionToken:
          return either(left(), right);
        case ts.SyntaxKind.AmpersandAmpersandToken:
          return either(one(''), right);
        default:
          return fail('an operator the reader does not evaluate');
      }
    }
    if (node.kind === ts.SyntaxKind.NullKeyword) return one('');
    if (ts.isIdentifier(node)) {
      if (node.text === 'undefined') return one('');
      // A prop is the nearest binding, so it is looked for before file constants.
      const prop = node.getSourceFile() === module.tree ? propBinding(node) : undefined;
      if (prop !== undefined) return propValues(module, prop, chain, fail);
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
    // `['a', cond ? 'b' : 'c'].join(' ')` — the nav builds its classes this way.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'join' &&
      ts.isArrayLiteralExpression(unwrap(node.expression.expression)) &&
      node.arguments.length <= 1 &&
      (node.arguments.length === 0 || ts.isStringLiteralLike(node.arguments[0]!))
    ) {
      const separator =
        node.arguments.length === 0 ? ',' : (node.arguments[0] as ts.StringLiteral).text;
      const items = (unwrap(node.expression.expression) as ts.ArrayLiteralExpression).elements;
      if (items.some((item) => ts.isSpreadElement(item))) return fail('a spread in a joined list');
      return joined(
        ...items.flatMap((item, index) => [
          ...(index === 0 ? [] : [one(separator)]),
          evaluate(item, module, chain),
        ]),
      );
    }
    if (ts.isCallExpression(node))
      return fail('a function call, whose result the reader cannot know');
    return fail(`a ${ts.SyntaxKind[node.kind]} the reader does not evaluate`);
  };

  return (start) => evaluate(start, entry, []);
}

// ── The check ──────────────────────────────────────────────────────────────

export interface SourceFile {
  readonly path: string;
  readonly source: string;
}

/** One element with a `className`, as the reader sees it. */
export interface Element {
  readonly file: string;
  readonly line: number;
  readonly tag: string;
  /** Every class list it can show, whitespace tidied. */
  readonly classes: readonly string[];
  readonly unreadable: readonly string[];
  readonly pill: boolean;
  /** The blue classes of every pill-shaped class list it can show. */
  readonly blue: readonly string[];
}

const tidy = (classes: string): string => classes.replace(/\s+/g, ' ').trim();

/** Every element with a `className` in one file. */
export function readElements(file: SourceFile, reader: Reader = DISK): Element[] {
  const entry = parseModule(file.path, file.source);
  const tree = entry.tree;
  const read = classReader(reader, entry);
  const found: Element[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.attributes.properties.some(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'className',
      )
    ) {
      const tag = node.tagName.getText(tree);
      let values: readonly string[] = [];
      const unreadable: string[] = [];
      let seenClassName = false;
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) {
          if (seenClassName) {
            const at = tree.getLineAndCharacterOfPosition(attribute.getStart(tree)).line + 1;
            unreadable.push(
              `\`${attribute.getText(tree)}\` at ${file.path}:${at}: a spread after className may replace it`,
            );
          }
          continue;
        }
        if (attribute.name.getText(tree) !== 'className') continue;
        seenClassName = true;
        const initializer = attribute.initializer;
        const expression =
          initializer === undefined
            ? undefined
            : ts.isJsxExpression(initializer)
              ? initializer.expression
              : (initializer as ts.Expression);
        if (expression === undefined) continue;
        const reading = read(expression);
        values = reading.values.map(tidy);
        unreadable.push(...reading.unreadable);
      }
      const pills = values.filter(isPillShaped);
      found.push({
        file: file.path,
        line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
        tag,
        classes: values,
        unreadable,
        pill: pills.length > 0,
        blue: [...new Set(pills.flatMap((classes) => blueClasses(classes, tag)))],
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

export interface Allowed {
  readonly file: string;
  /** The exact class text, whitespace tidied. */
  readonly classes: string;
  readonly reason: string;
}

/** The one blue pill there may be. */
export const ALLOWED: readonly Allowed[] = [
  {
    file: 'apps/light/src/features/onboarding/Welcome.tsx',
    classes:
      'absolute -top-3 left-5 rounded-pill bg-blue px-2.5 py-0.5 text-xs font-semibold text-ink-inverse',
    reason:
      'The "Start here" badge on the welcome page\'s featured card: the one featured thing on ' +
      'that screen, which the colour grammar gives blue to (as `IconTile` does its blue tile). ' +
      'It points at the first action the user should take, so it is action, not a status. ' +
      'Owner-approved as the single blue pill (L-378, 12 Nov 2026).',
  },
];

export interface BluePillReport {
  /** `file:line <tag> "classes" [blue classes]`, one per blue pill nothing excuses. */
  readonly offences: readonly string[];
  /** Pills whose colour cannot be read. */
  readonly unreadable: readonly string[];
  /** Allowed entries that did not match exactly once. */
  readonly stale: readonly string[];
  readonly elements: readonly Element[];
}

export function findBluePills(
  files: readonly SourceFile[],
  allowed: readonly Allowed[] = ALLOWED,
  reader: Reader = DISK,
): BluePillReport {
  const elements = files.flatMap((file) => readElements(file, reader));
  const matched = new Map<Allowed, number>(allowed.map((entry) => [entry, 0]));
  const offences: string[] = [];
  const unreadable: string[] = [];

  for (const element of elements) {
    if (element.pill && element.unreadable.length > 0) {
      unreadable.push(
        `${element.file}:${element.line} <${element.tag}> pill colour cannot be read: ${element.unreadable.join('; ')}`,
      );
    }
    if (element.blue.length === 0) continue;
    const blueLists = element.classes.filter(
      (classes) => isPillShaped(classes) && blueClasses(classes, element.tag).length > 0,
    );
    const excuse = allowed.find(
      (entry) =>
        entry.file === element.file && blueLists.length === 1 && blueLists[0] === entry.classes,
    );
    if (excuse !== undefined) {
      matched.set(excuse, (matched.get(excuse) ?? 0) + 1);
      continue;
    }
    offences.push(
      `${element.file}:${element.line} <${element.tag}> "${blueLists.join('" | "')}" [${element.blue.join(' ')}]`,
    );
  }

  const stale = allowed
    .filter((entry) => matched.get(entry) !== 1)
    .map(
      (entry) =>
        `${entry.file}: "${entry.classes}" matched ${String(matched.get(entry))} times, not exactly once`,
    );
  return { offences, unreadable, stale, elements };
}

// ── The real tree ──────────────────────────────────────────────────────────

const FILES = [
  ...walk(`${REPO_ROOT}/apps/light/src`, { extensions: ['.ts', '.tsx'] }),
  ...walk(`${REPO_ROOT}/packages/ui/src`, { extensions: ['.ts', '.tsx'] }),
];

function shipped(): SourceFile[] {
  return FILES.map((file) => ({ path: displayPath(file), source: readFileSync(file, 'utf8') }));
}

const REAL = findBluePills(shipped());

const at = (file: string): Element[] =>
  REAL.elements.filter((element) => element.file === `apps/light/src/${file}`);

describe('exactly one blue pill, and it is "Start here" (L-378)', () => {
  it('reads a real corpus (anti-inert)', () => {
    const names = FILES.map(displayPath);
    expect(names.length).toBeGreaterThan(200);
    for (const known of [
      'apps/light/src/features/onboarding/Welcome.tsx',
      'apps/light/src/ui/StatusPill.tsx',
      'apps/light/src/features/analysis/AnalysisResult.tsx',
      'apps/light/src/features/search/SearchRecent.tsx',
      'apps/light/src/features/search/SearchSaved.tsx',
      'apps/light/src/features/search/ResultCard.tsx',
      'apps/light/src/app/Sidebar.tsx',
    ]) {
      expect(names, known).toContain(known);
    }
    expect(names.some((name) => /\.test\.tsx?$/.test(name))).toBe(false);
    expect(BLUE_TOKENS).toContain('blue');
    expect(REAL.elements.length).toBeGreaterThan(1000);
    expect(REAL.elements.filter((element) => element.pill).length).toBeGreaterThan(10);
  });

  it('sees the pills it must see, through the constants and props they are built from', () => {
    // The shared label: `TONE[safe]`, an unknowable key, read as every tone.
    const pill = at('ui/StatusPill.tsx').find((element) => element.pill);
    expect(pill?.classes).toHaveLength(4);
    // A recent search: `QUIET_BUTTON`, imported from app/buttons.ts.
    const recent = at('features/search/SearchRecent.tsx').find((element) => element.pill);
    expect(recent?.classes[0]).toContain('hover:bg-sunken hover:text-ink');
    expect(recent?.blue).toEqual([]);
    // A keyword chip: `TermChips`' `tone` prop, read from its callers in the file.
    const chip = at('features/analysis/AnalysisResult.tsx').find(
      (element) => element.tag === 'li' && element.pill,
    );
    expect(chip?.classes.some((classes) => classes.includes('bg-teal/10 text-teal-ink'))).toBe(
      true,
    );
    expect(chip?.unreadable).toEqual([]);
    // The job board link: a pill, with blue words, on a button — not a blue pill.
    const link = at('features/search/ResultCard.tsx').find(
      (element) => element.tag === 'button' && element.pill,
    );
    expect(link?.classes[0]).toContain('text-blue');
    expect(link?.blue).toEqual([]);
    // The nav: `[...].join(' ')`, read, and not a pill.
    const nav = at('app/Sidebar.tsx').find((element) =>
      element.classes.some((classes) => classes.includes('border-l-teal')),
    );
    expect(nav?.pill).toBe(false);
    expect(nav?.unreadable).toEqual([]);
  });

  it('forbid-list: no blue pill but the one allowed', () => {
    expect(REAL.offences).toEqual([]);
  });

  it('every pill’s colour can be read', () => {
    expect(REAL.unreadable).toEqual([]);
  });

  it('the one exception still exists, exactly once, and says why', () => {
    expect(REAL.stale).toEqual([]);
    expect(ALLOWED).toHaveLength(1);
    for (const entry of ALLOWED) {
      expect(entry.reason.length, entry.file).toBeGreaterThan(60);
      expect(isPillShaped(entry.classes), entry.classes).toBe(true);
      expect(blueClasses(entry.classes, 'span').length, entry.classes).toBeGreaterThan(0);
    }
  });

  describe('the checker can fail', () => {
    const FILE = 'apps/light/src/features/elsewhere/Fixture.tsx';
    /** Fixture files by path; anything else is read from disk (the real `app/buttons.ts`). */
    const readerWith = (extra: Readonly<Record<string, string>>): Reader => ({
      read: (path) => extra[path] ?? DISK.read(path),
    });
    const judge = (source: string, extra: Readonly<Record<string, string>> = {}) =>
      findBluePills([{ path: FILE, source }], [], readerWith(extra));

    const MUST_FLAG: readonly (readonly [string, string])[] = [
      [
        'a blue-filled pill',
        '<span className="rounded-pill bg-blue px-2.5 py-0.5 text-ink-inverse">New</span>',
      ],
      [
        'a blue-tinted pill',
        '<span className="rounded-pill bg-blue/10 px-2 py-0.5 text-blue">New</span>',
      ],
      [
        'a blue-edged pill',
        '<span className="rounded-full border border-blue px-2 text-ink">New</span>',
      ],
      [
        'blue words on a label pill',
        '<span className="rounded-pill bg-sunken px-2 text-blue">New</span>',
      ],
      [
        'a pill-shaped blue button',
        '<button className="rounded-pill bg-blue px-3 text-ink-inverse">Go</button>',
      ],
      [
        'a pill that turns blue on hover',
        '<span className="rounded-pill bg-sunken px-2 hover:bg-blue/10">x</span>',
      ],
      [
        'a pill only on a wide window',
        '<span className="rounded-control bg-blue px-2 md:rounded-pill">x</span>',
      ],
      [
        'a blue gradient pill',
        '<span className="rounded-pill bg-linear-to-r from-blue to-navy px-2">x</span>',
      ],
      [
        'a blue entry in a tone table, read by an unknowable key',
        "const TONE = { info: 'bg-blue/10 text-blue', calm: 'bg-sunken' } as const;\n" +
          'const P = ({ kind }: { kind: keyof typeof TONE }) => <span className={`rounded-pill px-2 ${TONE[kind]}`}>x</span>;\n' +
          'export const A = () => <P kind="calm" />;',
      ],
      [
        'a blue tone handed in as a prop in the same file',
        'function Chip({ tone }: { tone: string }) { return <li className={`rounded-pill px-2 ${tone}`}>x</li>; }\n' +
          'export const A = () => <><Chip tone="bg-sunken" /><Chip tone="bg-blue/10 text-blue" /></>;',
      ],
      [
        'a joined class list with a blue branch',
        "export const A = ({ on }: { on: boolean }) => <span className={['rounded-pill px-2', on ? 'bg-blue' : 'bg-sunken'].join(' ')}>x</span>;",
      ],
    ];

    it.each(MUST_FLAG)('flags %s, naming file and line', (_name, jsx) => {
      const report = judge(jsx.includes('export') ? jsx : `export const A = () => ${jsx};`);
      expect(report.offences).toHaveLength(1);
      expect(report.offences[0]).toMatch(new RegExp(`^${FILE}:\\d+ `));
    });

    it('flags a blue pill built from a class constant imported from another file', () => {
      const report = judge(
        "import { BLUE_PILL } from './pills';\nexport const A = () => <span className={BLUE_PILL}>x</span>;",
        {
          'apps/light/src/features/elsewhere/pills.ts':
            "export const BLUE_PILL = 'rounded-pill bg-blue/10 px-2 text-blue';",
        },
      );
      expect(report.offences).toEqual([
        `${FILE}:2 <span> "rounded-pill bg-blue/10 px-2 text-blue" [bg-blue/10 text-blue]`,
      ]);
    });

    it('flags a blue background added to a search chip built from the real QUIET_BUTTON', () => {
      const report = judge(
        "import { QUIET_BUTTON } from '../../app/buttons';\n" +
          'export const A = () => <button className={`${QUIET_BUTTON} rounded-pill border border-line bg-blue/10 px-2 py-0.5 text-xs`}>x</button>;',
      );
      expect(report.offences).toHaveLength(1);
      expect(report.offences[0]).toContain('[bg-blue/10]');
    });

    const MUST_NOT_FLAG: readonly (readonly [string, string])[] = [
      [
        'the blue primary button (the real PRIMARY_BUTTON: rounded-control, not a pill)',
        "import { PRIMARY_BUTTON } from '../../app/buttons';\nexport const A = () => <button className={PRIMARY_BUTTON}>Search</button>;",
      ],
      [
        'a blue text link (the About / key-setup pattern)',
        'import { QUIET_BUTTON } from \'../../app/buttons\';\nexport const A = () => <><button className={`${QUIET_BUTTON} px-0 text-blue hover:bg-card hover:text-navy`}>Terms</button><a className="text-blue underline">x</a></>;',
      ],
      [
        'a blue link in a grey pill (the job board link on a search result)',
        'export const A = () => <button className="inline-flex min-h-[23px] items-center rounded-pill bg-sunken px-2 py-0.5 text-[11px] text-blue uppercase underline hover:text-navy">REED</button>;',
      ],
      [
        'a blue focus ring on a pill',
        'export const A = () => <span tabIndex={0} className="rounded-pill bg-sunken px-2 text-ink-muted focus-visible:border-blue focus-visible:ring-2 focus-visible:ring-blue outline-blue">x</span>;',
      ],
      [
        "the nav's active accent (the real Sidebar pattern, and a nav-accent pill)",
        "export const A = ({ active }: { active: boolean }) => <><button className={['flex w-full items-center rounded-control py-2 pr-3 pl-2.5', 'border-l-2', active ? 'border-l-teal bg-canvas/10 font-medium text-ink-inverse' : 'border-l-transparent text-ink-inverse-muted'].join(' ')}>Search</button><span className=\"rounded-pill bg-nav-accent/10 px-2 text-nav-accent\">x</span></>;",
      ],
      [
        'a blue status dot and a blue bar: rounded, but no words',
        'export const A = () => <><span className="size-2 rounded-pill bg-blue" /><div className="h-2 w-full rounded-pill bg-blue" /></>;',
      ],
      [
        'a checkbox accent and an underline colour',
        'export const A = () => <><input type="checkbox" className="size-4 accent-blue" /><span className="rounded-pill px-2 underline decoration-blue">x</span></>;',
      ],
      [
        'a blue pill in a comment, or in a string that is never a className',
        '// <span className="rounded-pill bg-blue px-2">\n/* rounded-pill bg-blue px-2 */\nexport const note = \'rounded-pill bg-blue px-2\';\nexport const A = () => <span className="rounded-pill bg-sunken px-2">x</span>;',
      ],
      [
        'the search chips as they are (the real QUIET_BUTTON)',
        "import { QUIET_BUTTON } from '../../app/buttons';\nexport const A = () => <button className={`${QUIET_BUTTON} rounded-pill border border-line px-2 py-0.5 text-xs`}>x</button>;",
      ],
      [
        'a blue element that is not pill-shaped',
        '<div className="rounded-card border border-blue p-4">x</div>',
      ],
    ];

    it.each(MUST_NOT_FLAG)('does not flag %s', (_name, source) => {
      const report = judge(
        source.includes('export') ? source : `export const A = () => ${source};`,
      );
      expect(report.offences).toEqual([]);
      expect(report.unreadable).toEqual([]);
    });

    it('a pill whose colour comes from a function call fails as unreadable, by name', () => {
      const report = judge(
        'const pick = () => "bg-sunken";\nexport const A = () => <span className={`rounded-pill px-2 ${pick()}`}>x</span>;',
      );
      expect(report.unreadable).toHaveLength(1);
      expect(report.unreadable[0]).toMatch(
        new RegExp(`^${FILE}:2 <span> pill colour cannot be read: .*function call`),
      );
    });

    it('a pill coloured by a prop of an EXPORTED component fails as unreadable', () => {
      const report = judge(
        'export function Pill({ tone }: { tone: string }) { return <span className={`rounded-pill px-2 ${tone}`}>x</span>; }\n' +
          'export const A = () => <Pill tone="bg-sunken" />;',
      );
      expect(report.unreadable).toHaveLength(1);
      expect(report.unreadable[0]).toContain('exported `Pill`');
    });

    it('negative: an unreadable class list that is not a pill is not reported', () => {
      const report = judge(
        'const pick = () => "bg-blue";\nexport const A = () => <div className={`rounded-card p-3 ${pick()}`}>x</div>;',
      );
      expect(report.unreadable).toEqual([]);
      expect(report.offences).toEqual([]);
    });

    const KEEP: Allowed = {
      file: FILE,
      classes: 'rounded-pill bg-blue px-2 text-ink-inverse',
      reason: 'a made-up exception for these tests, long enough to be a reason to keep it',
    };

    it('boundary: the exception excuses its own pill and nothing beside it', () => {
      const one = findBluePills(
        [
          {
            path: FILE,
            source:
              'export const A = () => <><span className="rounded-pill bg-blue px-2 text-ink-inverse">a</span><span className="rounded-pill bg-blue/10 px-2 text-blue">b</span></>;',
          },
        ],
        [KEEP],
        readerWith({}),
      );
      expect(one.offences).toHaveLength(1);
      expect(one.offences[0]).toContain('bg-blue/10');
      expect(one.stale).toEqual([]);
    });

    it('the exception excuses nothing in another file', () => {
      const report = findBluePills(
        [
          {
            path: 'apps/light/src/other.tsx',
            source:
              'export const A = () => <span className="rounded-pill bg-blue px-2 text-ink-inverse">a</span>;',
          },
        ],
        [KEEP],
        readerWith({}),
      );
      expect(report.offences).toHaveLength(1);
      expect(report.stale).toHaveLength(1);
    });

    it('a stale exception fails, and so does a second copy of its pill', () => {
      const gone = findBluePills(
        [{ path: FILE, source: 'export const a = 1;' }],
        [KEEP],
        readerWith({}),
      );
      expect(gone.stale).toEqual([`${FILE}: "${KEEP.classes}" matched 0 times, not exactly once`]);
      const twice = findBluePills(
        [
          {
            path: FILE,
            source:
              'export const A = () => <><span className="rounded-pill bg-blue px-2 text-ink-inverse">a</span><span className="rounded-pill bg-blue px-2 text-ink-inverse">b</span></>;',
          },
        ],
        [KEEP],
        readerWith({}),
      );
      expect(twice.stale).toEqual([`${FILE}: "${KEEP.classes}" matched 2 times, not exactly once`]);
    });
  });
});
