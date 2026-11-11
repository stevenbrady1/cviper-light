/**
 * The contrast contract (L-209).
 *
 * `text-teal` (#0e9f6e) on `bg-teal/10` or `bg-sunken` measures about 3:1, below
 * the WCAG 2.1 AA floor of 4.5:1 for normal text, and nothing noticed because
 * every token was chosen by eye. This reads theme.css, finds every text colour
 * used in the same class string as a background colour, composites any alpha
 * background over the surface it could sit on, and fails below 4.5:1.
 *
 * ============================================================================
 * HOW IT PAIRS THINGS, AND WHERE IT IS BLIND
 * ============================================================================
 * It is grep-based. It scans the non-test `.ts`/`.tsx` source of `apps/light/src`
 * and `packages/ui/src`, pulls out every quoted string, and inside each string
 * pairs every `text-*` / `placeholder:text-*` token with every `bg-*` token.
 *
 *   * A string with no `bg-*` is checked against `canvas` (the page) and `card`
 *     (a card), the two surfaces text normally lands on.
 *   * A string whose `bg-*` has an alpha (`bg-teal/10`) is composited over
 *     `card`, `canvas` and `sunken`, because the string cannot say which one is
 *     behind it. The worst case decides.
 *   * Variants (`hover:`, `focus:`, `placeholder:`) are ignored when pairing, so
 *     a hover background is checked against the resting text colour. That is
 *     deliberate: it is a state the user really sees.
 *
 * It CANNOT see: a text colour whose background is set by a parent in another
 * component or file (the parent's surface is invisible to a grep), classes built
 * by string concatenation, or inline `style`. Those need a rendered check, and
 * since L-300 there is one: `e2e/contrast-webkit.spec.ts` runs axe on the real,
 * styled app under WebKit in `pnpm webkit` (CI's `webkit` job).
 *
 * ============================================================================
 * NON-TEXT: 3:1 FOR WHAT IDENTIFIES A CONTROL (L-212, WCAG 1.4.11)
 * ============================================================================
 * Two things in this app carry meaning without being text, and both are held
 * to 3:1 below:
 *
 *   * the FOCUS RING, read from theme.css's `:focus-visible` rule, against
 *     every surface a focusable thing sits on (canvas, card, sunken, and the
 *     navy rail);
 *   * the BORDER of every input, select and textarea — the edge is how a user
 *     finds the field. These are found by PARSING the TSX, not by grep: each
 *     element's `className` is followed through template literals, ternaries,
 *     same-file constants and constants IMPORTED from another file (L-357),
 *     and every `border-*` colour it can show is judged against the field's
 *     own background and every surface around it. Any part of a field's
 *     className the reader cannot evaluate (a function call, a prop, a package
 *     import, a cycle) FAILS by name — see "Reading a className" below.
 *
 * Decorative borders (`border-line` on cards and dividers) are not checked:
 * they identify nothing, and WCAG does not ask them for contrast. Icons take
 * `currentColor`, so the text check above already covers them; the app uses
 * no `fill-*`, `stroke-*` or `ring-*` classes, and `no fill-, stroke- or
 * ring- colour classes` below fails the day one appears unchecked. The theme has no dark mode today; `the theme has no dark variant` fails
 * the day one appears, so this audit cannot silently go stale.
 *
 * Large or bold text may be 3:1. Nothing is exempt automatically; if a pair is
 * genuinely large text or an icon, it goes in ALLOWLIST below with a reason.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const THEME = fileURLToPath(new URL('./theme.css', import.meta.url));
const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOTS = [join(REPO, 'apps/light/src'), join(REPO, 'packages/ui/src')];

const AA_TEXT = 4.5;

/** Explicit, justified exceptions. Empty is the goal. */
const ALLOWLIST: readonly { file: string; text: string; bg: string; reason: string }[] = [];

type Rgb = readonly [number, number, number];

function parseTokens(css: string): Map<string, Rgb> {
  const tokens = new Map<string, Rgb>();
  for (const m of css.matchAll(/--color-([a-z-]+):\s*#([0-9a-fA-F]{6})\s*;/g)) {
    const hex = m[2] as string;
    tokens.set(m[1] as string, [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ]);
  }
  return tokens;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at `alpha` over `base`. */
function composite(fg: Rgb, base: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => fg[i]! * alpha + base[i]! * (1 - alpha)) as unknown as Rgb;
}

interface Use {
  readonly name: string;
  readonly alpha: number;
  /** State variants such as `hover` or `disabled`; '' for the resting state. */
  readonly state: string;
}
interface Pair {
  readonly text: Use;
  readonly bg: Use | null;
  readonly line: number;
}

/**
 * States that WCAG 1.4.3 exempts: "inactive user interface components" carry no
 * contrast requirement. A disabled button is the only case in this app.
 */
const EXEMPT_STATES: Readonly<Record<string, string>> = {
  disabled: 'WCAG 1.4.3 exempts inactive (disabled) UI components from the contrast minimum',
};

const BREAKPOINTS = new Set(['sm', 'md', 'lg', 'xl', '2xl']);

function colourRegex(names: readonly string[], prefix: string): RegExp {
  const alt = [...names].sort((a, b) => b.length - a.length).join('|');
  return new RegExp(`(?<![\\w-])((?:[a-z0-9-]+:)*)${prefix}-(${alt})(?:/(\\d+))?(?![\\w-])`, 'g');
}

function uses(body: string, re: RegExp): Use[] {
  return [...body.matchAll(re)].map((m) => ({
    name: m[2] as string,
    alpha: m[3] ? Number(m[3]) / 100 : 1,
    state: (m[1] as string)
      .split(':')
      .filter((v) => v !== '' && !BREAKPOINTS.has(v))
      .join(':'),
  }));
}

// ' and " cannot span lines, which keeps apostrophes in JSX prose from
// swallowing the code between them; only a template literal may.
const LITERAL =
  /'([^'\n\\]*(?:\\.[^'\n\\]*)*)'|"([^"\n\\]*(?:\\.[^"\n\\]*)*)"|`((?:\\[\s\S]|[^`\\])*)`/g;

/**
 * Every text/bg pairing, one quoted string at a time, one STATE at a time. A
 * state (`hover`, `disabled`, ...) replaces the resting colour only where it
 * names one: `bg-blue text-ink-inverse hover:bg-navy` is judged as inverse-on-blue
 * and inverse-on-navy, and `disabled:bg-line disabled:text-ink-faint` as its own
 * pair, never as faint-on-blue.
 */
function findPairs(source: string, names: readonly string[]): Pair[] {
  const textRe = colourRegex(names, 'text');
  const bgRe = colourRegex(names, 'bg');
  const pairs: Pair[] = [];
  for (const lit of source.matchAll(LITERAL)) {
    const body = (lit[1] ?? lit[2] ?? lit[3]) as string;
    const line = source.slice(0, lit.index).split('\n').length;
    const texts = uses(body, textRe);
    if (texts.length === 0) continue;
    const bgs = uses(body, bgRe);
    const states = new Set([...texts, ...bgs].map((u) => u.state));
    states.add('');
    for (const state of states) {
      const own = texts.filter((u) => u.state === state);
      const stateTexts = own.length > 0 ? own : texts.filter((u) => u.state === '');
      const ownBg = bgs.filter((u) => u.state === state);
      const stateBgs = ownBg.length > 0 ? ownBg : bgs.filter((u) => u.state === '');
      for (const text of stateTexts) {
        if (stateBgs.length === 0) pairs.push({ text, bg: null, line });
        for (const bg of stateBgs) pairs.push({ text, bg, line });
      }
    }
  }
  return pairs;
}

/** Ink that is only ever read on the navy rail: it is judged against navy. */
const INVERSE = new Set(['ink-inverse', 'ink-inverse-muted']);

const BASE_SURFACES = ['canvas', 'card'] as const;
const ALPHA_SURFACES = ['card', 'canvas', 'sunken'] as const;

/** Lowest ratio over every surface the pair could sit on. */
function worstRatio(pair: Pair, tokens: Map<string, Rgb>): number {
  const get = (n: string): Rgb => {
    const v = tokens.get(n);
    if (!v) throw new Error(`no --color-${n} in theme.css`);
    return v;
  };
  const inverse = INVERSE.has(pair.text.name);
  const surfaces: Rgb[] = [];
  if (pair.bg === null) {
    for (const s of inverse ? ['navy'] : BASE_SURFACES) surfaces.push(get(s));
  } else if (pair.bg.alpha >= 1) {
    surfaces.push(get(pair.bg.name));
  } else {
    for (const s of inverse ? ['navy'] : ALPHA_SURFACES) {
      surfaces.push(composite(get(pair.bg.name), get(s), pair.bg.alpha));
    }
  }
  return Math.min(
    ...surfaces.map((surface) =>
      contrast(composite(get(pair.text.name), surface, pair.text.alpha), surface),
    ),
  );
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') found.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found.sort();
}

/** Bare brand colours as text: `text-teal`, `hover:text-gold`; not `text-teal-ink`. */
const BARE_BRAND_TEXT = /(?<![w-])(?:[a-z0-9-]+:)*text-(?:teal|gold)(?![w-])/g;

const css = readFileSync(THEME, 'utf8');
const tokens = parseTokens(css);
const names = [...tokens.keys()];

function label(bg: Use | null): string {
  if (bg === null) return '(page/card)';
  return bg.alpha < 1 ? `${bg.name}/${Math.round(bg.alpha * 100)}` : bg.name;
}

function failures(): string[] {
  const out: string[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      const rel = relative(REPO, file).replaceAll('\\', '/');
      for (const pair of findPairs(readFileSync(file, 'utf8'), names)) {
        if (pair.text.state.split(':').some((v) => v in EXEMPT_STATES)) continue;
        const ratio = worstRatio(pair, tokens);
        if (ratio >= AA_TEXT) continue;
        const bg = label(pair.bg);
        if (ALLOWLIST.some((a) => a.file === rel && a.text === pair.text.name && a.bg === bg)) {
          continue;
        }
        out.push(`${rel}:${pair.line}  text-${pair.text.name} on ${bg} = ${ratio.toFixed(2)}:1`);
      }
    }
  }
  return out;
}

describe('text contrast contract (WCAG 2.1 AA, 4.5:1)', () => {
  it('finds the theme tokens and the source files', () => {
    expect(tokens.get('teal')).toBeDefined();
    expect(names.length).toBeGreaterThan(10);
    expect(ROOTS.flatMap(sourceFiles).length).toBeGreaterThan(20);
  });

  it('every text colour used with a background meets 4.5:1', () => {
    expect(failures()).toEqual([]);
  });

  it('no source uses bare text-teal or text-gold; words use the -ink tokens', () => {
    const offences: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        const found = readFileSync(file, 'utf8').match(BARE_BRAND_TEXT);
        if (found) offences.push(`${relative(REPO, file)}: ${found.join(', ')}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('allowlist entries each carry a reason', () => {
    for (const a of ALLOWLIST) expect(a.reason.length).toBeGreaterThan(10);
  });

  it('the theme has no dark variant, so the light-only audit is complete', () => {
    expect(css).not.toMatch(/prefers-color-scheme:\s*dark|\.dark\b|\[data-theme/);
  });

  describe('the checker can actually fail', () => {
    it('flags the L-209 case: a teal tint under teal text, from the original tokens', () => {
      const original = new Map(tokens);
      original.set('teal', [0x0e, 0x9f, 0x6e]);
      const [pair] = findPairs("const c = 'bg-teal/10 px-3 text-teal';", names);
      expect(pair).toBeDefined();
      expect(worstRatio(pair!, original)).toBeLessThan(AA_TEXT);
    });

    it('composites alpha rather than using the raw token', () => {
      const [pair] = findPairs("'bg-gold/10 text-ink'", names);
      const raw = contrast(tokens.get('ink')!, tokens.get('gold')!);
      expect(worstRatio(pair!, tokens)).toBeGreaterThan(raw);
    });

    it('does not confuse text-ink with text-ink-muted or text-xs', () => {
      const pairs = findPairs("'text-ink-muted text-xs bg-card'", names);
      expect(pairs.map((p) => p.text.name)).toEqual(['ink-muted']);
    });

    it('sees variant-prefixed tokens and judges a failing pair', () => {
      const weak = new Map(tokens);
      weak.set('ink-faint', [0x9a, 0xa5, 0xb5]);
      const pairs = findPairs("'placeholder:text-ink-faint bg-sunken'", names);
      expect(pairs).toHaveLength(1);
      expect(worstRatio(pairs[0]!, weak)).toBeLessThan(AA_TEXT);
    });

    it('the bare-brand guard catches text-teal and variants, not the -ink tokens', () => {
      const hits = "'text-teal hover:text-gold text-teal-ink text-gold-ink'".match(BARE_BRAND_TEXT);
      expect(hits).toEqual(['text-teal', 'hover:text-gold']);
    });

    it('pairs and judges a group-hover: variant', () => {
      const weak = new Map(tokens);
      weak.set('ink-faint', [0x9a, 0xa5, 0xb5]);
      const pairs = findPairs("'bg-card group-hover:text-ink-faint'", names);
      expect(pairs.map((p) => p.text.state)).toContain('group-hover');
      expect(pairs.every((p) => worstRatio(p, weak) < AA_TEXT)).toBe(true);
    });

    it('a placeholder: text colour is judged against the surrounding background', () => {
      const [pair] = findPairs("'bg-sunken placeholder:text-ink-faint'", names);
      expect(pair!.text.state).toBe('placeholder');
      expect(pair!.bg?.name).toBe('sunken');
      expect(worstRatio(pair!, tokens)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it('boundary: black on white is 21:1, the same colour is 1:1', () => {
      expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
      expect(contrast([9, 9, 9], [9, 9, 9])).toBeCloseTo(1, 5);
    });

    it('negative: a string with no text colour yields no pairs', () => {
      expect(findPairs("'bg-sunken px-3'", names)).toEqual([]);
    });
  });
});

// ── Non-text contrast (L-212) ───────────────────────────────────────────────

const AA_NON_TEXT = 3;

/** Surfaces a field or a focusable element can sit on. */
const CONTROL_SURFACES = ['canvas', 'card', 'sunken'] as const;
const FOCUS_SURFACES = ['canvas', 'card', 'sunken', 'navy'] as const;

/** Input types the browser draws without a box the user has to find by its edge. */
const BOXLESS_INPUTS = new Set([
  'checkbox',
  'radio',
  'hidden',
  'range',
  'file',
  'color',
  'submit',
  'button',
  'reset',
  'image',
]);

interface Control {
  readonly file: string;
  readonly line: number;
  readonly tag: string;
  /**
   * Every whole class list the className can come out as (one per branch of
   * each ternary), or `null` when it has no className.
   */
  readonly classes: readonly string[] | null;
  /**
   * Each part of the className the reader could not evaluate, named with where
   * it is and why (L-357). Every entry is a failure: an unread part could hold
   * the edge colour, so it can never count as checked.
   */
  readonly unreadable?: readonly string[];
}

// ── Reading a className, across files (L-357) ───────────────────────────────
//
// The reader EVALUATES a className rather than collecting every quoted string
// near it. It understands string and template literals, `+`, ternaries
// (both branches), `||`, `??`, `&&`, constants in the same file, constants
// imported from a relative path (a renamed import, a namespace import, a
// re-export and an index file included), and property or index lookups into a
// constant object. A lookup by a value it cannot know (`TONES[urgency]`) reads
// EVERY value in the object. Anything else — a function call, a prop, a
// parameter, a package import, a cycle — is an `unreadable` entry with its
// file, line and text, and `controlProblems` fails on it.
//
// It works on the TypeScript syntax tree, so a class named in a comment is
// neither seen nor counted. Conditions (`ok` in `ok ? A : B`) are not read:
// they decide WHICH class list applies, and both are judged.

/** Where the reader gets the text of a file it follows an import into. */
interface Reader {
  /** The file's text, or `undefined` when there is no such file. */
  read(path: string): string | undefined;
}

/** Repo-relative paths, read from disk. */
const DISK: Reader = {
  read: (path) => {
    try {
      return readFileSync(join(REPO, path), 'utf8');
    } catch {
      return undefined; // becomes a named "cannot find" failure, never a pass
    }
  },
};

/** More combinations than this is a class list nobody could check by eye either. */
const MAX_CLASS_LISTS = 256;

interface Module {
  readonly path: string;
  readonly tree: ts.SourceFile;
  /** Every variable with an initializer, by name. More than one is ambiguous. */
  readonly locals: ReadonlyMap<string, readonly ts.Expression[]>;
  /** Local name → the module it is imported from and its name there (`*` = namespace). */
  readonly imports: ReadonlyMap<string, { readonly from: string; readonly name: string }>;
  /** Exported name → local name. */
  readonly exports: ReadonlyMap<string, string>;
  /** Exported name → `export { name as X } from 'from'`. */
  readonly reexports: ReadonlyMap<string, { readonly from: string; readonly name: string }>;
  readonly starExports: readonly string[];
  readonly defaultExport: ts.Expression | undefined;
}

function parseModule(path: string, source: string): Module {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const locals = new Map<string, ts.Expression[]>();
  const imports = new Map<string, { from: string; name: string }>();
  const exports = new Map<string, string>();
  const reexports = new Map<string, { from: string; name: string }>();
  const starExports: string[] = [];
  let defaultExport: ts.Expression | undefined;

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
        if (ts.isIdentifier(declaration.name)) {
          exports.set(declaration.name.text, declaration.name.text);
        }
      }
    } else if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier;
      const from = specifier && ts.isStringLiteral(specifier) ? specifier.text : undefined;
      const clause = statement.exportClause;
      if (clause === undefined) {
        if (from !== undefined) starExports.push(from);
      } else if (ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          const name = (element.propertyName ?? element.name).text;
          if (from === undefined) exports.set(element.name.text, name);
          else reexports.set(element.name.text, { from, name });
        }
      } else if (from !== undefined) {
        reexports.set(clause.name.text, { from, name: '*' });
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      defaultExport = statement.expression;
    }
  }
  return { path, tree, locals, imports, exports, reexports, starExports, defaultExport };
}

/** What a name or a lookup stands for, and the chain of names that led to it. */
type Binding =
  | { readonly node: ts.Expression; readonly module: Module; readonly chain: readonly string[] }
  | { readonly namespace: Module; readonly chain: readonly string[] };

interface Reading {
  readonly values: readonly string[];
  readonly unreadable: readonly string[];
}

/** Evaluates className expressions that start in `entry`, following its imports through `reader`. */
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

  /** The object literals (or modules) a lookup's left-hand side can be. */
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

  /** What `X.key` or `X[key]` can be. An unknowable key means every value. */
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

  const evaluate = (node: ts.Expression, module: Module, chain: readonly string[]): Reading => {
    const fail = (why: string): Reading => {
      const at = module.tree.getLineAndCharacterOfPosition(node.getStart(module.tree)).line + 1;
      const text = node.getText(module.tree).replace(/\s+/g, ' ');
      const shown = text.length > 80 ? `${text.slice(0, 77)}...` : text;
      // '' keeps the readable rest of the class list judged beside this failure.
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

  return (start) => evaluate(start, entry, []);
}

/** Every input, select and textarea in a TSX file, with what its className can hold. */
function findControls(file: string, source: string, reader: Reader = DISK): Control[] {
  const entry = parseModule(file, source);
  const tree = entry.tree;
  const read = classReader(reader, entry);

  const controls: Control[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      ['input', 'select', 'textarea'].includes(node.tagName.text)
    ) {
      let type = '';
      let classes: string[] | null = null;
      const unreadable: string[] = [];
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) {
          // A spread can carry a className of its own, which nothing here reads.
          const at = tree.getLineAndCharacterOfPosition(attribute.getStart(tree)).line + 1;
          unreadable.push(
            `\`${attribute.getText(tree)}\` at ${file}:${at}: spread attributes may set a className the reader cannot see`,
          );
          continue;
        }
        if (attribute.initializer === undefined) continue;
        const name = attribute.name.getText(tree);
        if (name === 'type' && ts.isStringLiteral(attribute.initializer)) {
          type = attribute.initializer.text;
        }
        if (name === 'className') {
          const initializer = attribute.initializer;
          const expression = ts.isJsxExpression(initializer)
            ? initializer.expression
            : (initializer as ts.Expression);
          if (expression === undefined) {
            classes = [];
            unreadable.push(`an empty \`className={}\` at ${file}`);
          } else {
            const reading = read(expression);
            classes = [...reading.values];
            unreadable.push(...reading.unreadable);
          }
        }
      }
      if (!BOXLESS_INPUTS.has(type)) {
        controls.push({
          file,
          line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
          tag: node.tagName.text,
          classes,
          unreadable,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return controls;
}

function get(name: string, palette: Map<string, Rgb> = tokens): Rgb {
  const value = palette.get(name);
  if (!value) throw new Error(`no --color-${name} in theme.css`);
  return value;
}

/** Every reason one field's edge is too faint, or none. */
function controlProblems(control: Control, palette: Map<string, Rgb> = tokens): string[] {
  const where = `${control.file}:${control.line} <${control.tag}>`;
  // L-357: a part of the className that could not be read could hold the
  // edge colour, so each one is a failure in its own right.
  const unread = (control.unreadable ?? []).map(
    (why) => `${where} className cannot be read: ${why}`,
  );
  if (control.classes === null) {
    return [
      ...unread,
      `${where} has no className, so its edge is the browser's, not a checked colour`,
    ];
  }
  const body = control.classes.join(' ');
  const borders = uses(body, colourRegex(names, 'border')).filter(
    (u) => !u.state.split(':').some((v) => v in EXEMPT_STATES),
  );
  if (!borders.some((u) => u.state === '')) {
    // With an unread part, "no border" may only mean the reader could not see it.
    return unread.length > 0
      ? unread
      : [`${where} has no resting border colour, so nothing marks where the field is`];
  }
  const fill = uses(body, colourRegex(names, 'bg')).find((u) => u.state === '');
  const problems: string[] = [...unread];
  for (const border of borders) {
    for (const surfaceName of CONTROL_SURFACES) {
      const surface = get(surfaceName, palette);
      const inside =
        fill === undefined ? surface : composite(get(fill.name, palette), surface, fill.alpha);
      const edge = composite(get(border.name, palette), surface, border.alpha);
      const ratio = Math.min(contrast(edge, surface), contrast(edge, inside));
      if (ratio < AA_NON_TEXT) {
        const state = border.state === '' ? '' : `${border.state}:`;
        problems.push(
          `${where} ${state}border-${border.name} on ${surfaceName} = ${ratio.toFixed(2)}:1`,
        );
      }
    }
  }
  return problems;
}

/** Each layer of the `:focus-visible` box-shadow: its colour and opacity. */
function focusRing(
  themeCss: string,
  palette: Map<string, Rgb> = tokens,
): { rgb: Rgb; alpha: number }[] {
  const rule = /:focus-visible\s*\{([^}]*)\}/.exec(themeCss)?.[1] ?? '';
  const shadow = /box-shadow:\s*([^;]+);/.exec(rule)?.[1] ?? '';
  const layers: { rgb: Rgb; alpha: number }[] = [];
  for (const layer of shadow.split(/,(?![^(]*\))/)) {
    const token = /var\(--color-([a-z-]+)\)/.exec(layer);
    const rgb = /rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)/.exec(layer);
    if (token) layers.push({ rgb: get(token[1]!, palette), alpha: 1 });
    else if (rgb) {
      layers.push({
        rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])],
        alpha: rgb[4] === undefined ? 1 : Number(rgb[4]),
      });
    }
  }
  return layers;
}

/** For each surface, the best ring layer's ratio against it — some layer must reach 3:1. */
function focusRingProblems(themeCss: string, palette: Map<string, Rgb> = tokens): string[] {
  const layers = focusRing(themeCss, palette);
  if (layers.length === 0) return ['theme.css has no readable :focus-visible box-shadow'];
  const problems: string[] = [];
  for (const surfaceName of FOCUS_SURFACES) {
    const surface = get(surfaceName, palette);
    const best = Math.max(
      ...layers.map((layer) => contrast(composite(layer.rgb, surface, layer.alpha), surface)),
    );
    if (best < AA_NON_TEXT) {
      problems.push(`focus ring on ${surfaceName} = ${best.toFixed(2)}:1 at its strongest layer`);
    }
  }
  return problems;
}

const allControls = ROOTS.flatMap((root) =>
  sourceFiles(root)
    .filter((file) => file.endsWith('.tsx'))
    .flatMap((file) =>
      findControls(relative(REPO, file).replaceAll('\\', '/'), readFileSync(file, 'utf8')),
    ),
);

describe('non-text contrast contract (WCAG 2.1 AA 1.4.11, 3:1) — L-212', () => {
  it('finds the fields at all (a broken parse must not pass vacuously)', () => {
    expect(allControls.length).toBeGreaterThanOrEqual(40);
    expect(allControls.map((c) => c.tag)).toEqual(
      expect.arrayContaining(['input', 'select', 'textarea']),
    );
  });

  it('every input, select and textarea has an edge of 3:1 or more, in every state', () => {
    expect(allControls.flatMap((control) => controlProblems(control))).toEqual([]);
  });

  it('the focus ring reaches 3:1 on every surface, including the navy rail', () => {
    expect(focusRingProblems(css)).toEqual([]);
  });

  it('no fill-, stroke- or ring- colour classes, which nothing here would check', () => {
    const offences: string[] = [];
    const pattern = colourRegex(names, '(?:fill|stroke|ring|outline|divide)');
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        const found = readFileSync(file, 'utf8').match(pattern);
        if (found) offences.push(`${relative(REPO, file)}: ${found.join(', ')}`);
      }
    }
    expect(offences).toEqual([]);
  });

  describe('the checker can actually fail', () => {
    const field = (classes: string): Control => ({
      file: 'x.tsx',
      line: 1,
      tag: 'input',
      classes: [classes],
    });

    it('flags the L-212 case: a field edged in the divider colour', () => {
      const problems = controlProblems(field('rounded-control border border-line bg-card'));
      expect(problems.length).toBeGreaterThan(0);
      expect(problems[0]).toContain('border-line');
    });

    it('flags the old focus ring: blue at 25% opacity', () => {
      const old = ':focus-visible { outline: none; box-shadow: 0 0 0 3px rgb(26 86 219 / 0.25); }';
      expect(focusRingProblems(old)).toHaveLength(FOCUS_SURFACES.length);
    });

    it('flags a ring that is solid blue alone: it vanishes on the navy rail', () => {
      const blueOnly = ':focus-visible { box-shadow: 0 0 0 2px var(--color-blue); }';
      expect(focusRingProblems(blueOnly)).toEqual([expect.stringContaining('navy')]);
    });

    it('negative: a field with no border colour, or no className, is a problem', () => {
      expect(controlProblems(field('rounded-control bg-card px-2'))).toHaveLength(1);
      expect(controlProblems({ ...field(''), classes: null })).toHaveLength(1);
    });

    it('judges a state border too: a faint focus: edge fails even over a strong resting one', () => {
      const problems = controlProblems(field('border border-field-line focus:border-line bg-card'));
      expect(problems.some((p) => p.includes('focus:border-line'))).toBe(true);
    });

    it('a disabled: border is exempt, as WCAG exempts inactive controls', () => {
      expect(
        controlProblems(field('border border-field-line disabled:border-line bg-card')),
      ).toEqual([]);
    });

    it('follows a className through a ternary and a same-file constant', () => {
      const source = [
        "const EDGE = 'border-field-line';",
        "export const A = () => <input className={`border ${ok ? EDGE : 'border-danger'}`} />;",
        'export const B = () => <input type="checkbox" className="border-line" />;',
      ].join('\n');
      const [only, ...rest] = findControls('x.tsx', source);
      expect(rest).toEqual([]);
      expect(only!.classes!.join(' ')).toContain('border-field-line');
      expect(only!.classes!.join(' ')).toContain('border-danger');
    });
  });
});

// ── Following a field's classes into other files (L-357) ────────────────────

describe('the field reader follows imports and names what it cannot read — L-357', () => {
  /** A pretend source tree: repo-relative path → text. */
  const tree = (files: Readonly<Record<string, string>>): Reader => ({
    read: (path) => files[path],
  });
  const only = (file: string, files: Readonly<Record<string, string>>): Control => {
    const found = findControls(file, files[file]!, tree(files));
    expect(found).toHaveLength(1);
    return found[0]!;
  };
  const GOOD = "export const FIELD = 'rounded-control border border-field-line bg-card';";

  it('follows an imported constant into the file it comes from', () => {
    const control = only('features/a.tsx', {
      'app/fields.ts': GOOD,
      'features/a.tsx':
        "import { FIELD } from '../app/fields';\nexport const A = () => <input className={FIELD} />;",
    });
    expect(control.classes!.join(' ')).toContain('border-field-line');
    expect(controlProblems(control)).toEqual([]);
  });

  it('judges what it finds there: a too-faint imported edge fails', () => {
    const control = only('features/a.tsx', {
      'app/fields.ts': "export const FIELD = 'rounded-control border border-line bg-card';",
      'features/a.tsx':
        "import { FIELD } from '../app/fields';\nexport const A = () => <input className={FIELD} />;",
    });
    expect(controlProblems(control).length).toBeGreaterThan(0);
    expect(controlProblems(control).every((p) => p.includes('border-line on'))).toBe(true);
  });

  it('follows a renamed import (import { FIELD as F })', () => {
    const control = only('features/a.tsx', {
      'app/fields.ts': GOOD,
      'features/a.tsx':
        "import { FIELD as F } from '../app/fields';\nexport const A = () => <textarea className={F} />;",
    });
    expect(control.classes!.join(' ')).toContain('border-field-line');
    expect(controlProblems(control)).toEqual([]);
  });

  it('follows a namespace import (F.FIELD) into an index file', () => {
    const control = only('features/a.tsx', {
      'app/fields/index.ts': GOOD,
      'features/a.tsx':
        "import * as F from '../app/fields';\nexport const A = () => <select className={F.FIELD} />;",
    });
    expect(control.classes!.join(' ')).toContain('border-field-line');
    expect(controlProblems(control)).toEqual([]);
  });

  it('follows a re-export (export { FIELD } from ...)', () => {
    const control = only('features/a.tsx', {
      'app/fields.ts': GOOD,
      'app/index.ts': "export { FIELD as BOX } from './fields';",
      'features/a.tsx':
        "import { BOX } from '../app';\nexport const A = () => <input className={BOX} />;",
    });
    expect(control.classes!.join(' ')).toContain('border-field-line');
  });

  it('boundary: a template literal mixing an imported constant with literal classes', () => {
    const control = only('features/a.tsx', {
      'app/fields.ts': [
        GOOD,
        "export const FIELD_INVALID = 'rounded-control border border-danger bg-card';",
      ].join('\n'),
      'features/a.tsx': [
        "import { FIELD, FIELD_INVALID } from '../app/fields';",
        'export const A = ({ bad }: { bad: boolean }) => (',
        '  <input className={`mt-1 w-full ${bad ? FIELD_INVALID : FIELD} text-ink`} />',
        ');',
      ].join('\n'),
    });
    const all = control.classes!.join(' ');
    for (const cls of ['mt-1', 'w-full', 'border-field-line', 'border-danger', 'text-ink']) {
      expect(all).toContain(cls);
    }
    expect(controlProblems(control)).toEqual([]);
  });

  it('boundary: a class glued across a substitution is read whole, not lost', () => {
    const control = only('features/a.tsx', {
      'app/tones.ts': "export const EDGE = 'line';",
      'features/a.tsx': [
        "import { EDGE } from '../app/tones';",
        'export const A = () => (',
        '  <input className={`border border-field-line bg-card focus:border-${EDGE}`} />',
        ');',
      ].join('\n'),
    });
    expect(controlProblems(control)).toEqual(
      expect.arrayContaining([expect.stringContaining('focus:border-line')]),
    );
  });

  it('reads every value of an imported record indexed by a variable (the ApplicationDetail shape)', () => {
    const control = only('features/a.tsx', {
      'features/tones.ts': [
        'export const TONES: Record<string, string> = {',
        "  soon: 'text-gold-ink',",
        "  overdue: 'text-danger',",
        '};',
      ].join('\n'),
      'features/a.tsx': [
        "import { TONES } from './tones';",
        'export const A = ({ u }: { u: string }) => (',
        "  <input className={`border border-field-line bg-card ${u === 'none' ? 'text-ink' : TONES[u]}`} />",
        ');',
      ].join('\n'),
    });
    const all = control.classes!.join(' ');
    expect(all).toContain('text-gold-ink');
    expect(all).toContain('text-danger');
    expect(controlProblems(control)).toEqual([]);
  });

  describe('negative: what it cannot read is a NAMED failure, never a silent pass', () => {
    const problemsOf = (classNameExpression: string): string[] =>
      controlProblems(
        only('features/a.tsx', {
          'app/fields.ts': GOOD,
          'features/a.tsx': [
            "import { FIELD } from '../app/fields';",
            "import { cn } from '../app/cn';",
            'export const A = (props: { className: string; on: boolean }) => (',
            `  <input className={${classNameExpression}} />`,
            ');',
          ].join('\n'),
        }),
      );

    it('a function call', () => {
      expect(problemsOf('cn(FIELD)')).toEqual([
        expect.stringMatching(/features\/a\.tsx:4 <input>.*cannot be read.*cn\(FIELD\)/),
      ]);
    });

    it('an identifier that is not a constant or an import (a prop)', () => {
      expect(problemsOf('`${FIELD} ${props.className}`')).toEqual([
        expect.stringContaining('props.className'),
      ]);
    });

    it('a value from the props, even beside a readable border', () => {
      expect(problemsOf('props.on ? FIELD : props.className')).toEqual([
        expect.stringContaining('props.className'),
      ]);
    });

    it('an import whose file has no such export', () => {
      const problems = controlProblems(
        only('features/a.tsx', {
          'app/fields.ts': "export const OTHER = 'border-field-line';",
          'features/a.tsx':
            "import { FIELD } from '../app/fields';\nexport const A = () => <input className={FIELD} />;",
        }),
      );
      expect(problems).toEqual([expect.stringMatching(/app\/fields\.ts has no export `FIELD`/)]);
    });

    it('an import from a file that does not exist', () => {
      const problems = controlProblems(
        only('features/a.tsx', {
          'features/a.tsx':
            "import { FIELD } from '../app/nope';\nexport const A = () => <input className={FIELD} />;",
        }),
      );
      expect(problems).toEqual([expect.stringContaining("cannot find '../app/nope'")]);
    });

    it('an import from a package, which it does not follow', () => {
      const problems = controlProblems(
        only('features/a.tsx', {
          'features/a.tsx':
            "import { FIELD } from '@cviper/ui';\nexport const A = () => <input className={FIELD} />;",
        }),
      );
      expect(problems).toEqual([expect.stringContaining("'@cviper/ui'")]);
    });

    it('an import cycle ends as a named failure, not a hang or a pass', () => {
      const problems = controlProblems(
        only('features/a.tsx', {
          'app/x.ts': "import { Y } from './y';\nexport const X = Y;",
          'app/y.ts': "import { X } from './x';\nexport const Y = X;",
          'features/a.tsx':
            "import { X } from '../app/x';\nexport const A = () => <input className={X} />;",
        }),
      );
      expect(problems).toEqual([expect.stringContaining('cycle')]);
    });

    it('a constant declared twice in one file is ambiguous, not "the last one"', () => {
      const problems = controlProblems(
        only('features/a.tsx', {
          'features/a.tsx': [
            "function f() { const EDGE = 'border-line'; return EDGE; }",
            "const EDGE = 'border border-field-line';",
            'export const A = () => <input className={EDGE} />;',
          ].join('\n'),
        }),
      );
      expect(problems).toEqual([expect.stringContaining('EDGE')]);
    });
  });

  it('a class mentioned only in a comment is ignored, here and in the imported file', () => {
    const control = only('features/a.tsx', {
      'app/fields.ts': [
        "// FIELD used to be 'rounded-control border border-field-line bg-card'.",
        '/** Edge: border-field-line. */',
        "export const FIELD = /* border-field-line */ 'rounded-control border border-line bg-card';",
      ].join('\n'),
      'features/a.tsx': [
        "import { FIELD } from '../app/fields';",
        "// <input className='border-field-line' />",
        'export const A = () => <input className={/* border-field-line */ FIELD} />;',
      ].join('\n'),
    });
    expect(control.classes!.join(' ')).not.toContain('border-field-line');
    const problems = controlProblems(control);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.includes('border-line on'))).toBe(true);
  });

  it('on the real tree: the ApplicationDetail date box is now read whole, tones included', () => {
    const detail = allControls.filter((c) =>
      c.file.endsWith('features/tracker/ApplicationDetail.tsx'),
    );
    const dateBox = detail.find((c) => c.classes?.join(' ').includes('text-gold-ink'));
    expect(dateBox, 'the next-action tones from nextAction.ts were not followed').toBeDefined();
    expect(dateBox!.classes!.join(' ')).toContain('text-danger');
    expect(controlProblems(dateBox!)).toEqual([]);
  });
});
