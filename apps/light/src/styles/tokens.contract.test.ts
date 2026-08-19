/**
 * The token contract. This is the reason the design system will still be intact
 * in a year.
 *
 * ============================================================================
 * WHAT THIS ENFORCES
 * ============================================================================
 * It reads every `.tsx` file under `src/` and fails on:
 *
 *   1. any hex colour literal                     `#0f2044`
 *   2. any arbitrary radius or elevation          `rounded-[10px]`, `shadow-[...]`
 *   3. any radius outside the three in `@theme`   `rounded-lg`, bare `rounded`
 *   4. any elevation outside the two in `@theme`  `shadow-sm`, `shadow-2xl`
 *   5. any of Tailwind's numeric colour scales    `bg-slate-700`, `text-blue-500`
 *
 * Rule 5 is the one that is not in the original brief, and it is here because
 * rules 1-4 without it leave the barn door open: a developer blocked from
 * writing `#475569` will reach for `text-slate-600`, which is the same problem
 * with better spelling. "No component names a colour by what it looks like"
 * needs both halves to mean anything.
 *
 * ============================================================================
 * WHY A TEST AND NOT A LINT RULE OR A CODE REVIEW
 * ============================================================================
 * Design drift is not one bad decision, it is two hundred small reasonable ones
 * — a slightly rounder card here, a slightly softer shadow there — each of which
 * is defensible on its own and none of which anybody would block in review. By
 * the two hundredth the system is gone. A machine that says no every time is the
 * only thing that survives that, and it costs about forty lines.
 *
 * ============================================================================
 * TWO THINGS THAT WOULD MAKE THIS GUARD USELESS, AND WHAT STOPS THEM
 * ============================================================================
 * A guard that cannot fail is worse than no guard, because everyone believes
 * it. So:
 *
 *   * This file is `.ts`, and it scans only `.tsx`. It therefore cannot trip on
 *     its own examples — which is deliberate, and is why the forbidden patterns
 *     below can be written out in full. Do not rename it to `.tsx`.
 *   * `the rules can actually fail` feeds a synthetic source containing one of
 *     every violation and asserts each is caught. If the scanner silently found
 *     nothing — a broken walker, a moved directory — that block still fails.
 *     `it finds the app source files` covers the other half.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** `src/` — this file lives in `src/styles/`. */
const SRC = fileURLToPath(new URL('..', import.meta.url));

/** The only three radii that exist. See `--radius-*` in theme.css. */
const ALLOWED_RADII = ['control', 'card', 'pill'];

/** The only two elevations that exist. See `--shadow-*` in theme.css. */
const ALLOWED_SHADOWS = ['raised', 'overlay'];

/** Utility prefixes that take a colour, for the numeric-scale rule. */
const COLOUR_PREFIXES =
  'bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|accent|caret|placeholder';

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly found: string;
  readonly rule: string;
}

function tsxFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...tsxFiles(full));
    else if (entry.name.endsWith('.tsx')) found.push(full);
  }
  return found.sort();
}

/**
 * Drop comments before looking for class names.
 *
 * Without this, the word "shadow" in a sentence explaining the shadow tokens
 * reads as a bare `shadow` utility and the guard fails on its own documentation
 * — which is how a real guard gets deleted by the next person to hit it.
 *
 * `//` is only treated as a line comment when it is NOT preceded by a colon, so
 * a `https://` inside a string survives intact. Stripping can only ever hide a
 * violation, never invent one, and violations do not live in comments.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * `(?<![\w\-/])` on every pattern. Three false positives it exists to kill:
 * `box-shadow` (preceded by a hyphen), `borderRadius` (word character), and the
 * `/rounded` at the end of a URL (slash). A guard that fires on those is a guard
 * the next person deletes.
 */
const RULES: ReadonlyArray<{ rule: string; pattern: RegExp; offends: (match: string) => boolean }> =
  [
    {
      rule: 'hex colour literal — use a semantic token from @theme',
      pattern: /#[0-9a-fA-F]{3,8}\b/g,
      offends: () => true,
    },
    {
      rule: 'arbitrary radius or elevation — there are exactly three radii and two elevations',
      pattern: /(?<![\w\-/])(?:rounded|shadow)(?:-[a-z]+)*-\[/g,
      offends: () => true,
    },
    {
      rule: `radius outside the three tokens (${ALLOWED_RADII.join(', ')})`,
      pattern: /(?<![\w\-/])rounded(-[a-z0-9-]+)?(?![\w-])/g,
      offends: (match) => !ALLOWED_RADII.includes(match.slice('rounded-'.length)),
    },
    {
      rule: `elevation outside the two tokens (${ALLOWED_SHADOWS.join(', ')})`,
      pattern: /(?<![\w\-/])shadow(-[a-z0-9-]+)?(?![\w-])/g,
      offends: (match) => !ALLOWED_SHADOWS.includes(match.slice('shadow-'.length)),
    },
    {
      rule: "Tailwind's numeric colour scale — use a semantic token from @theme",
      pattern: new RegExp(`(?<![\\w\\-/])(?:${COLOUR_PREFIXES})-[a-z]+-\\d{2,3}(?![\\w-])`, 'g'),
      offends: () => true,
    },
  ];

/** Every violation in one source string, with line numbers. */
export function findOffences(source: string, file = '(inline)'): Offence[] {
  const offences: Offence[] = [];

  RULES.forEach(({ rule, pattern, offends }, index) => {
    // The hex rule scans the raw text: a hex colour in a comment is still a
    // colour somebody will copy. Everything else scans code only.
    const text = index === 0 ? source : stripComments(source);

    for (const match of text.matchAll(pattern)) {
      if (!offends(match[0])) continue;
      const line = text.slice(0, match.index).split('\n').length;
      offences.push({ file, line, found: match[0], rule });
    }
  });

  return offences;
}

function describeOffences(offences: readonly Offence[]): string {
  return offences.map((o) => `${o.file}:${o.line}  ${o.found}  <- ${o.rule}`).join('\n');
}

const FILES = tsxFiles(SRC);

describe('token contract — every .tsx file uses tokens, never raw values', () => {
  it('finds the app source files', () => {
    // Half of the anti-inert guard: a walker that returns nothing would make
    // every assertion below vacuously true.
    expect(FILES.length).toBeGreaterThan(0);
    expect(FILES.some((file) => file.endsWith('App.tsx'))).toBe(true);
  });

  it.each(FILES.map((file) => [relative(SRC, file).replaceAll('\\', '/'), file]))(
    '%s',
    (name, file) => {
      const offences = findOffences(readFileSync(file, 'utf8'), name);
      expect(offences, `\n${describeOffences(offences)}\n`).toEqual([]);
    },
  );
});

describe('token contract — the rules can actually fail', () => {
  // The other half of the anti-inert guard. Every case below is a real
  // violation; if the scanner stops catching one, this block goes red even
  // though every file in the app is clean.
  const violations: ReadonlyArray<[string, string]> = [
    ['hex colour', 'const c = <div style={{ color: "#0f2044" }} />;'],
    ['short hex colour', 'const c = <div className="x" data-c="#fff" />;'],
    ['arbitrary radius', 'const c = <div className="rounded-[10px]" />;'],
    ['arbitrary elevation', 'const c = <div className="shadow-[0_1px_2px_#000]" />;'],
    ['bare rounded', 'const c = <div className="rounded border" />;'],
    ['fourth radius', 'const c = <div className="rounded-lg p-2" />;'],
    ['third elevation', 'const c = <div className="shadow-2xl" />;'],
    ['bare shadow', 'const c = <div className="shadow p-2" />;'],
    ['numeric colour scale', 'const c = <div className="bg-slate-700" />;'],
    ['numeric colour scale on text', 'const c = <div className="hover:text-blue-500" />;'],
  ];

  it.each(violations)('catches a %s', (_name, source) => {
    expect(findOffences(source)).not.toEqual([]);
  });

  it('accepts the tokens that do exist', () => {
    const clean = `
      const Card = () => (
        <div className="rounded-card bg-card shadow-raised border border-line text-ink-muted">
          <span className="rounded-pill bg-teal/10 text-teal">saved</span>
          <button className="rounded-control bg-blue text-ink-inverse shadow-overlay">Add</button>
        </div>
      );
    `;
    expect(findOffences(clean)).toEqual([]);
  });

  it('does not trip on prose, on CSS property names, or on a URL', () => {
    // The three false positives that would get this guard deleted.
    const source = [
      '// the shadow under a card, and its rounded corners',
      '/* rounded-lg is banned; shadow-sm is banned */',
      'const style = { boxShadow: token, borderRadius: token };',
      'const help = "https://example.invalid/rounded";',
    ].join('\n');

    expect(findOffences(source)).toEqual([]);
  });

  it('boundary: an empty file is clean, and a file of only comments is clean', () => {
    expect(findOffences('')).toEqual([]);
    expect(findOffences('// nothing but a rounded shadow of a comment')).toEqual([]);
  });

  it('the comment stripper keeps real code and drops prose', () => {
    const stripped = stripComments('// rounded-lg\nconst a = "rounded-card"; // shadow-sm\n');
    expect(stripped).not.toContain('rounded-lg');
    expect(stripped).not.toContain('shadow-sm');
    expect(stripped).toContain('rounded-card');
  });

  it('the comment stripper leaves a URL alone', () => {
    expect(stripComments('const u = "https://example.invalid/a";')).toContain('example.invalid/a');
  });
});
