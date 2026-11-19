/**
 * Slim scroll bars (L-435): the five rules stay, and nothing switches them off.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Windows drew its own wide scroll bars, with arrow buttons, on every screen.
 * `styles/theme.css` now styles them in `@layer base`: a 10px strip with a 2px
 * clear edge, so a 6px rounded thumb, no arrow buttons and a clear track. The
 * thumb is `field-line`, the colour of a form field's edge, which measures 3:1
 * on every light surface (the WCAG 1.4.11 floor for a control); it turns
 * `ink-muted` while pointed at or dragged.
 *
 * WebView2 is Chromium, and in Chromium the standard `scrollbar-width` or
 * `scrollbar-color` property, set on an element or any ancestor, switches the
 * `::-webkit-scrollbar` rules off for it. One square-bracket class that sets
 * `scrollbar-width` (Tailwind's arbitrary property) would bring the wide Windows bars back on that
 * screen and no other check would notice: jsdom draws no scroll bars at all.
 *
 * So this holds three things:
 *
 *   1. the five rules are in theme.css, once each, inside `@layer base`, with
 *      exactly the approved declarations; and no other style rule anywhere
 *      names a `::-webkit-scrollbar` part (a second copy would quietly win);
 *   2. their colours are theme tokens: every value is a `var(--color-*)` the
 *      theme defines, a length, or one of a few keywords. A raw colour is
 *      never measured for contrast and has no dark value;
 *   3. a FORBID-LIST: no `scrollbar-width` or `scrollbar-color` anywhere in
 *      shipped CSS (comments removed) or in a shipped `.ts`/`.tsx` string or
 *      class string, and no `scrollbarWidth` / `scrollbarColor` style property.
 *
 * The real width, 10px, is measured in a real engine by `e2e/contrast-webkit.spec.ts`
 * ("slim scroll bars"). HONEST LIMIT: that engine is WebKit, not WebView2;
 * the Smoke pictures are the WebView2 proof.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, walk } from '../lib/repo-scan';
import { lightColours, stripCssComments, styleSheetsOnDisk, type StyleSheet } from './themeTokens';

const THEME_PATH = 'apps/light/src/styles/theme.css';
const THEME = readFileSync(join(REPO_ROOT, THEME_PATH), 'utf8');

/** The approved rules (owner decisions 11 and 12), selector → declarations. */
const SCROLLBAR_RULES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '::-webkit-scrollbar': { width: '10px', height: '10px' },
  '::-webkit-scrollbar-track, ::-webkit-scrollbar-corner': { background: 'transparent' },
  '::-webkit-scrollbar-thumb': {
    border: '2px solid transparent',
    'border-radius': '9999px',
    background: 'var(--color-field-line) padding-box',
  },
  '::-webkit-scrollbar-thumb:hover, ::-webkit-scrollbar-thumb:active': {
    'background-color': 'var(--color-ink-muted)',
  },
  '::-webkit-scrollbar-button': { display: 'none' },
};

interface StyleRule {
  /** Whitespace collapsed: `a, b`. */
  readonly selector: string;
  /** The at-rule preludes around it, outermost first: `['@layer base']`. */
  readonly blocks: readonly string[];
  readonly declarations: Record<string, string>;
}

/**
 * Every style rule of a sheet, comments removed. Deliberately small: enough
 * for theme.css, whose values hold no `{`, `}` or `;` inside a string.
 */
function styleRules(source: string): StyleRule[] {
  const css = stripCssComments(source);
  const rules: StyleRule[] = [];
  const stack: { prelude: string; rule: StyleRule | undefined }[] = [];
  let buffer = '';
  const flush = (): void => {
    const text = buffer.trim();
    buffer = '';
    const rule = stack.at(-1)?.rule;
    const colon = text.indexOf(':');
    if (rule === undefined || colon <= 0) return;
    rule.declarations[text.slice(0, colon).trim()] = text
      .slice(colon + 1)
      .trim()
      .replace(/\s+/g, ' ');
  };
  for (const ch of css) {
    if (ch === '{') {
      const prelude = buffer.trim().replace(/\s+/g, ' ');
      buffer = '';
      const rule = prelude.startsWith('@')
        ? undefined
        : { selector: prelude, blocks: stack.map((s) => s.prelude), declarations: {} };
      if (rule !== undefined) rules.push(rule);
      stack.push({ prelude, rule });
    } else if (ch === ';') {
      flush();
    } else if (ch === '}') {
      flush();
      stack.pop();
    } else {
      buffer += ch;
    }
  }
  return rules;
}

const namesScrollbarPart = (selector: string): boolean => selector.includes('::-webkit-scrollbar');

/** What is wrong with the scroll-bar rules of `theme` (and of the other sheets). */
function ruleProblems(theme: string, others: readonly StyleSheet[] = []): string[] {
  const problems: string[] = [];
  const themeRules = styleRules(theme).filter((r) => namesScrollbarPart(r.selector));
  for (const [selector, declarations] of Object.entries(SCROLLBAR_RULES)) {
    const found = themeRules.filter((r) => r.selector === selector);
    if (found.length !== 1) {
      problems.push(`${selector}: found ${String(found.length)} times, not once`);
      continue;
    }
    const [rule] = found as [StyleRule];
    if (rule.blocks.join(' > ') !== '@layer base') {
      problems.push(
        `${selector}: sits in "${rule.blocks.join(' > ') || 'no layer'}", not @layer base`,
      );
    }
    if (JSON.stringify(rule.declarations) !== JSON.stringify(declarations)) {
      problems.push(
        `${selector}: declares ${JSON.stringify(rule.declarations)}, not ${JSON.stringify(declarations)}`,
      );
    }
  }
  for (const rule of themeRules) {
    if (!(rule.selector in SCROLLBAR_RULES)) {
      problems.push(`${THEME_PATH}: an extra scroll-bar rule "${rule.selector}"`);
    }
  }
  for (const sheet of others) {
    for (const rule of styleRules(sheet.text).filter((r) => namesScrollbarPart(r.selector))) {
      problems.push(`${sheet.path}: a scroll-bar rule "${rule.selector}" outside theme.css`);
    }
  }
  return problems;
}

/** Words a scroll-bar value may hold besides a colour token: keywords and lengths. */
const VALUE_WORD = /^(?:transparent|solid|none|padding-box|\d+(?:\.\d+)?px)$/;

/** Every value in a scroll-bar rule that is not a known colour token, a length or a keyword. */
function colourProblems(theme: string, known: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const rule of styleRules(theme).filter((r) => namesScrollbarPart(r.selector))) {
    for (const [property, value] of Object.entries(rule.declarations)) {
      const at = `${rule.selector} { ${property}: ${value} }`;
      for (const [, name] of value.matchAll(/var\(--color-([\w-]+)\)/g)) {
        if (!known.has(name ?? ''))
          problems.push(`${at}: --color-${name ?? ''} is not a theme colour`);
      }
      const rest = value.replace(/var\(--color-[\w-]+\)/g, ' ').trim();
      for (const word of rest === '' ? [] : rest.split(/\s+/)) {
        if (!VALUE_WORD.test(word)) problems.push(`${at}: "${word}" is not a colour token`);
      }
    }
  }
  return problems;
}

// ── The forbid-list ────────────────────────────────────────────────────────

const STANDARD_CSS = /scrollbar-(?:width|color)/gi;
const STANDARD_STYLE = /^scrollbar(?:Width|Color)$/;

/** `scrollbar-width` / `scrollbar-color` in a style sheet, comments removed. */
function standardInCss(sheet: StyleSheet): string[] {
  return [...stripCssComments(sheet.text).matchAll(STANDARD_CSS)].map(
    (m) => `${sheet.path}: ${m[0]}`,
  );
}

/**
 * The same in TypeScript, read off the parse tree so comments never count:
 * any string or template text (a class string, `setProperty('scrollbar-width')`),
 * and any `scrollbarWidth` / `scrollbarColor` name (a style object, `el.style.x`).
 */
function standardInTs(path: string, source: string): string[] {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const hits: string[] = [];
  const where = (node: ts.Node): string =>
    `${path}:${String(tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1)}`;
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      // JSX text (words on screen) is not one of these, so it is never read.
      for (const m of node.text.matchAll(STANDARD_CSS)) hits.push(`${where(node)}: ${m[0]}`);
    } else if (ts.isIdentifier(node) && STANDARD_STYLE.test(node.text)) {
      hits.push(`${where(node)}: ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return hits;
}

function shippedTypeScript(): { path: string; text: string }[] {
  return ['apps/light/src', 'packages']
    .flatMap((dir) => walk(join(REPO_ROOT, dir), { extensions: ['.ts', '.tsx'] }))
    .map((path) => ({ path: displayPath(path), text: readFileSync(path, 'utf8') }));
}

// ── The checks ─────────────────────────────────────────────────────────────

describe('slim scroll bars (L-435)', () => {
  const sheets = styleSheetsOnDisk();

  it('theme.css has the five approved rules, once each, in @layer base, and no other sheet styles a scroll bar', () => {
    expect(sheets[0]?.path).toBe(THEME_PATH);
    expect(ruleProblems(THEME, sheets.slice(1))).toEqual([]);
  });

  it('the thumb and track are drawn in theme colour tokens, never a raw colour', () => {
    const known = new Set(lightColours().keys());
    expect(known.has('field-line') && known.has('ink-muted')).toBe(true);
    expect(colourProblems(THEME, known)).toEqual([]);
  });

  it('no shipped CSS sets scrollbar-width or scrollbar-color (either switches the rules off in WebView2)', () => {
    expect(sheets.length).toBeGreaterThan(1);
    expect(sheets.flatMap(standardInCss)).toEqual([]);
  });

  it('no shipped class string or style object sets scrollbar-width or scrollbar-color', () => {
    const files = shippedTypeScript();
    // A walk that found nothing would pass whatever the code said.
    expect(files.length).toBeGreaterThan(200);
    expect(files.flatMap((f) => standardInTs(f.path, f.text))).toEqual([]);
  });
});

describe('the scroll-bar guard can fail', () => {
  const known = new Set(['field-line', 'ink-muted']);
  const approved = styleRules(THEME)
    .filter((r) => namesScrollbarPart(r.selector))
    .map(
      (r) =>
        `${r.selector} { ${Object.entries(r.declarations)
          .map(([p, v]) => `${p}: ${v};`)
          .join(' ')} }`,
    )
    .join('\n');

  it('happy: the approved rules in @layer base pass', () => {
    expect(ruleProblems(`@layer base { ${approved} }`)).toEqual([]);
  });

  it('negative: a missing rule, the arrow buttons back, is reported', () => {
    const without = `@layer base { ${approved.replace(/::-webkit-scrollbar-button \{[^}]*\}/, '')} }`;
    expect(ruleProblems(without)).toEqual(['::-webkit-scrollbar-button: found 0 times, not once']);
  });

  it('negative: the rules outside @layer base are reported', () => {
    expect(ruleProblems(approved)).toHaveLength(Object.keys(SCROLLBAR_RULES).length);
  });

  it('negative: a scroll-bar rule in another sheet is reported', () => {
    const other = {
      path: 'apps/light/src/other.css',
      text: '.x::-webkit-scrollbar { width: 20px; }',
    };
    expect(ruleProblems(`@layer base { ${approved} }`, [other])).toEqual([
      'apps/light/src/other.css: a scroll-bar rule ".x::-webkit-scrollbar" outside theme.css',
    ]);
  });

  it('negative: a raw colour, a named colour or an unknown token in the thumb is reported', () => {
    const css = [
      '::-webkit-scrollbar-thumb { background: #7a869b padding-box; }',
      '::-webkit-scrollbar-thumb:hover { background-color: gray; }',
      '::-webkit-scrollbar-track { background: rgb(1,2,3); }',
      '::-webkit-scrollbar-corner { background: var(--color-nope); }',
    ].join('\n');
    const problems = colourProblems(css, known);
    expect(problems).toHaveLength(4);
    expect(problems.join('\n')).toMatch(
      /"#7a869b"[\s\S]*"gray"[\s\S]*"rgb\(1,2,3\)"[\s\S]*--color-nope/,
    );
  });

  it('boundary: tokens, lengths and the keywords pass', () => {
    expect(colourProblems(approved, known)).toEqual([]);
  });

  it('negative: scrollbar-width or scrollbar-color in a sheet is reported, at any depth', () => {
    const sheet = {
      path: 'probe.css',
      text: '.a { scrollbar-width: thin; } @layer base { html { scrollbar-color: red blue; } }',
    };
    expect(standardInCss(sheet)).toEqual([
      'probe.css: scrollbar-width',
      'probe.css: scrollbar-color',
    ]);
  });

  it('boundary: a comment naming them neither trips nor satisfies the guard', () => {
    expect(
      standardInCss({ path: 'p.css', text: '/* scrollbar-width is left out */ .a{}' }),
    ).toEqual([]);
    const source = '// scrollbar-width\n/* scrollbarColor */\nexport const a = 1;\n';
    expect(standardInTs('p.ts', source)).toEqual([]);
  });

  it('negative: an arbitrary-property class, a style object and a style write are reported', () => {
    // Built from pieces, so Tailwind's scanner does not ship this sample as a real class.
    const arbitrary = ['[scrollbar', '-width:none]'].join('');
    const source = [
      `export const box = 'overflow-y-auto ${arbitrary}';`,
      'export const B = () => <div style={{ scrollbarColor: "auto" }}>scrollbar-width in words</div>;',
      "export function f(el: HTMLElement) { el.style.setProperty('scrollbar-color', 'auto'); el.style.scrollbarWidth = 'thin'; }",
    ].join('\n');
    expect(standardInTs('p.tsx', source)).toEqual([
      'p.tsx:1: scrollbar-width',
      'p.tsx:2: scrollbarColor',
      'p.tsx:3: scrollbar-color',
      'p.tsx:3: scrollbarWidth',
    ]);
  });

  it('boundary: scrollbar-gutter is not on the list (it does not switch the rules off)', () => {
    const source = "export const area = 'overflow-y-auto md:[scrollbar-gutter:stable]';";
    expect(standardInTs('p.ts', source)).toEqual([]);
    expect(standardInCss({ path: 'p.css', text: '.a { scrollbar-gutter: stable; }' })).toEqual([]);
  });
});
