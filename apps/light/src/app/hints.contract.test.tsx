// @vitest-environment jsdom
/**
 * No symbol without its meaning (L-215).
 *
 * Two halves, so the guard cannot go stale:
 *
 *   1. RENDERED. Each component that draws a symbol — ✓ ⚠ ✗ ▲ ▼ ⊘ ● ○ ◀ — is
 *      rendered, every text node holding one is found, and each must sit
 *      inside an element whose `aria-describedby` points at a tooltip with
 *      words in it. A symbol shown with no explanation fails here.
 *   2. SOURCE, as a forbid-list. Every shipped .ts/.tsx file that contains one
 *      of the symbols must be one this file renders (or the glossary itself).
 *      A NEW file that starts drawing a symbol fails until it is added to the
 *      rendered half — so no screen can quietly skip it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CardProgress } from '../features/flow/CardProgress';
import { JobStepBar } from '../features/flow/JobStepBar';
import { AtsStep } from '../features/tailor/AtsStep';
import { type AtsComparison } from '../features/tailor/atsComparison';

/**
 * The repository root, found from the working directory. Not `repo-scan.ts`'s
 * `REPO_ROOT`: that is built from `import.meta.url`, which is not a file URL in
 * the jsdom environment this file needs for rendering.
 */
function repoRoot(): string {
  let current = process.cwd();
  while (!existsSync(join(current, 'pnpm-workspace.yaml'))) {
    const parent = dirname(current);
    if (parent === current) throw new Error('no pnpm-workspace.yaml above the working directory');
    current = parent;
  }
  return current;
}

/** Shipped source: .ts/.tsx, no tests, no test helpers. */
function shippedSource(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'test', '__tests__'].includes(entry.name)) {
        found.push(...shippedSource(full));
      }
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/** Block and line comments out, so a symbol in prose does not count. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const SYMBOLS = ['✓', '⚠', '✗', '▲', '▼', '⊘', '●', '○', '◀'] as const;
const HAS_SYMBOL = new RegExp(`[${SYMBOLS.join('')}]`);

afterEach(cleanup);

/** Every text node holding a symbol, outside the tooltips themselves, that no tooltip explains. */
function unexplained(root: HTMLElement): string[] {
  const missing: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    if (!HAS_SYMBOL.test(text)) continue;
    let element = node.parentElement;
    if (element?.closest('[role="tooltip"]')) continue;
    let explained = false;
    while (element !== null && !explained) {
      const id = element.getAttribute('aria-describedby');
      const tip = id === null ? null : document.getElementById(id);
      explained =
        tip !== null && tip.getAttribute('role') === 'tooltip' && (tip.textContent ?? '') !== '';
      element = element.parentElement;
    }
    if (!explained) missing.push(text.trim());
  }
  return missing;
}

const COMPARISON: AtsComparison = {
  keyword: { before: 50, after: 47, delta: -3, beforeReason: null, afterReason: null },
  bullets: { before: 20, after: 30, delta: 10, totalBefore: 3, totalAfter: 5 },
  checks: [
    {
      id: 'section_headers',
      label: 'Structure & sections',
      before: 'pass',
      after: 'warn',
      afterMessage: 'x',
    },
    {
      id: 'contact_info',
      label: 'Contact details',
      before: 'pass',
      after: 'fail',
      afterMessage: 'x',
    },
    { id: 'cv_length', label: 'Length', before: 'warn', after: 'pass', afterMessage: 'x' },
  ],
  stillMissing: ['pega'],
  wordsAfter: 640,
};

/** Each file that draws a symbol, and how this test renders it. */
const RENDERED: Readonly<Record<string, () => void>> = {
  'apps/light/src/features/tailor/AtsStep.tsx': () => {
    render(<AtsStep comparison={COMPARISON} fabrication={{ clean: false, flagged: 1 }} />);
    render(
      <AtsStep
        comparison={{
          ...COMPARISON,
          keyword: { ...COMPARISON.keyword, after: 50, delta: 0 },
          bullets: { ...COMPARISON.bullets, totalBefore: 0 },
        }}
        fabrication={{ clean: true, flagged: 0 }}
      />,
    );
  },
  'apps/light/src/features/flow/JobStepBar.tsx': () => {
    render(
      <JobStepBar
        title="Business Analyst"
        company="CMC Markets"
        location="London"
        current="ats"
        progress={{ analysed: false, tailored: true, exported: false }}
        onStep={() => undefined}
        onTracker={() => undefined}
        choice={{ cv: 'CV.docx', engine: 'Gemini' }}
      />,
    );
  },
  'apps/light/src/features/flow/CardProgress.tsx': () => {
    render(
      <CardProgress
        applicationId="app-1"
        progress={{ analysed: true, tailored: true, exported: false }}
        onContinue={() => undefined}
      />,
    );
  },
};

/** The glossary itself: its explanations quote the symbols they explain. */
const GLOSSARY = 'apps/light/src/app/hints.ts';

describe('every symbol says what it means (L-215)', () => {
  it.each(Object.keys(RENDERED))('%s: every symbol it draws has an explanation', (file) => {
    RENDERED[file]!();
    const drawn = [...document.body.querySelectorAll('*')].some((el) =>
      HAS_SYMBOL.test(el.textContent ?? ''),
    );
    expect(drawn, `${file} rendered no symbol at all; the fixture is not exercising it`).toBe(true);
    expect(unexplained(document.body)).toEqual([]);
  });

  it('forbid-list: no shipped file draws a symbol this test does not render', () => {
    const root = repoRoot();
    const files = [join(root, 'apps/light/src'), join(root, 'packages/ui/src')].flatMap(
      shippedSource,
    );
    expect(files.length).toBeGreaterThan(50);
    const offenders = files
      .map((file) => relative(root, file).replaceAll('\\', '/'))
      .filter((file) => file !== GLOSSARY && !(file in RENDERED))
      .filter((file) => HAS_SYMBOL.test(withoutComments(readFileSync(join(root, file), 'utf8'))));
    expect(offenders).toEqual([]);
  });

  describe('the checker can fail', () => {
    it('a bare symbol with no tooltip is reported', () => {
      render(<p>Status: ✓ OK</p>);
      expect(unexplained(document.body)).toEqual(['Status: ✓ OK']);
    });

    it('a describedby that points at nothing does not count', () => {
      render(<span aria-describedby="nowhere">⚠ Check</span>);
      expect(unexplained(document.body)).toEqual(['⚠ Check']);
    });
  });
});
