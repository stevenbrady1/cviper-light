/**
 * No copy tells anybody what an AI request will cost (L-249).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Settings said "A typical CV check costs a few pence", and the Anthropic card
 * said the same. CViper cannot know what a provider charges: prices are the
 * provider's, they change, they differ by model, and a long CV costs more than
 * a short one. An estimate is a promise somebody else keeps — or does not. So
 * the copy says what is TRUE without an amount: the provider bills your own
 * account at its published rates, CViper adds nothing and takes no cut, a
 * model on your own PC is free, and prices can change.
 *
 * ============================================================================
 * A FORBID-LIST, ON THE COPY ONLY
 * ============================================================================
 * Reads what a user can see — string literals and JSX text, comments excluded
 * by construction (`copy-text.ts`) — in every shipped source under
 * `apps/light/src` and `packages/*\/src`, plus README.md and the store copy in
 * `docs/app-store/`. Whitespace is collapsed, so a sentence wrapped across two
 * lines or two `+`-joined strings is still caught.
 *
 * Salary amounts in adverts ("£650 per day") are not cost estimates and are
 * not touched: an amount is only forbidden next to the words a cost estimate
 * uses (check, analysis, request, call, CV).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { copyText } from './copy-text';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** An amount: "£0.02", "$1", "€ 3", "2p", "2–3p". */
const AMOUNT = String.raw`(?:[£$€]\s?\d[\d.,]*|\b\d+(?:\s?[–-]\s?\d+)?p\b)`;
const COST_NOUN = String.raw`\b(?:checks?|analys[ie]s|requests?|calls?|cvs?)\b`;

interface Rule {
  readonly id: string;
  readonly pattern: RegExp;
}

const RULES: readonly Rule[] = [
  { id: 'pence', pattern: /\b(?:pence|penny|pennies)\b/i },
  {
    id: 'costs-about',
    pattern: /\bcosts?\s+(?:about|around|roughly|approximately|only|just|under|less\s+than)\b/i,
  },
  { id: 'a-typical-costs', pattern: /\btypical(?:ly)?\b[^.]{0,60}\bcosts?\b/i },
  {
    id: 'amount-near-check',
    pattern: new RegExp(`${AMOUNT}[^.]{0,50}${COST_NOUN}|${COST_NOUN}[^.]{0,50}${AMOUNT}`, 'i'),
  },
  { id: 'cheap', pattern: /\bcheap(?:er|est|ly)?\b|\binexpensive\b/i },
];

export interface CostOffence {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly text: string;
}

export function findCostClaims(source: string, file: string): CostOffence[] {
  const offences: CostOffence[] = [];
  for (const piece of copyText(source, file)) {
    for (const rule of RULES) {
      if (rule.pattern.test(piece.text)) {
        offences.push({ file, line: piece.line, rule: rule.id, text: piece.text.slice(0, 160) });
      }
    }
  }
  return offences;
}

const SKIPPED = new Set(['node_modules', 'dist', '.turbo', 'src-tauri', 'test', '__tests__']);

function sources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED.has(entry.name)) found.push(...sources(full));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      found.push(full);
    }
  }
  return found;
}

const PACKAGES = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(ROOT, 'packages', entry.name, 'src'));

const STORE_DOCS = readdirSync(join(ROOT, 'docs', 'app-store'))
  .filter((name) => name.endsWith('.md'))
  .map((name) => join(ROOT, 'docs', 'app-store', name));

const FILES = [
  ...sources(join(ROOT, 'apps', 'light', 'src')),
  ...PACKAGES.flatMap((directory) => {
    try {
      return sources(directory);
    } catch {
      return [];
    }
  }),
  join(ROOT, 'README.md'),
  ...STORE_DOCS,
];

const NAME = (file: string): string => relative(ROOT, file).replaceAll('\\', '/');

describe('no AI cost estimate in any copy a user can read', () => {
  it('reads a real corpus (anti-inert)', () => {
    const names = FILES.map(NAME);
    expect(names.length).toBeGreaterThan(150);
    expect(names).toContain('apps/light/src/features/onboarding/cards.ts');
    expect(names).toContain('apps/light/src/features/settings/keys/aiKeyModel.ts');
    expect(names).toContain('README.md');
    expect(names).toContain('docs/app-store/privacy-policy.md');
    const pieces = FILES.reduce(
      (total, file) => total + copyText(readFileSync(file, 'utf8'), NAME(file)).length,
      0,
    );
    expect(pieces).toBeGreaterThan(1000);
  });

  it.each(FILES.map((file) => [NAME(file), file] as const))('%s', (name, file) => {
    expect(findCostClaims(readFileSync(file, 'utf8'), name)).toEqual([]);
  });
});

describe('the guard catches cost estimates', () => {
  const caught: ReadonlyArray<readonly [string, string, string]> = [
    [
      'the old Settings line',
      'a.ts',
      `export const L = 'A typical CV check costs a few pence, paid to the AI provider you choose.';`,
    ],
    [
      'the old Anthropic line',
      'a.ts',
      `export const L = 'Anthropic bills your own account; a typical CV check costs a few pence.';`,
    ],
    [
      'split across a two-line concatenation',
      'a.ts',
      `export const L = 'Each check costs a few ' +\n  'pence on your own account.';`,
    ],
    [
      'split across two JSX lines',
      'a.tsx',
      `<p>A check is billed at a few\n        pence by the provider.</p>`,
    ],
    ['an amount next to "check"', 'a.tsx', `<p>About £0.02 per check.</p>`],
    ['a range in pence next to "CV"', 'a.md', `Roughly 2–3p for a CV check.\n`],
    [
      'a dollar amount after "analysis"',
      'a.ts',
      `export const L = 'Each analysis is under $0.05.';`,
    ],
    ['costs about', 'a.tsx', `<p>It costs about nothing.</p>`],
    ['cheap', 'a.tsx', `<p>AI checks are cheap.</p>`],
  ];

  it.each(caught)('catches %s', (_name, file, source) => {
    expect(findCostClaims(source, file)).not.toEqual([]);
  });
});

describe('the guard lets true, amount-free copy through', () => {
  const passes: ReadonlyArray<readonly [string, string, string]> = [
    [
      'billed at the provider’s own rates',
      'a.ts',
      `export const L = 'The provider bills your own account at its published rates, and prices can change.';`,
    ],
    [
      'no cut, and local is free',
      'a.tsx',
      `<p>CViper adds nothing and takes no cut. A model running on your own PC is free.</p>`,
    ],
    ['a neutral AI line', 'a.tsx', `<p>Uses AI to help generate results.</p>`],
    ['a salary amount in an advert', 'a.ts', `export const L = 'The rate is £650 per day.';`],
    [
      'a salary field hint',
      'a.ts',
      `export const L = 'Enter a salary as whole pounds — 45000, not £45k.';`,
    ],
    [
      'a comment that quotes the old line',
      'a.ts',
      `// It used to say "a typical CV check costs a few pence".\nexport const x = 1;`,
    ],
    ['a fenced code block', 'a.md', 'Text.\n\n```\nA typical check costs a few pence\n```\n'],
  ];

  it.each(passes)('passes %s', (_name, file, source) => {
    expect(findCostClaims(source, file)).toEqual([]);
  });
});
