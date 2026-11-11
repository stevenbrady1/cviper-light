/**
 * The ONE reader of the theme's colours (L-366), shared by every check that
 * measures them: `styles/contrast.contract.test.ts`,
 * `ui/sectionIconAccent.contract.test.ts` and `ui/navAccent.contract.test.ts`.
 *
 * This is NOT a test module (see `lib/repo-scan.ts` for why that matters): it
 * has no suites, so the three checks can import it without re-registering
 * anything. It is test-only code all the same — nothing the app ships imports
 * it.
 *
 * ============================================================================
 * WHY ONE READER, AND WHY IT REFUSES RATHER THAN SKIPS
 * ============================================================================
 * Each check used to read theme.css with its own regular expression for
 * `--color-name: #rrggbb;`. The contrast check, which reads the whole palette,
 * had three blind spots, each of which made a colour unchecked without
 * anything going red:
 *
 *   * a colour written any other way (`rgb(...)`, `#fff`, `var(--color-x)`)
 *     did not match, so it was not measured at all;
 *   * a colour declared twice was measured at its last value only;
 *   * a colour declared in another style file was never read, and one in
 *     another block of theme.css (a media query, another selector) silently
 *     replaced the light value.
 *
 * The two accent checks read named tokens and failed on a missing or doubled
 * one, but never looked past theme.css either.
 *
 * A dark colour set added later would have walked straight through all three
 * and been half-checked. So this reader knows exactly ONE colour set, `light`,
 * and treats everything it cannot account for as a named error.
 *
 * ============================================================================
 * WHAT COUNTS AS A COLOUR TOKEN
 * ============================================================================
 * By NAME: a custom property whose name starts with `--color-`. That is
 * Tailwind 4's colour namespace, the only names that become `bg-*`, `text-*`
 * and `border-*` utilities. Everything else (`--font-*`, `--text-*`,
 * `--radius-*`, `--shadow-*`, spacing) is not a colour token and is ignored,
 * with one exception: a custom property under any OTHER name whose whole value
 * is a colour (`--brand: #17a2b8`, `--ring: var(--color-blue)`) is an error,
 * because a colour under a name nothing reads is a colour nothing checks.
 * Shadows (`0 0 0 1px rgb(...)`) are not a whole-value colour and stay out of
 * scope.
 *
 * ============================================================================
 * THE RULES (each failure carries its code in square brackets)
 * ============================================================================
 *   [no-light-set]                    theme.css has no top-level `@theme` block
 *   [light-set-declared-twice]        it has more than one
 *   [declared-twice]                  a colour token appears twice in the set
 *   [unknown-colour-format]           a value that is not `#rrggbb` or
 *                                     `var(--color-name)`
 *   [missing-reference]               `var(--color-x)` with no `--color-x`
 *   [reference-cycle]                 `a -> b -> a`; ends, never hangs
 *   [colour-outside-light-set]        a `--color-*` declaration anywhere but
 *                                     directly inside the light set: another
 *                                     selector, a media query, a nested block,
 *                                     `@theme inline`, another style file
 *   [colour-outside-colour-namespace] see above
 *   [unreadable-stylesheet]           unbalanced braces, an unclosed comment
 *
 * Adding a second set (dark) therefore cannot be done by writing CSS alone:
 * every one of its colours fails `colour-outside-light-set` until somebody
 * teaches `COLOUR_SETS` the new set, and the checks that read it, on purpose.
 *
 * Comments are removed before anything is read (a `/*` inside a quoted string
 * is not a comment), so a colour mentioned in a comment is neither a token nor
 * an error.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import { REPO_ROOT, displayPath, walk } from '../lib/repo-scan';

export type Rgb = readonly [number, number, number];

/** A style file's text, with its repo-relative path (forward slashes). */
export interface StyleSheet {
  readonly path: string;
  readonly text: string;
}

export interface ColourToken {
  /** Without the prefix: `teal-ink` for `--color-teal-ink`. */
  readonly name: string;
  /** The resolved value, lowercase `#rrggbb`. */
  readonly hex: string;
  readonly rgb: Rgb;
  /** The value as written: `#0a6c4b`, or `var(--color-canvas)`. */
  readonly written: string;
  /** `path:line` of the declaration. */
  readonly at: string;
  /** The tokens followed to reach the value, in order; `[]` for a literal. */
  readonly via: readonly string[];
}

export type ProblemCode =
  | 'no-light-set'
  | 'light-set-declared-twice'
  | 'declared-twice'
  | 'unknown-colour-format'
  | 'missing-reference'
  | 'reference-cycle'
  | 'colour-outside-light-set'
  | 'colour-outside-colour-namespace'
  | 'unreadable-stylesheet';

export interface ThemeProblem {
  readonly code: ProblemCode;
  readonly at: string;
  readonly message: string;
}

/** Thrown with EVERY problem found, not only the first. */
export class ThemeTokenError extends Error {
  constructor(readonly problems: readonly ThemeProblem[]) {
    super(
      [
        `The theme's colours cannot be read (${problems.length} problem${problems.length === 1 ? '' : 's'}):`,
        ...problems.map((p) => `  [${p.code}] ${p.at}: ${p.message}`),
      ].join('\n'),
    );
    this.name = 'ThemeTokenError';
  }
}

/**
 * The colour sets the reader knows: exactly one. A second set is a deliberate
 * change here, never something the reader picks up by itself.
 */
export const COLOUR_SETS = {
  light: { file: 'apps/light/src/styles/theme.css', block: '@theme' },
} as const;

export interface ColourSets {
  readonly light: ReadonlyMap<string, ColourToken>;
}

// ── Reading CSS ─────────────────────────────────────────────────────────────

/**
 * Replace every comment with blanks, keeping its newlines so line numbers
 * survive. Quoted strings are copied as they are, so a `/*` inside one is not
 * a comment.
 */
export function stripCssComments(text: string): string {
  return withoutComments(text).text;
}

/** As `stripCssComments`, and where an unclosed comment opens (-1 if none). */
function withoutComments(text: string): { text: string; unclosedAt: number } {
  let out = '';
  let unclosedAt = -1;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) unclosedAt = i;
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (c === '"' || c === "'") {
      const stop = endOfString(text, i);
      out += text.slice(i, stop);
      i = stop;
    } else {
      out += c;
      i += 1;
    }
  }
  return { text: out, unclosedAt };
}

/** The index just past the string that opens at `start`. */
function endOfString(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote && text[i] !== '\n') {
    i += text[i] === '\\' ? 2 : 1;
  }
  return Math.min(i + 1, text.length);
}

interface Declaration {
  readonly name: string;
  readonly value: string;
  readonly at: string;
  /** The preludes of the blocks it sits in, outermost first: `['@theme']`. */
  readonly blocks: readonly string[];
}

interface Parsed {
  readonly declarations: readonly Declaration[];
  /** The preludes of the sheet's top-level blocks, in order: `['@theme', ...]`. */
  readonly topLevel: readonly string[];
}

/** Every custom-property declaration in a sheet, or why the sheet cannot be read. */
function parse(sheet: StyleSheet): Parsed | ThemeProblem {
  const unreadable = (line: number, why: string): ThemeProblem => ({
    code: 'unreadable-stylesheet',
    at: `${sheet.path}:${line}`,
    message: why,
  });
  const { text, unclosedAt } = withoutComments(sheet.text);
  if (unclosedAt !== -1)
    return unreadable(lineAt(text, unclosedAt), 'a comment that is never closed');
  const found: Declaration[] = [];
  const topLevel: string[] = [];
  const blocks: string[] = [];
  let statement = '';
  let start = -1;
  let depth = 0; // parentheses: a `;` inside `url(...)` ends nothing

  const finish = (): void => {
    const custom = /^(--[^\s:]+)\s*:([\s\S]*)$/.exec(statement.trim());
    if (custom) {
      found.push({
        name: custom[1]!,
        value: custom[2]!.trim(),
        at: `${sheet.path}:${lineAt(text, start)}`,
        blocks: [...blocks],
      });
    }
    statement = '';
    start = -1;
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"' || c === "'") {
      const stop = endOfString(text, i);
      if (start === -1) start = i;
      statement += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '(') depth += 1;
    if (c === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && c === '{') {
      const prelude = statement.trim().replace(/\s+/g, ' ');
      if (blocks.length === 0) topLevel.push(prelude);
      blocks.push(prelude);
      statement = '';
      start = -1;
    } else if (depth === 0 && c === ';') {
      finish();
    } else if (depth === 0 && c === '}') {
      finish();
      if (blocks.length === 0) return unreadable(lineAt(text, i), 'a `}` that closes nothing');
      blocks.pop();
    } else {
      if (start === -1 && !/\s/.test(c)) start = i;
      statement += c;
    }
    i += 1;
  }
  if (blocks.length > 0) {
    return unreadable(lineAt(text, text.length), `\`${blocks.at(-1)} {\` is never closed`);
  }
  finish();
  return { declarations: found, topLevel };
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

// ── Values ──────────────────────────────────────────────────────────────────

const COLOUR_PREFIX = '--color-';
const HEX = /^#([0-9a-fA-F]{6})$/;
const REFERENCE = /^var\(\s*--color-([^\s,()]+)\s*\)$/;

/**
 * A whole value that is a colour, in any CSS spelling the reader knows of.
 * Used only to catch a colour under a name outside `--color-*`.
 */
const LOOKS_LIKE_A_COLOUR =
  /^(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\([\s\S]*\)|var\(\s*--color-[\s\S]*\))$/i;

function rgbOf(hex: string): Rgb {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as unknown as Rgb;
}

// ── The reader ──────────────────────────────────────────────────────────────

/**
 * Read the colour sets out of every style sheet given. Throws
 * `ThemeTokenError` listing every problem; returns only when there are none.
 */
export function readColourSets(sheets: readonly StyleSheet[]): ColourSets {
  const { file, block } = COLOUR_SETS.light;
  const problems: ThemeProblem[] = [];
  const parsed: ({ readonly sheet: StyleSheet } & Parsed)[] = [];
  let lightUnreadable = false;
  for (const sheet of sheets) {
    const result = parse(sheet);
    if ('code' in result) {
      problems.push(result);
      if (sheet.path === file) lightUnreadable = true;
    } else parsed.push({ sheet, ...result });
  }

  // Which blocks are the light set: the top-level `@theme` of theme.css.
  const lightSheet = parsed.find((p) => p.sheet.path === file);
  const lightBlocks = (lightSheet?.topLevel ?? []).filter((b) => b === block);
  if (!lightUnreadable && lightBlocks.length === 0) {
    problems.push({
      code: 'no-light-set',
      at: file,
      message: `no top-level \`${block} { }\` block, so there is no light colour set to read`,
    });
  }
  if (lightBlocks.length > 1) {
    problems.push({
      code: 'light-set-declared-twice',
      at: file,
      message: `${lightBlocks.length} top-level \`${block} { }\` blocks; the reader knows ONE light set`,
    });
  }

  const inLight = (sheet: StyleSheet, d: Declaration): boolean =>
    sheet.path === file && d.blocks.length === 1 && d.blocks[0] === block;

  const light: Declaration[] = [];
  const elsewhere: ThemeProblem[] = [];
  for (const { sheet, declarations } of parsed) {
    for (const d of declarations) {
      const isColour = d.name.startsWith(COLOUR_PREFIX);
      if (isColour && inLight(sheet, d)) light.push(d);
      else if (isColour) {
        const where = d.blocks.length === 0 ? 'the top level' : `\`${d.blocks.join(' > ')}\``;
        elsewhere.push({
          code: 'colour-outside-light-set',
          at: d.at,
          message: `${d.name} is declared in ${where} of ${sheet.path}, outside the light set (\`${block}\` in ${file}). The reader knows one colour set; a second one is taught to COLOUR_SETS on purpose, never picked up from CSS.`,
        });
      } else if (LOOKS_LIKE_A_COLOUR.test(d.value)) {
        elsewhere.push({
          code: 'colour-outside-colour-namespace',
          at: d.at,
          message: `${d.name}: ${d.value} is a colour under a name outside --color-*, so no check measures it. Name it --color-* inside the light set.`,
        });
      }
    }
  }

  // Declared twice.
  const byName = new Map<string, Declaration[]>();
  for (const d of light) byName.set(d.name, [...(byName.get(d.name) ?? []), d]);
  for (const [name, all] of byName) {
    if (all.length > 1) {
      problems.push({
        code: 'declared-twice',
        at: all[0]!.at,
        message: `${name} is declared ${all.length} times in the light set (${all.map((d) => d.at).join(', ')}); which one is meant cannot be read`,
      });
    }
  }

  // Formats.
  const broken = new Set<string>();
  for (const d of light) {
    if (!HEX.test(d.value) && !REFERENCE.test(d.value)) {
      broken.add(d.name);
      problems.push({
        code: 'unknown-colour-format',
        at: d.at,
        message: `${d.name}: \`${d.value}\` is not a format the reader understands (#rrggbb, or var(--color-name)). Teach the reader the format, with tests, rather than let it be skipped.`,
      });
    }
  }

  // References.
  const single = new Map<string, Declaration>();
  for (const [name, all] of byName) if (all.length === 1) single.set(name, all[0]!);
  const tokens = new Map<string, ColourToken>();
  for (const d of light) {
    if (single.get(d.name) !== d || broken.has(d.name)) continue;
    const via: string[] = [];
    const chain = [d.name];
    let current = d;
    let failed = false;
    for (;;) {
      const ref = REFERENCE.exec(current.value);
      if (!ref) break;
      const target = `${COLOUR_PREFIX}${ref[1]!}`;
      if (chain.includes(target)) {
        problems.push({
          code: 'reference-cycle',
          at: d.at,
          message: `a reference cycle: ${[...chain, target].join(' -> ')}`,
        });
        failed = true;
        break;
      }
      const next = single.get(target);
      if (next === undefined) {
        // A target declared twice, or broken, is already reported by name.
        if (!byName.has(target)) {
          problems.push({
            code: 'missing-reference',
            at: d.at,
            message: `${current.name} refers to ${target}, which the light set does not declare`,
          });
        }
        failed = true;
        break;
      }
      if (broken.has(target)) {
        failed = true;
        break;
      }
      chain.push(target);
      via.push(target.slice(COLOUR_PREFIX.length));
      current = next;
    }
    if (failed) continue;
    const hex = current.value.toLowerCase();
    const name = d.name.slice(COLOUR_PREFIX.length);
    tokens.set(name, { name, hex, rgb: rgbOf(hex), written: d.value, at: d.at, via });
  }

  problems.push(...elsewhere);
  if (problems.length > 0) throw new ThemeTokenError(problems);
  return { light: tokens };
}

// ── The real tree ───────────────────────────────────────────────────────────

/**
 * Every style file the app and the packages have, theme.css first. ALL `.css`
 * under `apps/light` and `packages` (generated and vendored folders aside), so
 * a colour cannot hide in a file nobody thought to list.
 */
export function styleSheetsOnDisk(): StyleSheet[] {
  const files = ['apps/light', 'packages'].flatMap((dir) =>
    walk(join(REPO_ROOT, dir), { extensions: ['.css'], excludeTests: false }),
  );
  const sheets = files.map((path) => ({
    path: displayPath(path),
    text: readFileSync(path, 'utf8'),
  }));
  return sheets.sort(
    (a, b) =>
      Number(b.path === COLOUR_SETS.light.file) - Number(a.path === COLOUR_SETS.light.file) ||
      a.path.localeCompare(b.path),
  );
}

let cached: ColourSets | undefined;

/** The light colour set of the real tree. Throws `ThemeTokenError` on any problem. */
export function lightColours(): ReadonlyMap<string, ColourToken> {
  cached ??= readColourSets(styleSheetsOnDisk());
  return cached.light;
}

// ── `dark:` class variants ──────────────────────────────────────────────────

/**
 * A `dark:` variant as a whole class token, after any other variants:
 * matches `dark:p-2`, `md:dark:p-2`, `dark:!p-2`; not `xdark:`, not prose
 * (`dark: very`, which has a space after the colon). The class ends at a space
 * or a quote (\x60 is the backtick, spelled out so the regex holds no unpaired one for a
 * text scan of this file to mistake for the start of a template string).
 */
const DARK_VARIANT = /(?<![\w-])(?:[\w-]+:)*dark:(?=[!\w[-])[^\s'"\x60]*/g;

/**
 * Every `dark:` class variant in the STRINGS of a TypeScript/TSX source:
 * string literals, JSX attribute strings and template-literal text. It reads
 * the syntax tree, so comments and JSX text are never searched — a comment
 * explaining that there is no dark mode cannot fail the build.
 */
export function darkClassVariants(path: string, source: string): { at: string; found: string }[] {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const hits: { at: string; found: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
      for (const m of node.text.matchAll(DARK_VARIANT))
        hits.push({ at: `${path}:${line}`, found: m[0] });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return hits;
}
