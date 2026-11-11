/**
 * No hard-coded colour outside the theme's colour list (L-371).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * The colour checks (`contrast`, `navAccent`, `sectionIconAccent`) measure the
 * colours in the theme's list: the `--color-*` tokens of the `@theme` block in
 * `styles/theme.css`, read by `styles/themeTokens.ts` (L-366). Nothing stopped
 * a screen or a style file from writing a colour DIRECTLY — a hex, an `rgb()`,
 * a named colour, an arbitrary-value class such as `bg-[#fff]`, one of
 * Tailwind's built-in palette classes, an inline style, an SVG fill. Such a
 * colour is never measured for contrast, and it would have no dark value when
 * dark mode arrives. This check is the forbid-list that closes that door.
 *
 * ============================================================================
 * WHAT IT READS
 * ============================================================================
 * Every shipped `.ts`/`.tsx` and `.css` under `apps/light/src` and
 * `packages/<name>/src`, tests and test helpers excluded (`isTestFile`), plus a
 * small check that `apps/light/index.html` styles nothing.
 *
 * CSS is read with its comments removed (`stripCssComments`, the theme
 * reader's own), declaration by declaration. Selectors and at-rule preludes are
 * never values, so `#root { }` is an id, not a colour.
 *
 * TypeScript is read off the PARSE TREE, so comments and JSX text (the words a
 * user reads) are never searched. A colour is looked for in four places only:
 *
 *   class      every whitespace-separated word of every string literal and
 *              template text, read as a Tailwind class: an arbitrary value
 *              holding a colour (`bg-[#fff]`, `shadow-[0_1px_#000]`,
 *              `[color:red]`) or a built-in palette class (`text-red-500`,
 *              `bg-white`, `bg-black/40`).
 *   style      a style position: an SVG paint attribute (`fill`, `stroke`,
 *              `stopColor`…), a JSX `style` object or one typed
 *              `CSSProperties`, and an assignment to `x.style.prop` or a canvas
 *              `fillStyle`/`strokeStyle`. Every string in the value is read,
 *              through `cond ? a : b` and through a `const` of the same file.
 *              Named colours (`white`, `black`, `red`) count ONLY here.
 *   constant   a string literal that is nothing but a colour: `'#17a2b8'`,
 *              `'rgb(1 2 3)'`, `'color-mix(...)'` — a colour kept in a constant
 *              to be used somewhere else.
 *   anywhere   a colour function (`rgb(`, `hsl(`, `oklch(`, `color-mix(`…) in
 *              any string, and a hex or named colour in a string shaped like a
 *              CSS value (every word a CSS value word, at least one length):
 *              `'1px solid #ccc'`, `'0 0 0 1px black'`.
 *
 * ============================================================================
 * LOOK-ALIKES, AND HOW EACH IS TOLD APART
 * ============================================================================
 *   a hex in a URL fragment   `…/issues/1#add`: a hex must not follow a letter,
 *                             a digit, `/`, `-`, `&` or `#`, and the whole
 *                             string is not a colour. `url(#abc)` is removed
 *                             from a value before it is read.
 *   an issue number           `Fixed in #1234`: prose is not a style position,
 *                             not a whole-colour string, and has no length, so
 *                             it is not CSS-shaped.
 *   an HTML id selector       in CSS a selector is never a value; in TS the
 *                             argument of `querySelector`, `closest`… and the
 *                             value of `href`, `id`, `htmlFor`, `key`, `to`,
 *                             `hash`, `src` are never read as a colour.
 *   an entity `&#215;`        a hex after `&` is not a hex, and JSX text is
 *                             never searched.
 *   "white" in copy           a named colour counts only in a style position,
 *                             a CSS value, a class's arbitrary value, or a
 *                             CSS-shaped string — never in prose.
 *
 * ============================================================================
 * WHAT IS FINE BY DEFINITION
 * ============================================================================
 * `currentColor`, `transparent`, `inherit`, `none` and the other keywords are
 * not colours of their own. A token class (`bg-card`, `text-ink-muted`,
 * `bg-teal/10`) and `var(--color-*)` ARE the colour list. The operating
 * system's colours (`Canvas`, `Highlight`, `ButtonText`…) follow its own
 * theme and are not on the named list.
 *
 * ============================================================================
 * HOW THIS AND THE THEME READER (L-366) DIVIDE THE WORK
 * ============================================================================
 * The theme reader owns every custom-property declaration that IS a colour:
 * every `--color-*` declaration (in the light set it is the colour list;
 * anywhere else it is `colour-outside-light-set`), and any other custom
 * property whose whole value is a colour (`colour-outside-colour-namespace`).
 * This check skips exactly those, by ASKING the reader about each custom
 * property rather than copying its pattern, so the two can never disagree
 * about where the line is. Everything else — a shadow that holds a colour, a
 * named colour under any name (`--brand: red`, which the reader does not see
 * as a colour), every ordinary declaration, every `@apply`, and all TypeScript —
 * is this check's. The `the line between this check and the theme reader`
 * block below holds both halves.
 *
 * `tokens.contract.test.ts` (older, `.tsx` under `apps/light/src` only) also
 * refuses a hex anywhere in a `.tsx` file, comments included, and Tailwind's
 * numeric colour scales there. It overlaps this check on those two and is left
 * as it is: it is stricter on comments, this one is wider on everything else.
 *
 * ============================================================================
 * WHAT STAYS — `KEPT` — AND WHAT IS NOT APP CHROME — `NOT_APP_CHROME`
 * ============================================================================
 * `KEPT` names each colour that must stay for now, with its file, where it is,
 * its exact text, why, and whether it needs a dark value. Each must match
 * EXACTLY ONCE: a stale entry (the colour is gone) fails, and so does a second
 * copy of the same colour in the same place (a new use needs its own decision).
 *
 * `NOT_APP_CHROME` names the files that build DOCUMENTS (the Word and PDF
 * exports of a tailored CV). A colour there is part of a file the user sends to
 * an employer: it is not the app's look, it is never on the app's screen, and
 * it has no dark mode. Those files are not read; each must still exist and
 * still be the exporter it says it is, so a screen cannot hide under the name.
 *
 * HONEST LIMITS: a colour built at run time, or imported from another module
 * as a bare word (`stroke={OTHER_MODULE_RED}` where it is `'red'`), is not
 * followed. A hex or colour function is still caught where the constant is
 * written, by the `constant` and `anywhere` rules; a bare named colour kept in
 * another module is not.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, isTestFile, walk } from '../lib/repo-scan';
import {
  COLOUR_SETS,
  ThemeTokenError,
  readColourSets,
  stripCssComments,
  styleSheetsOnDisk,
  type StyleSheet,
} from './themeTokens';

// ── What counts as a colour ─────────────────────────────────────────────────

/** Every CSS named colour. The system colours (`Canvas`, `Highlight`…) are not on it. */
export const NAMED_COLOURS = [
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
] as const;

/** Tailwind 4's built-in palette families (4.3: the 22 classics and four newer neutrals). */
export const TAILWIND_PALETTE = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'mauve',
  'olive',
  'mist',
  'taupe',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
] as const;

/** One colour found: where, and its exact text. */
export interface Finding {
  /** Repo-relative path, forward slashes. */
  readonly file: string;
  readonly line: number;
  /** The colour as written: `#fff`, `rgb(1 2 3)`, `white`, `text-red-500`. */
  readonly text: string;
  /** Which rule saw it, and on what: `class bg-[#fff]`, `css --shadow-raised`. */
  readonly where: string;
}

/** How much the scan read, so it cannot go quietly inert. */
export interface ScanStats {
  strings: number;
  classWords: number;
  paintAttributes: number;
  styleObjects: number;
  cssDeclarations: number;
}

export const emptyStats = (): ScanStats => ({
  strings: 0,
  classWords: 0,
  paintAttributes: 0,
  styleObjects: 0,
  cssDeclarations: 0,
});

// ── Colours in a value ──────────────────────────────────────────────────────

const COLOUR_FUNCTION =
  /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color|light-dark)\(/gi;

/**
 * A hex colour: 3, 4, 6 or 8 digits, standing alone. Not after a letter, digit,
 * `/`, `-`, `&` or `#` (a URL fragment, an entity, `##`), and not running on
 * into more word characters (`#12345`, `#abcdef1`).
 */
const HEX = /(?<![\w&#/-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;

const NAMED = new RegExp(`(?<![\\w-])(?:${NAMED_COLOURS.join('|')})(?![\\w-])`, 'gi');

const WHOLE_HEX = /^#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})$/i;

/** The index just past the `)` matching the `(` at `open`. */
function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/** `text` with each match replaced by spaces of the same length, so indexes hold. */
const blank = (text: string, start: number, end: number): string =>
  text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);

/**
 * Every colour literal in a CSS-ish value, in order: colour functions (whole,
 * with their arguments), hex, and — only when `named` — named colours.
 * Quoted strings and `url(...)` are removed first: a font name or a file name
 * is not a colour, and `url(#abc)` is a reference.
 */
export function colourLiterals(value: string, options: { readonly named: boolean }): string[] {
  let text = value.replace(/'[^']*'|"[^"]*"/g, (quoted) => ' '.repeat(quoted.length));
  for (const m of [...text.matchAll(/(?<![\w-])url\(/gi)]) {
    text = blank(text, m.index, closingParen(text, m.index + m[0].length - 1));
  }
  const found: { at: number; text: string }[] = [];
  for (let m = COLOUR_FUNCTION.exec(text); m !== null; m = COLOUR_FUNCTION.exec(text)) {
    const end = closingParen(text, m.index + m[0].length - 1);
    found.push({ at: m.index, text: text.slice(m.index, end) });
    text = blank(text, m.index, end);
    COLOUR_FUNCTION.lastIndex = end;
  }
  COLOUR_FUNCTION.lastIndex = 0;
  for (const m of text.matchAll(HEX)) found.push({ at: m.index, text: m[0] });
  if (options.named) for (const m of text.matchAll(NAMED)) found.push({ at: m.index, text: m[0] });
  return found.sort((a, b) => a.at - b.at).map((f) => f.text);
}

// ── Colours in Tailwind classes ─────────────────────────────────────────────

/** Utilities that take a colour. */
const COLOUR_UTILITY =
  'bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|decoration|' +
  'divide|accent|caret|placeholder|shadow|inset-shadow|inset-ring|drop-shadow|text-shadow';

const PALETTE_CLASS = new RegExp(
  `^(?:${COLOUR_UTILITY})-(?:(?:${TAILWIND_PALETTE.join('|')})-(?:50|[1-9]00|950)|black|white)` +
    `(?:/[\\w.%()[\\]-]+)?$`,
);

/** The utility after its variants: `md:hover:!bg-x!` → `bg-x`. Colons inside `[...]` are kept. */
function utilityOf(word: string): string {
  let depth = 0;
  let last = 0;
  for (let i = 0; i < word.length; i += 1) {
    const c = word[i];
    if (c === '[' || c === '(') depth += 1;
    if (c === ']' || c === ')') depth -= 1;
    if (c === ':' && depth === 0) last = i + 1;
  }
  return word
    .slice(last)
    .replace(/^!/, '')
    .replace(/!$/, '')
    .replace(/^-(?=[a-z])/, '');
}

/** Colours in Tailwind classes: arbitrary values holding a colour, and the built-in palette. */
export function classColours(text: string): { readonly word: string; readonly colour: string }[] {
  const found: { word: string; colour: string }[] = [];
  for (const word of text.split(/\s+/)) {
    if (word === '') continue;
    const utility = utilityOf(word);
    if (PALETTE_CLASS.test(utility)) {
      found.push({ word: utility, colour: utility });
      continue;
    }
    // `[color:red]` (an arbitrary property) or `bg-[#fff]`, `shadow-[0_1px_#000]`.
    const arbitrary =
      /^\[([a-z-]+):(.+)\]$/i.exec(utility) ?? /^[a-z][\w-]*-\[(.+)\](?:\/.+)?$/i.exec(utility);
    if (arbitrary === null) continue;
    const content = arbitrary[arbitrary.length - 1]!.replaceAll('_', ' ').replace(/^[a-z-]+:/i, '');
    for (const colour of colourLiterals(content, { named: true })) {
      found.push({ word: utility, colour });
    }
  }
  return found;
}

// ── TypeScript ──────────────────────────────────────────────────────────────

/** SVG and HTML attributes whose value is a paint. */
const PAINT_ATTRIBUTE =
  /^(?:fill|stroke|color|stopColor|stop-color|floodColor|flood-color|lightingColor|lighting-color)$/;

/** CSS properties (camel or kebab case) that take a colour, so a named colour there counts. */
const COLOUR_PROPERTY =
  /colou?r|background|border|outline|shadow|fill|stroke|caret|accent|decoration|column-?rule|^filter$/i;

/** Keys and attributes whose value is an address or an id, never a colour. */
const NOT_A_COLOUR_KEY = /^(?:href|id|htmlFor|key|to|hash|src)$/;

/** Calls whose argument is a selector: `querySelector('#add')` is an id. */
const SELECTOR_CALL = /^(?:querySelector|querySelectorAll|closest|matches|getElementById)$/;

/** A string shaped like a CSS value: every word a value word, and at least one length. */
const CSS_WORD =
  /^(?:-?\d*\.?\d+(?:px|rem|em|%|vh|vw|ch|pt)?|#[0-9a-f]+|[a-z-]+|[a-z-]+\(.*\)),?$/i;
const LENGTH = /(?:^|\s)-?\d*\.?\d+(?:px|rem|em|vh|vw|ch|pt)(?=[\s,]|$)/;
const cssShaped = (text: string): boolean => {
  const words = text.trim().split(/\s+/);
  return LENGTH.test(text) && words.every((word) => CSS_WORD.test(word));
};

type Literal =
  | ts.StringLiteral
  | ts.NoSubstitutionTemplateLiteral
  | ts.TemplateHead
  | ts.TemplateMiddle
  | ts.TemplateTail;

const isLiteral = (node: ts.Node): node is Literal =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateHead(node) ||
  ts.isTemplateMiddle(node) ||
  ts.isTemplateTail(node);

function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent) ||
    (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent))
  );
}

/** The name of a property key or JSX attribute, or undefined for a computed one. */
function nameOf(name: ts.PropertyName | ts.JsxAttributeName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  if (ts.isJsxNamespacedName(name)) return `${name.namespace.text}:${name.name.text}`;
  return undefined;
}

/** Skip wrappers that do not change what a value is: `(x)`, `x as T`, `x satisfies T`, `x!`. */
function unwrapUp(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent) ||
    ts.isNonNullExpression(current.parent) ||
    ts.isConditionalExpression(current.parent)
  ) {
    current = current.parent;
  }
  return current;
}

const mentionsCssProperties = (type: ts.Node | undefined): boolean =>
  type !== undefined && /CSSProperties|CSS\.Properties/.test(type.getText());

/** Is this object literal a style object, by where it sits? */
function isStyleObject(object: ts.ObjectLiteralExpression): boolean {
  for (let node: ts.Node = object; ; node = node.parent) {
    const parent = node.parent;
    if (
      (ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)) &&
      mentionsCssProperties(parent.type)
    ) {
      return true;
    }
    if (!(
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isConditionalExpression(parent)
    )) {
      break;
    }
  }
  const top = unwrapUp(object);
  const parent = top.parent;
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
    return nameOf(parent.parent.name) === 'style';
  }
  if (ts.isPropertyAssignment(parent)) return nameOf(parent.name) === 'style';
  if (ts.isVariableDeclaration(parent)) return mentionsCssProperties(parent.type);
  if (ts.isReturnStatement(parent) || ts.isArrowFunction(parent)) {
    let fn: ts.Node | undefined = parent;
    while (fn !== undefined && !ts.isFunctionLike(fn)) fn = fn.parent;
    return fn !== undefined && mentionsCssProperties((fn as ts.SignatureDeclaration).type);
  }
  return false;
}

/** Every colour in a `.ts`/`.tsx` source. */
export function scanTypeScript(
  path: string,
  source: string,
  stats: ScanStats = emptyStats(),
): Finding[] {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const report = (node: ts.Node, text: string, where: string): void => {
    const key = `${String(node.getStart(tree))}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
    findings.push({ file: path, line, text, where });
  };

  // `const NAME = <initialiser>` in this file, to follow `fill={NAME}` and `style={NAME}`.
  const consts = new Map<string, ts.Expression[]>();
  const collectConsts = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      consts.set(node.name.text, [...(consts.get(node.name.text) ?? []), node.initializer]);
    }
    ts.forEachChild(node, collectConsts);
  };
  collectConsts(tree);

  /** Every literal a value can be: through conditionals, templates and same-file consts. */
  const literalsOf = (root: ts.Node): Literal[] => {
    const out: Literal[] = [];
    const visited = new Set<ts.Node>();
    const visit = (node: ts.Node): void => {
      if (visited.has(node)) return;
      visited.add(node);
      if (isLiteral(node)) {
        out.push(node);
        return;
      }
      if (ts.isIdentifier(node)) {
        for (const initialiser of consts.get(node.text) ?? []) visit(initialiser);
        return;
      }
      if (ts.isPropertyAccessExpression(node)) {
        visit(node.expression);
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(root);
    return out;
  };

  /** A value in a style position: every colour in it counts, named ones too if `named`. */
  const styleValue = (root: ts.Node, where: string, named: boolean): void => {
    for (const literal of literalsOf(root)) {
      for (const colour of colourLiterals(literal.text, { named })) report(literal, colour, where);
    }
  };

  /** A style object: each property's value, named colours only under a colour property. */
  const styleObject = (object: ts.ObjectLiteralExpression): void => {
    stats.styleObjects += 1;
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = nameOf(property.name) ?? '';
      styleValue(property.initializer, `style ${key}`, COLOUR_PROPERTY.test(key));
    }
  };

  const visit = (node: ts.Node): void => {
    if (isLiteral(node) && !isModuleSpecifier(node)) {
      stats.strings += 1;
      const text = node.text;
      const words = text.split(/\s+/).filter((word) => word !== '');
      stats.classWords += words.length;
      for (const { word, colour } of classColours(text)) report(node, colour, `class ${word}`);

      const parent = unwrapUp(node).parent;
      const keyName =
        ts.isPropertyAssignment(parent) || ts.isJsxAttribute(parent)
          ? nameOf(parent.name)
          : undefined;
      const callee =
        ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)
          ? parent.expression.name.text
          : ts.isCallExpression(parent) && ts.isIdentifier(parent.expression)
            ? parent.expression.text
            : undefined;
      const anAddress =
        (keyName !== undefined && NOT_A_COLOUR_KEY.test(keyName)) ||
        (callee !== undefined && SELECTOR_CALL.test(callee));

      if (!anAddress) {
        const trimmed = text.trim();
        const literals = colourLiterals(trimmed, { named: false });
        // A class word with `[...]` is the class rule's, read with `_` as a space.
        const plain = words.filter((word) => !/\[.*\]/.test(word)).join(' ');
        if (literals.length === 1 && literals[0] === trimmed && trimmed.length > 0) {
          report(node, trimmed, 'constant');
        } else if (cssShaped(plain)) {
          for (const colour of colourLiterals(plain, { named: true })) {
            report(node, colour, 'css-shaped string');
          }
        } else {
          for (const colour of colourLiterals(plain, { named: false })) {
            if (!WHOLE_HEX.test(colour)) report(node, colour, 'colour function');
          }
        }
      }
    }

    if (ts.isJsxAttribute(node) && node.initializer !== undefined) {
      const name = nameOf(node.name) ?? '';
      const value = ts.isJsxExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (value !== undefined && PAINT_ATTRIBUTE.test(name)) {
        stats.paintAttributes += 1;
        styleValue(value, `${name} attribute`, true);
      }
      if (value !== undefined && name === 'style') {
        if (ts.isStringLiteral(value)) styleValue(value, 'style attribute', true);
        if (ts.isIdentifier(value)) {
          for (const initialiser of consts.get(value.text) ?? []) {
            if (ts.isObjectLiteralExpression(initialiser)) styleObject(initialiser);
          }
        }
      }
    }

    if (ts.isObjectLiteralExpression(node) && isStyleObject(node)) styleObject(node);

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left)
    ) {
      const target = node.left;
      const onStyle =
        ts.isPropertyAccessExpression(target.expression) && target.expression.name.text === 'style';
      const canvas = /^(?:fillStyle|strokeStyle|shadowColor)$/.test(target.name.text);
      if (onStyle || canvas) styleValue(node.right, `assigned ${target.name.text}`, true);
    }

    ts.forEachChild(node, visit);
  };
  visit(tree);
  return findings.sort((a, b) => a.line - b.line);
}

// ── CSS ─────────────────────────────────────────────────────────────────────

/**
 * Does the theme reader (L-366) own this custom property? Asked of the reader
 * itself, beside an empty light set, so the line between the two checks is
 * the reader's own and cannot drift from a copy of its pattern.
 */
function ownedByThemeReader(name: string, value: string): boolean {
  if (name.startsWith('--color-')) return true;
  try {
    readColourSets([
      { path: COLOUR_SETS.light.file, text: '@theme {}' },
      { path: 'probe/raw-colours.css', text: `:root { ${name}: ${value}; }` },
    ]);
    return false;
  } catch (error) {
    if (error instanceof ThemeTokenError) {
      return error.problems.some((p) => p.code === 'colour-outside-colour-namespace');
    }
    throw error;
  }
}

/** Every colour in a style sheet, outside what the theme reader owns. */
export function scanCss(path: string, text: string, stats: ScanStats = emptyStats()): Finding[] {
  const css = stripCssComments(text);
  const findings: Finding[] = [];
  let statement = '';
  let start = -1;
  let depth = 0;

  const finish = (): void => {
    const body = statement.trim();
    const line = css.slice(0, Math.max(start, 0)).split('\n').length;
    statement = '';
    start = -1;
    if (body === '') return;
    if (/^@apply\s/i.test(body)) {
      for (const { word, colour } of classColours(body.slice('@apply'.length))) {
        findings.push({ file: path, line, text: colour, where: `css @apply ${word}` });
      }
      return;
    }
    if (body.startsWith('@')) return; // @import, @source, @plugin: no values
    const declaration = /^(--[\w-]+|[a-z-]+)\s*:([\s\S]*)$/i.exec(body);
    if (declaration === null) return;
    const name = declaration[1]!;
    const value = declaration[2]!.trim();
    stats.cssDeclarations += 1;
    if (name.startsWith('--') && ownedByThemeReader(name, value)) return;
    for (const colour of colourLiterals(value, { named: true })) {
      findings.push({ file: path, line, text: colour, where: `css ${name}` });
    }
  };

  let i = 0;
  while (i < css.length) {
    const c = css[i]!;
    if (c === '"' || c === "'") {
      const close = css.indexOf(c, i + 1);
      const stop = close === -1 ? css.length : close + 1;
      if (start === -1) start = i;
      statement += css.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '(') depth += 1;
    if (c === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && c === '{') {
      // A prelude (a selector or an at-rule's condition), never a value.
      statement = '';
      start = -1;
    } else if (depth === 0 && (c === ';' || c === '}')) {
      finish();
    } else {
      if (start === -1 && !/\s/.test(c)) start = i;
      statement += c;
    }
    i += 1;
  }
  finish();
  return findings;
}

// ── HTML ────────────────────────────────────────────────────────────────────

/** Anything in an HTML page that would style it: a style tag, a style attribute, a colour attribute. */
export function htmlStyling(text: string): string[] {
  const html = text.replace(/<!--[\s\S]*?-->/g, ' ');
  return [
    ...html.matchAll(
      /<style\b|<link\b[^>]*rel=["']?stylesheet|\sstyle=|\s(?:bgcolor|color|fill|stroke)=|theme-color/gi,
    ),
  ].map((m) => m[0].trim());
}

// ── KEPT and NOT_APP_CHROME ─────────────────────────────────────────────────

const THEME = COLOUR_SETS.light.file;

type DarkValue = 'needs a dark value' | 'no dark value needed';

export interface Kept {
  readonly file: string;
  /** The finding's `where`, exactly. */
  readonly where: string;
  /** The colour, exactly as written. */
  readonly text: string;
  readonly reason: string;
  readonly dark: DarkValue;
}

const SHADOW =
  'An elevation shadow, tinted with the ink colour (#0b1729 is rgb 11 23 41) at a few per cent ' +
  'so it reads as part of the page rather than as grey dirt (see the Elevation comment in ' +
  "theme.css). Tailwind's --shadow-* namespace takes a whole shadow, so the colour is written " +
  'inside it, and a shadow is decoration, not text or a control edge, so no contrast check ' +
  'measures it. Tokenising it (color-mix of --color-ink) is a value change and is not made here. ' +
  'A navy-tinted shadow vanishes on a dark canvas, so it needs a dark value.';

/** The colours that stay for now. Each must match exactly once. */
export const KEPT: readonly Kept[] = [
  {
    file: THEME,
    where: 'css --shadow-raised',
    text: 'rgb(11 23 41 / 0.08)',
    reason: `${SHADOW} The one ring of the raised card.`,
    dark: 'needs a dark value',
  },
  {
    file: THEME,
    where: 'css --shadow-overlay',
    text: 'rgb(11 23 41 / 0.09)',
    reason: `${SHADOW} The near layer of the overlay shadow.`,
    dark: 'needs a dark value',
  },
  {
    file: THEME,
    where: 'css --shadow-overlay',
    text: 'rgb(11 23 41 / 0.1)',
    reason: `${SHADOW} The far layer of the overlay shadow.`,
    dark: 'needs a dark value',
  },
];

export interface NotAppChrome {
  readonly file: string;
  /** Text the file must still hold, proving it is still the exporter. */
  readonly marker: string;
  readonly reason: string;
}

const DOCUMENT =
  'Builds a DOCUMENT the user saves and sends to an employer, not the app: a colour in it is ' +
  "part of that file, never on the app's screen, and a Word or PDF file has no dark mode. Its " +
  'colours are the document format\'s (Word\'s own black, "000000"), chosen for applicant-tracking ' +
  "systems, and are held by the exporter's own tests.";

/** Files that build exported documents. Not read; each must still exist and still be what it says. */
export const NOT_APP_CHROME: readonly NotAppChrome[] = [
  {
    file: 'apps/light/src/features/tailor/docx.ts',
    marker: "from 'docx'",
    reason: `${DOCUMENT} The Word export (L-165).`,
  },
  {
    file: 'apps/light/src/features/tailor/pdf.ts',
    marker: '%PDF-',
    reason: `${DOCUMENT} The PDF export (L-201).`,
  },
];

// ── The check, pure ─────────────────────────────────────────────────────────

/** One file to read: its repo-relative path and its text. */
export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

export interface RawColourReport {
  /** `path:line: text (where)`, one per colour not on `KEPT`. */
  readonly offences: readonly string[];
  /** Kept entries that did not match exactly once. */
  readonly stale: readonly string[];
}

/** The check, pure, so it can be shown failing on made-up files. */
export function findRawColours(
  files: readonly SourceFile[],
  kept: readonly Kept[] = KEPT,
  stats: ScanStats = emptyStats(),
): RawColourReport {
  const matched = new Map<Kept, number>(kept.map((entry) => [entry, 0]));
  const offences: string[] = [];
  for (const { path, text } of files) {
    const findings = path.endsWith('.css')
      ? scanCss(path, text, stats)
      : scanTypeScript(path, text, stats);
    for (const finding of findings) {
      const mine = kept.filter(
        (entry) =>
          entry.file === finding.file &&
          entry.where === finding.where &&
          entry.text === finding.text,
      );
      for (const entry of mine) matched.set(entry, (matched.get(entry) ?? 0) + 1);
      if (mine.length === 0) {
        offences.push(
          `${finding.file}:${String(finding.line)}: ${finding.text} (${finding.where})`,
        );
      }
    }
  }
  const stale = kept
    .filter((entry) => matched.get(entry) !== 1)
    .map(
      (entry) =>
        `${entry.file}: "${entry.text}" (${entry.where}) matched ${String(matched.get(entry))} times, not exactly once`,
    );
  return { offences, stale };
}

// ── The real tree ───────────────────────────────────────────────────────────

const PACKAGE_SOURCES = ['ai-providers', 'ats-checks', 'core-types', 'cv-parsing', 'job-apis']
  .concat(['keyword-scoring', 'resume-schema', 'ui'])
  .map((name) => `packages/${name}/src`);

/** The roots whose source and style files are read. */
export const ROOTS = ['apps/light/src', ...PACKAGE_SOURCES] as const;

const underRoots = (path: string): boolean => ROOTS.some((root) => path.startsWith(`${root}/`));
const outOfScope = new Set(NOT_APP_CHROME.map((entry) => entry.file));

function typeScriptOnDisk(): SourceFile[] {
  return ROOTS.flatMap((root) => walk(join(REPO_ROOT, root), { extensions: ['.ts', '.tsx'] }))
    .map((file) => displayPath(file))
    .filter((path) => !outOfScope.has(path))
    .map((path) => ({ path, text: readFileSync(join(REPO_ROOT, path), 'utf8') }));
}

function cssOnDisk(): SourceFile[] {
  return styleSheetsOnDisk()
    .filter((sheet: StyleSheet) => underRoots(sheet.path) && !isTestFile(sheet.path))
    .map((sheet) => ({ path: sheet.path, text: sheet.text }));
}

const INDEX_HTML = 'apps/light/index.html';

describe('no hard-coded colour outside the colour list (L-371)', () => {
  const typescript = typeScriptOnDisk();
  const css = cssOnDisk();
  const all = [...css, ...typescript];

  it('reads a real corpus (anti-inert)', () => {
    const tsNames = typescript.map((file) => file.path);
    const cssNames = css.map((file) => file.path);
    expect(tsNames.length).toBeGreaterThan(350);
    for (const known of [
      'apps/light/src/app/App.tsx',
      'apps/light/src/app/CViperMark.tsx',
      'apps/light/src/ui/Icon.tsx',
      'apps/light/src/ui/StateMark.tsx',
      'apps/light/src/ui/NavIcons.tsx',
      'apps/light/src/features/analysis/BandScale.tsx',
      'packages/ui/src/index.ts',
      'packages/core-types/src/index.ts',
    ]) {
      expect(tsNames, known).toContain(known);
    }
    expect(cssNames).toContain(THEME);
    expect(cssNames).toContain('apps/light/src/styles/fonts.css');
    for (const name of [...tsNames, ...cssNames]) expect(isTestFile(name), name).toBe(false);
    for (const name of tsNames) expect(name, name).not.toMatch(/\.(test|spec)\.tsx?$/);
    for (const name of tsNames) expect(outOfScope.has(name), name).toBe(false);

    const stats = emptyStats();
    findRawColours(all, KEPT, stats);
    expect(stats.strings, 'string literals read').toBeGreaterThan(8000);
    expect(stats.classWords, 'class words read').toBeGreaterThan(20000);
    expect(stats.paintAttributes, 'SVG paint attributes read').toBeGreaterThan(30);
    expect(stats.styleObjects, 'style objects read').toBeGreaterThanOrEqual(5);
    expect(stats.cssDeclarations, 'CSS declarations read').toBeGreaterThan(80);
  });

  it('forbid-list: no shipped source or style file holds a colour outside the list', () => {
    expect(findRawColours(all).offences).toEqual([]);
  });

  it('every kept colour still exists, exactly once', () => {
    expect(findRawColours(all).stale).toEqual([]);
  });

  it('every kept colour names a real file, says why, and says whether it needs a dark value', () => {
    const seen = new Set<string>();
    for (const entry of KEPT) {
      const label = `${entry.file}: ${entry.text} (${entry.where})`;
      expect(existsSync(join(REPO_ROOT, entry.file)), label).toBe(true);
      expect(entry.reason.length, label).toBeGreaterThan(80);
      expect(['needs a dark value', 'no dark value needed'], label).toContain(entry.dark);
      const key = `${entry.file}|${entry.where}|${entry.text}`;
      expect(seen.has(key), `${label} is listed twice`).toBe(false);
      seen.add(key);
    }
    // The plan expected exactly the three shadow colours, all needing a dark value.
    expect(KEPT.map((entry) => entry.text)).toEqual([
      'rgb(11 23 41 / 0.08)',
      'rgb(11 23 41 / 0.09)',
      'rgb(11 23 41 / 0.1)',
    ]);
    expect(KEPT.every((entry) => entry.dark === 'needs a dark value')).toBe(true);
  });

  it('every file that is not app chrome still exists and is still the exporter it says', () => {
    for (const entry of NOT_APP_CHROME) {
      const path = join(REPO_ROOT, entry.file);
      expect(existsSync(path), entry.file).toBe(true);
      expect(readFileSync(path, 'utf8'), entry.file).toContain(entry.marker);
      expect(entry.reason.length, entry.file).toBeGreaterThan(80);
    }
  });

  it('index.html styles nothing (if it starts to, this check must learn to read it)', () => {
    const html = readFileSync(join(REPO_ROOT, INDEX_HTML), 'utf8');
    expect(html).toContain('<div id="root">');
    expect(htmlStyling(html)).toEqual([]);
  });
});

// ── The checker can fail ────────────────────────────────────────────────────

const TSX = 'apps/light/src/features/somewhere/Elsewhere.tsx';
const TS_FILE = 'apps/light/src/features/somewhere/elsewhere.ts';
const CSS = 'apps/light/src/styles/elsewhere.css';

const tsx = (source: string): string[] => scanTypeScript(TSX, source).map((f) => f.text);
const tsOnly = (source: string): string[] => scanTypeScript(TS_FILE, source).map((f) => f.text);
const cssOf = (text: string): string[] => scanCss(CSS, text).map((f) => f.text);

describe('the checker can fail: what counts as a hard-coded colour', () => {
  const MUST_FLAG: readonly [string, (source: string) => string[], string, readonly string[]][] = [
    // Tailwind arbitrary values.
    ['a hex in a class', tsx, '<div className="p-2 bg-[#fff]" />', ['#fff']],
    ['a long hex in a class', tsx, '<div className="bg-[#ffffff]" />', ['#ffffff']],
    ['an alpha hex in a class', tsx, '<b className="text-[#0f2044cc]" />', ['#0f2044cc']],
    ['rgb() in a class', tsx, '<b className="bg-[rgb(1_2_3)]" />', ['rgb(1 2 3)']],
    ['a typed arbitrary property', tsx, '<b className="[color:hsl(0_0%_0%)]" />', ['hsl(0 0% 0%)']],
    ['a named colour in a class', tsx, '<b className="hover:bg-[red]" />', ['red']],
    ['a colour inside an arbitrary shadow', tsx, '<b className="shadow-[0_1px_#000]" />', ['#000']],
    ['a var() fallback in a class', tsx, '<b className="bg-[var(--x,white)]" />', ['white']],
    // Tailwind's built-in palette.
    ['a palette class', tsx, '<p className="text-red-500" />', ['text-red-500']],
    [
      'a palette class behind variants',
      tsx,
      '<p className="md:hover:bg-slate-700" />',
      ['bg-slate-700'],
    ],
    ['bg-white', tsx, '<p className="bg-white p-2" />', ['bg-white']],
    ['bg-black with opacity', tsx, '<p className="bg-black/40" />', ['bg-black/40']],
    ['an important palette class', tsx, '<p className="!text-white" />', ['text-white']],
    [
      'a side border palette class',
      tsx,
      "const c = 'border-t-emerald-300';",
      ['border-t-emerald-300'],
    ],
    ['a ring offset palette class', tsx, "const c = 'ring-offset-white';", ['ring-offset-white']],
    ['a newer neutral family', tsx, "const c = 'from-mauve-50';", ['from-mauve-50']],
    [
      'a palette class in a template',
      tsx,
      'const c = (x: string) => `${x} text-blue-600`;',
      ['text-blue-600'],
    ],
    // Inline styles.
    ['an inline style colour', tsx, "<p style={{ color: 'red' }} />", ['red']],
    ['an inline style hex', tsx, "<p style={{ backgroundColor: '#0f2044' }} />", ['#0f2044']],
    [
      'an inline box shadow',
      tsx,
      "<p style={{ boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />",
      ['rgba(0,0,0,.2)'],
    ],
    ['an inline border', tsx, "<p style={{ border: '1px solid black' }} />", ['black']],
    ['a custom property in a style', tsx, "<p style={{ '--accent': '#fff' }} />", ['#fff']],
    [
      'a style object in a const',
      tsx,
      "const S = { color: 'tomato' };\nconst A = () => <p style={S} />;",
      ['tomato'],
    ],
    [
      'a CSSProperties function',
      tsx,
      "function f(): CSSProperties {\n  return { color: 'navy' };\n}",
      ['navy'],
    ],
    [
      'a var() fallback in a style',
      tsx,
      "<p style={{ color: 'var(--color-ink, black)' }} />",
      ['black'],
    ],
    ['a style string', tsx, '<p style="color: red" />', ['red']],
    ['a style property assignment', tsOnly, "el.style.color = 'red';", ['red']],
    ['a canvas fill', tsOnly, "ctx.fillStyle = 'black';", ['black']],
    // SVG paint.
    ['a named SVG fill', tsx, '<path fill="black" />', ['black']],
    ['a hex SVG stroke', tsx, '<path stroke="#000" />', ['#000']],
    ['a stop colour', tsx, '<stop stopColor="white" />', ['white']],
    ['a hyphenated stop colour', tsx, '<stop stop-color="red" />', ['red']],
    ['an SVG colour attribute', tsx, '<svg color="green" />', ['green']],
    [
      'a fill from a const',
      tsx,
      "const INK = 'black';\nconst A = () => <path fill={INK} />;",
      ['black'],
    ],
    ['a conditional fill', tsx, "<path fill={on ? 'red' : 'currentColor'} />", ['red']],
    ['a fill in braces', tsx, "<path fill={'#abc'} />", ['#abc']],
    // Constants and strings shaped like CSS.
    ['a hex constant', tsOnly, "export const BRAND = '#17a2b8';", ['#17a2b8']],
    ['an rgb constant', tsOnly, "export const C = 'rgb(1 2 3)';", ['rgb(1 2 3)']],
    ['a template constant', tsOnly, 'export const C = `#fff`;', ['#fff']],
    ['a hex in a JSX data attribute', tsx, '<b data-c="#fff" />', ['#fff']],
    [
      'a colour-mix of tokens',
      tsOnly,
      "const c = 'color-mix(in srgb, var(--color-navy) 10%, transparent)';",
      ['color-mix(in srgb, var(--color-navy) 10%, transparent)'],
    ],
    [
      'oklch in a CSS sentence',
      tsOnly,
      "const s = 'border: 1px solid oklch(0.5 0.1 200)';",
      ['oklch(0.5 0.1 200)'],
    ],
    ['a hex in a CSS-shaped string', tsOnly, "const B = '1px solid #ccc';", ['#ccc']],
    ['a named colour in a CSS-shaped string', tsOnly, "const B = '0 0 0 1px black';", ['black']],
  ];

  it.each(MUST_FLAG)('flags %s', (_label, scan, source, expected) => {
    expect(scan(source)).toEqual(expected);
  });

  const CSS_MUST_FLAG: readonly [string, string, readonly string[]][] = [
    ['rgb() in a rule', '.x { color: rgb(1 2 3); }', ['rgb(1 2 3)']],
    ['a hex background', '.x { background: #fff; }', ['#fff']],
    ['a named colour', '.x { color: red; }', ['red']],
    ['a named colour in capitals', '.x { border: 1px solid BLACK; }', ['BLACK']],
    [
      'a colour inside a shadow token',
      '@theme { --shadow-x: 0 0 1px rgb(1 2 3 / 0.1); }',
      ['rgb(1 2 3 / 0.1)'],
    ],
    ['a hex inside a non-whole custom property', ':root { --ring: 0 0 0 2px #fff; }', ['#fff']],
    ['a named colour under another name', ':root { --brand: red; }', ['red']],
    ['@apply with a palette class', '.x { @apply bg-white p-2; }', ['bg-white']],
    ['@apply with an arbitrary colour', '.x { @apply text-[#fff]; }', ['#fff']],
    ['a var() fallback', '.x { color: var(--color-ink, red); }', ['red']],
    [
      'an @property initial value',
      "@property --x { syntax: '<color>'; inherits: false; initial-value: red; }",
      ['red'],
    ],
    [
      'color-mix of tokens',
      '.x { color: color-mix(in srgb, var(--color-navy) 50%, transparent); }',
      ['color-mix(in srgb, var(--color-navy) 50%, transparent)'],
    ],
    [
      'hsl in a media query',
      '@media (min-width: 1px) { .x { color: hsl(0 0% 0%); } }',
      ['hsl(0 0% 0%)'],
    ],
    ['a last declaration with no semicolon', '.x { color: #123 }', ['#123']],
  ];

  it.each(CSS_MUST_FLAG)('flags in CSS: %s', (_label, text, expected) => {
    expect(cssOf(text)).toEqual(expected);
  });
});

describe('the checker can fail: what is NOT a hard-coded colour', () => {
  const MUST_NOT_FLAG: readonly [string, (source: string) => string[], string][] = [
    [
      'currentColor, none, transparent, inherit',
      tsx,
      '<path fill="none" stroke="currentColor" color="inherit" style={{ background: \'transparent\' }} />',
    ],
    [
      'token classes',
      tsx,
      '<p className="bg-card text-ink-muted border-line bg-teal/10 hover:text-blue text-teal-ink" />',
    ],
    [
      'a token var as a stroke',
      tsx,
      "const NAV = 'var(--color-nav-accent)';\nconst A = () => <path stroke={NAV} />;",
    ],
    [
      'sizes in arbitrary values',
      tsx,
      '<p className="text-[11px] tracking-[0.14em] min-w-[85vw] align-[-0.125em]" />',
    ],
    ['a Tailwind var shorthand', tsx, '<p className="bg-(--brand)" />'],
    [
      'words that merely start like a utility',
      tsOnly,
      "const s = 'a text-based, divide-by-zero, text-and-number reading';",
    ],
    ['a URL fragment', tsOnly, "const u = 'https://github.com/o/r/issues/1#issuecomment-1234';"],
    ['a URL fragment that is hex', tsOnly, "const u = 'https://example.invalid/page#add';"],
    ['an issue number in prose', tsOnly, "const s = 'Fixed in #1234 and (#559).';"],
    ['an entity in a string', tsOnly, "const s = '&#215;';"],
    ['an entity and a hex in JSX text', tsx, '<p>&#215; white on #000, see #1234</p>'],
    ['an id selector', tsOnly, "document.querySelector('#add'); el.closest('#bad');"],
    ['an in-page link', tsx, '<a href="#face">skip</a>'],
    ['an id property', tsOnly, "const o = { id: '#bad', hash: '#fed' };"],
    ['the word white in copy', tsx, '<p title="Red flag">A white paper, in black and white</p>'],
    ['a named colour in a plain string', tsOnly, "const s = 'Write it in black and white';"],
    [
      'a named colour in a data object',
      tsOnly,
      "const q = { background: 'A red-team background', color: 'colour' };",
    ],
    [
      'a named colour as an enum value',
      tsOnly,
      "type Flag = 'red' | 'green';\nconst f: Flag = 'red';",
    ],
    ['a url() reference in a fill', tsx, '<path fill="url(#abc)" />'],
    ['five and seven hex digits', tsOnly, "const a = '#12345';\nconst b = '#abcdef1';"],
    ['a font name in a style', tsx, "<p style={{ fontFamily: 'Red Hat Display' }} />"],
    [
      'a comment',
      tsx,
      '// bg-[#fff] text-red-500 style={{ color: \'red\' }}\n/* fill="black" #000 rgb(1 2 3) */\nexport const a = 1;',
    ],
    ['an import path', tsOnly, "import x from './bg-white';"],
  ];

  it.each(MUST_NOT_FLAG)('does not flag %s', (_label, scan, source) => {
    expect(scan(source)).toEqual([]);
  });

  const CSS_MUST_NOT_FLAG: readonly [string, string][] = [
    ['a comment', '/* color: red; background: #fff; rgb(1 2 3) */ .x { color: var(--color-ink); }'],
    ['an id selector', '#root { height: 100%; }\n#cafe { color: var(--color-ink); }'],
    [
      'keywords',
      '.x { color: currentColor; background: transparent; outline: 2px solid transparent; fill: none; border-color: inherit; }',
    ],
    [
      'a --color-* token anywhere (the theme reader owns it)',
      '@theme { --color-x: #123456; }\n.y { --color-z: red; }',
    ],
    [
      'a whole colour under another name (the theme reader owns it)',
      ':root { --brand: #17a2b8; --ring: var(--color-blue); }',
    ],
    [
      'quoted names and URLs',
      ".x { font-family: 'Red Hat Display', serif; src: url('/fonts/white.woff2'); content: 'white'; }",
    ],
    ['a url() fragment', '.x { background: url(#abc); }'],
    [
      'an animation and a media prelude',
      '@media (prefers-color-scheme: light) { .x { animation: cviper-card-settle 200ms ease-out; } }',
    ],
    ['an @apply of tokens', '.x { @apply bg-card text-ink border-line; }'],
    [
      'a var() of a token',
      ':focus-visible { box-shadow: 0 0 0 2px var(--color-card), 0 0 0 4px var(--color-blue); }',
    ],
    [
      'a system colour',
      '@media (forced-colors: active) { .x { outline-color: Highlight; color: CanvasText; } }',
    ],
  ];

  it.each(CSS_MUST_NOT_FLAG)('does not flag in CSS: %s', (_label, text) => {
    expect(cssOf(text)).toEqual([]);
  });

  it('negative: a test file is never read', () => {
    expect(isTestFile('apps/light/src/ui/Icon.test.tsx')).toBe(true);
    expect(isTestFile('apps/light/src/ui/test/shownAs.ts')).toBe(true);
  });

  it('reports where a finding is, by file, line and rule', () => {
    const found = scanTypeScript(TSX, 'const a = 1;\n<div className="bg-[#fff]" />');
    expect(found).toEqual([{ file: TSX, line: 2, text: '#fff', where: 'class bg-[#fff]' }]);
    const css = scanCss(CSS, '.x {\n  color: red;\n}');
    expect(css).toEqual([{ file: CSS, line: 2, text: 'red', where: 'css color' }]);
  });

  it('index.html: a style tag, a style attribute or a colour attribute is styling', () => {
    expect(htmlStyling('<div id="root"></div>')).toEqual([]);
    expect(htmlStyling('<!-- <style> --><div id="root"></div>')).toEqual([]);
    expect(htmlStyling('<style>body{}</style>')).not.toEqual([]);
    expect(htmlStyling('<body style="background:#fff">')).not.toEqual([]);
    expect(htmlStyling('<body bgcolor="white">')).not.toEqual([]);
    expect(htmlStyling('<meta name="theme-color" content="#0f2044">')).not.toEqual([]);
  });
});

describe('the line between this check and the theme reader (L-366)', () => {
  /** The theme reader's problem codes for one extra sheet beside an empty light set. */
  function readerCodes(text: string): string[] {
    try {
      readColourSets([
        { path: THEME, text: '@theme {}' },
        { path: CSS, text },
      ]);
      return [];
    } catch (error) {
      if (error instanceof ThemeTokenError) return error.problems.map((p) => p.code);
      throw error;
    }
  }

  it.each([
    [
      'a --color-* token outside the light set',
      '.y { --color-z: red; }',
      'colour-outside-light-set',
    ],
    [
      'a whole hex under another name',
      ':root { --brand: #17a2b8; }',
      'colour-outside-colour-namespace',
    ],
    [
      'a whole token reference under another name',
      ':root { --ring: var(--color-blue); }',
      'colour-outside-colour-namespace',
    ],
    [
      'a whole rgb() under another name',
      ':root { --brand: rgb(1 2 3); }',
      'colour-outside-colour-namespace',
    ],
  ])('the reader reports %s, and this check stays silent (no double report)', (_l, text, code) => {
    expect(readerCodes(text)).toEqual([code]);
    expect(cssOf(text)).toEqual([]);
  });

  it.each([
    ['a colour inside a shadow', ':root { --shadow-x: 0 0 1px rgb(1 2 3); }'],
    ['a named colour under another name', ':root { --brand: red; }'],
    ['an ordinary declaration', '.x { color: #fff; }'],
  ])('the reader is silent on %s, and this check reports it (no gap)', (_l, text) => {
    expect(readerCodes(text)).toEqual([]);
    expect(cssOf(text)).not.toEqual([]);
  });

  it("inside the light set, a token in an unknown format is the reader's, not this check's", () => {
    expect(scanCss(THEME, '@theme { --color-x: rgb(1 2 3); }')).toEqual([]);
  });
});

describe('the checker can fail: the exception list', () => {
  const KEEP: Kept = {
    file: CSS,
    where: 'css --shadow-x',
    text: 'rgb(1 2 3 / 0.1)',
    reason: 'a made-up exception for these tests, long enough to be a real reason for keeping it',
    dark: 'needs a dark value',
  };
  const sheet = (text: string): SourceFile[] => [{ path: CSS, text }];

  it('a kept colour excuses itself and nothing beside it', () => {
    const one = findRawColours(sheet(':root { --shadow-x: 0 0 1px rgb(1 2 3 / 0.1); }'), [KEEP]);
    expect(one).toEqual({ offences: [], stale: [] });
    const more = findRawColours(
      sheet(':root { --shadow-x: 0 0 1px rgb(1 2 3 / 0.1), 0 0 2px #000; }'),
      [KEEP],
    );
    expect(more.offences).toEqual([`${CSS}:1: #000 (css --shadow-x)`]);
  });

  it('boundary: a stale exception fails (the colour is gone)', () => {
    const report = findRawColours(sheet(':root { --shadow-x: 0 0 1px var(--color-ink); }'), [KEEP]);
    expect(report.stale).toEqual([
      `${CSS}: "rgb(1 2 3 / 0.1)" (css --shadow-x) matched 0 times, not exactly once`,
    ]);
  });

  it('boundary: a duplicated colour fails (a second use needs its own decision)', () => {
    const report = findRawColours(
      sheet(':root { --shadow-x: 0 0 1px rgb(1 2 3 / 0.1), 0 0 2px rgb(1 2 3 / 0.1); }'),
      [KEEP],
    );
    expect(report.stale).toEqual([
      `${CSS}: "rgb(1 2 3 / 0.1)" (css --shadow-x) matched 2 times, not exactly once`,
    ]);
  });

  it('boundary: an exception whose file is gone fails', () => {
    const report = findRawColours([], [KEEP]);
    expect(report.stale).toHaveLength(1);
    expect(existsSync(join(REPO_ROOT, 'apps/light/src/styles/elsewhere.css'))).toBe(false);
  });

  it('a kept colour excuses nothing in another file or another place', () => {
    const otherFile = findRawColours(
      [
        {
          path: 'apps/light/src/styles/other.css',
          text: ':root { --shadow-x: 0 0 1px rgb(1 2 3 / 0.1); }',
        },
      ],
      [KEEP],
    );
    expect(otherFile.offences).toHaveLength(1);
    const otherPlace = findRawColours(sheet(':root { --shadow-y: 0 0 1px rgb(1 2 3 / 0.1); }'), [
      KEEP,
    ]);
    expect(otherPlace.offences).toHaveLength(1);
    expect(otherPlace.stale).toHaveLength(1);
  });
});
