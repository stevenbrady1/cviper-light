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
 *
 * Drawn marks (L-354) are held to the same rule, so moving a screen from typed
 * symbols to SVG cannot take it out of the check. On screen every `StateMark`
 * carries `data-mark`, and each one must be explained exactly as a symbol must;
 * a render that draws only marks still counts as having drawn something. In
 * source, a file that names `StateMark` (or writes `data-mark`) is an offender
 * unless this file renders it — the component's own definition and its
 * re-export are the only files excused the name, each with its reason below.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CardProgress } from '../features/flow/CardProgress';
import { JobStepBar } from '../features/flow/JobStepBar';
import { AtsStep } from '../features/tailor/AtsStep';
import { type AtsComparison } from '../features/tailor/atsComparison';
import { StateMark } from '../ui/StateMark';
import { Hint } from './Hint';

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

/** A drawn mark on screen: every `StateMark` carries this attribute (L-354). */
const DRAWN_MARK = '[data-mark]';

/** Whether `element` or an ancestor points `aria-describedby` at a tooltip with words in it. */
function explainedFrom(start: Element | null): boolean {
  for (let element = start; element !== null; element = element.parentElement) {
    const id = element.getAttribute('aria-describedby');
    const tip = id === null ? null : document.getElementById(id);
    if (tip !== null && tip.getAttribute('role') === 'tooltip' && (tip.textContent ?? '') !== '') {
      return true;
    }
  }
  return false;
}

/**
 * Every symbol text node, outside the tooltips themselves, and every drawn
 * mark, anywhere, that no tooltip explains. A drawn mark is not excused for
 * sitting inside a tooltip: the glossary quotes typed symbols in its words,
 * but nothing has a reason to draw a mark there.
 */
function unexplained(root: HTMLElement): string[] {
  const missing: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    if (!HAS_SYMBOL.test(text)) continue;
    if (node.parentElement?.closest('[role="tooltip"]')) continue;
    if (!explainedFrom(node.parentElement)) missing.push(text.trim());
  }
  for (const mark of root.querySelectorAll(DRAWN_MARK)) {
    if (!explainedFrom(mark)) missing.push(`[data-mark="${mark.getAttribute('data-mark') ?? ''}"]`);
  }
  return missing;
}

/** Whether a render drew anything this file holds to account: a typed symbol or a drawn mark. */
function drewAMark(root: HTMLElement): boolean {
  return (
    root.querySelector(DRAWN_MARK) !== null ||
    [...root.querySelectorAll('*')].some((el) => HAS_SYMBOL.test(el.textContent ?? ''))
  );
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

/**
 * The only files that may NAME `StateMark` without being rendered here, each
 * with its reason. Neither draws a mark: whatever renders them is what puts a
 * mark on screen, and that file is held to the rule. The exemption covers the
 * name only — a typed symbol in either is still an offence.
 */
const NAMES_STATE_MARK: Readonly<Record<string, string>> = {
  'apps/light/src/ui/StateMark.tsx': 'the definition: it draws a mark only for whoever renders it',
  'apps/light/src/ui/index.ts': 'the re-export: one line that names it and draws nothing',
};

/** One shipped file: its path from the repository root, and its text. */
interface SourceFile {
  readonly path: string;
  readonly source: string;
}

/**
 * A drawn mark in source: the component's name, or its attribute written by
 * hand. Matched anywhere in the code, so `StateMarkName` and an aliased import
 * count too — a file that decides which mark to show is held to the rule.
 */
const NAMES_A_MARK = /StateMark|data-mark/;

/**
 * The source half, pure, so the checker can be shown failing on made-up files.
 * A file this test does not render offends if its code — comments stripped, so
 * prose can neither trip the check nor satisfy it — holds a typed symbol (the
 * glossary excepted) or names a drawn mark (the definition and re-export
 * excepted).
 */
function sourceOffenders(files: readonly SourceFile[]): string[] {
  return files
    .filter(({ path }) => !(path in RENDERED))
    .filter(({ path, source }) => {
      const code = withoutComments(source);
      const typesASymbol = path !== GLOSSARY && HAS_SYMBOL.test(code);
      const drawsAMark = !(path in NAMES_STATE_MARK) && NAMES_A_MARK.test(code);
      return typesASymbol || drawsAMark;
    })
    .map(({ path }) => path);
}

describe('every symbol says what it means (L-215)', () => {
  it.each(Object.keys(RENDERED))('%s: every symbol it draws has an explanation', (file) => {
    RENDERED[file]!();
    expect(
      drewAMark(document.body),
      `${file} rendered no symbol at all; the fixture is not exercising it`,
    ).toBe(true);
    expect(unexplained(document.body)).toEqual([]);
  });

  it('forbid-list: no shipped file draws a symbol this test does not render', () => {
    const root = repoRoot();
    const files = [join(root, 'apps/light/src'), join(root, 'packages/ui/src')].flatMap(
      shippedSource,
    );
    expect(files.length).toBeGreaterThan(50);
    const offenders = sourceOffenders(
      files.map((file) => ({
        path: relative(root, file).replaceAll('\\', '/'),
        source: readFileSync(file, 'utf8'),
      })),
    );
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

    // Drawn marks (L-354): the same rule, found by attribute instead of by text.
    it('a bare StateMark with no tooltip is reported', () => {
      render(
        <p>
          Status <StateMark name="tick" /> OK
        </p>,
      );
      expect(unexplained(document.body)).toEqual(['[data-mark="tick"]']);
    });

    it('a StateMark whose describedby points at nothing is reported', () => {
      render(
        <span aria-describedby="nowhere">
          <StateMark name="warning" /> Check
        </span>,
      );
      expect(unexplained(document.body)).toEqual(['[data-mark="warning"]']);
    });

    it('boundary: a StateMark under a real Hint passes', () => {
      render(
        <Hint text="Done: this step is finished.">
          <StateMark name="tick" />
        </Hint>,
      );
      expect(unexplained(document.body)).toEqual([]);
    });

    it('boundary: a StateMark under a Hint with no words is reported', () => {
      render(
        <Hint text="">
          <StateMark name="ring" />
        </Hint>,
      );
      expect(unexplained(document.body)).toEqual(['[data-mark="ring"]']);
    });

    it('a drawn mark counts as something drawn, so a moved screen still has to explain it', () => {
      render(<StateMark name="dot" />);
      expect(drewAMark(document.body)).toBe(true);
      cleanup();
      render(<p>Nothing to explain here.</p>);
      expect(drewAMark(document.body)).toBe(false);
    });

    const ELSEWHERE = 'apps/light/src/features/tracker/Elsewhere.tsx';
    const USES_A_MARK = [
      "import { StateMark } from '../../ui';",
      'export const Done = () => <StateMark name="tick" />;',
    ].join('\n');

    it('a file that mentions StateMark and is not rendered here is an offender', () => {
      expect(sourceOffenders([{ path: ELSEWHERE, source: USES_A_MARK }])).toEqual([ELSEWHERE]);
    });

    it('a file that hand-writes data-mark and is not rendered here is an offender', () => {
      const source = 'export const Done = () => <span data-mark="tick">x</span>;';
      expect(sourceOffenders([{ path: ELSEWHERE, source }])).toEqual([ELSEWHERE]);
    });

    it('negative: a comment that mentions StateMark is not an offender', () => {
      const source = [
        '/** Will draw a StateMark once L-355 moves this screen over. */',
        '// StateMark, data-mark',
        'export const later = 1;',
      ].join('\n');
      expect(sourceOffenders([{ path: ELSEWHERE, source }])).toEqual([]);
    });

    it('a comment cannot excuse a real StateMark either', () => {
      const source = `// rendered by hints.contract.test.tsx, honestly\n${USES_A_MARK}`;
      expect(sourceOffenders([{ path: ELSEWHERE, source }])).toEqual([ELSEWHERE]);
    });

    it('a file this test renders may use StateMark', () => {
      const rendered = 'apps/light/src/features/flow/JobStepBar.tsx';
      expect(sourceOffenders([{ path: rendered, source: USES_A_MARK }])).toEqual([]);
    });

    it('the definition and the re-export are excused the name, and nothing else', () => {
      for (const path of Object.keys(NAMES_STATE_MARK)) {
        expect(sourceOffenders([{ path, source: USES_A_MARK }]), path).toEqual([]);
        const typed = `${USES_A_MARK}\nexport const old = '✓';`;
        expect(sourceOffenders([{ path, source: typed }]), path).toEqual([path]);
      }
      // The glossary may quote symbols, but has no business drawing a mark.
      expect(sourceOffenders([{ path: GLOSSARY, source: USES_A_MARK }])).toEqual([GLOSSARY]);
    });

    it('the name exemptions are real files that still define and re-export StateMark', () => {
      const root = repoRoot();
      const [definition, reexport] = Object.keys(NAMES_STATE_MARK);
      expect(readFileSync(join(root, definition!), 'utf8')).toMatch(/export function StateMark\b/);
      expect(readFileSync(join(root, reexport!), 'utf8')).toMatch(
        /^export \{[^}]*\bStateMark\b[^}]*\} from '\.\/StateMark';$/m,
      );
    });
  });
});
