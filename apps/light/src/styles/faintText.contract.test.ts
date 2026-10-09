/**
 * Faint text is told apart from muted text by more than colour (L-213).
 *
 * ============================================================================
 * WHY COLOUR ALONE CANNOT DO IT
 * ============================================================================
 * L-209 darkened `ink-faint` so it passes 4.5:1 on every light surface. The
 * cost: `ink-faint` (#5f6b80) and `ink-muted` (#46536a) are now only about
 * 1.44:1 apart, which most eyes cannot use to rank two lines of text. Three
 * text levels with a 4.5:1 floor on a light theme do not fit into colour.
 *
 * So faint text carries a second cue, in the same class string:
 *
 *   * SIZE — `text-xs`, `text-[11px]` or `text-[10px]`: smaller than the 14px
 *     body, where `text-sm` is the same 14px and is NOT a cue; or
 *   * WEIGHT — `font-normal`, used where the faint words sit inside a medium
 *     label (" (optional)" after a field name).
 *
 * A faint colour that applies only in a state — `disabled:`, `aria-disabled:`,
 * `placeholder:` — is not a text level and is not judged here: WCAG exempts
 * inactive controls, and a placeholder is not content.
 *
 * Anything else carries its meaning another way — a glyph with a hint, words
 * that already differ — and is listed in `ALLOWED` with the reason. The guard is
 * a forbid-list (LESSON-033): it finds every resting `text-ink-faint` and
 * fails one with no cue and no reason, so the next one is caught without
 * anyone editing this file.
 *
 * Grep-based, like `contrast.contract.test.ts`, one quoted string at a time:
 * a size inherited from a parent in another string is invisible to it, which
 * is what the allowlist is for.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const ROOTS = ['apps/light/src', 'packages/ui/src'];

// The same literal grammar as the contrast contract: ' and " cannot span
// lines; only a template literal may.
const LITERAL =
  /'([^'\n\\]*(?:\\.[^'\n\\]*)*)'|"([^"\n\\]*(?:\\.[^"\n\\]*)*)"|`((?:\\[\s\S]|[^`\\])*)`/g;

/** `text-ink-faint` with no state prefix in front of it. */
const RESTING_FAINT = /(?<![\w:-])text-ink-faint(?![\w-])/;

/** A second cue: smaller than the 14px body, or a weight against a medium label. */
const CUE = /(?<![\w:-])(text-xs|text-\[1[01]px\]|font-normal)(?![\w-])/;

/**
 * Faint strings that carry their meaning another way. Keyed by file AND the
 * exact class string, so moving one line does not break the entry and a new
 * uncued string in the same file is still caught.
 */
const ALLOWED: readonly { file: string; classes: string; reason: string }[] = [
  {
    file: 'apps/light/src/features/analysis/AnalysisResult.tsx',
    classes: 'bg-sunken text-ink-faint',
    reason:
      'The "low" priority tone, spread into a pill that is already text-xs font-medium. The ' +
      'pill’s own words ("If you have time" against "Worth doing") carry the rank.',
  },
  {
    file: 'apps/light/src/features/flow/JobStepBar.tsx',
    classes: 'hidden text-ink-faint md:inline',
    reason: 'A decorative separator between steps, hidden from screen readers. Not text.',
  },
  {
    file: 'apps/light/src/features/tailor/AtsStep.tsx',
    classes: 'text-ink-faint',
    reason:
      'A dash for "no score yet", not prose. The glyph is the cue, and its Hint says what it ' +
      'means on hover, on focus and to a screen reader (L-215).',
  },
  {
    file: 'apps/light/src/features/tailor/AtsStep.tsx',
    classes: 'whitespace-nowrap text-ink-faint',
    reason:
      '"no change" in the delta column, whose cell is text-xs (the size lives on the <td>), ' +
      'with a Hint (L-215).',
  },
  {
    file: 'apps/light/src/features/tracker/FunnelStrip.tsx',
    classes: "font-mono tabular-nums ${rate === null ? 'text-ink-faint' : 'text-teal-ink'}",
    reason:
      'The tone of the dash shown when there is no rate yet. The dash itself says "none"; a ' +
      'real rate is teal.',
  },
  {
    file: 'apps/light/src/features/tracker/nextAction.ts',
    classes: 'font-mono tabular-nums text-ink-faint',
    reason:
      'The "later" date tone. The date carries the meaning; soon and overdue are told apart ' +
      'by gold and red, which this is the calm default against.',
  },
];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

interface Faint {
  readonly file: string;
  readonly line: number;
  readonly classes: string;
}

/** Every quoted string with a resting faint colour and no second cue. */
export function uncuedFaint(file: string, source: string): Faint[] {
  const found: Faint[] = [];
  for (const literal of source.matchAll(LITERAL)) {
    const body = literal[1] ?? literal[2] ?? literal[3] ?? '';
    if (!RESTING_FAINT.test(body) || CUE.test(body)) continue;
    found.push({
      file,
      line: source.slice(0, literal.index).split('\n').length,
      classes: body.replace(/\s+/g, ' ').trim(),
    });
  }
  return found;
}

const FILES = ROOTS.flatMap((root) => walk(join(REPO, root)));
const FAINT_USES = FILES.reduce(
  (count, path) => count + (readFileSync(path, 'utf8').match(/text-ink-faint/g)?.length ?? 0),
  0,
);
const UNCUED = FILES.flatMap((path) =>
  uncuedFaint(relative(REPO, path).replace(/\\/g, '/'), readFileSync(path, 'utf8')),
);

function allowed(faint: Faint): boolean {
  return ALLOWED.some((entry) => entry.file === faint.file && entry.classes === faint.classes);
}

describe('faint text has a second cue (L-213)', () => {
  it('finds the faint text that exists', () => {
    // Anti-inert: a broken walk would pass everything below.
    expect(FILES.length).toBeGreaterThan(100);
    expect(FAINT_USES).toBeGreaterThan(50);
  });

  it('every resting text-ink-faint is smaller, lighter-weight, or listed with a reason', () => {
    const offenders = UNCUED.filter((faint) => !allowed(faint)).map(
      (faint) => `${faint.file}:${faint.line}  "${faint.classes}"`,
    );
    expect(
      offenders,
      'Faint and muted ink are ~1.44:1 apart — colour cannot rank them. Add text-xs (or ' +
        'font-normal inside a medium label), or list the string in ALLOWED with why it ' +
        'needs neither.',
    ).toEqual([]);
  });

  it('no allowlist entry is stale', () => {
    // An entry nothing matches any more would quietly excuse the next string
    // that happens to read the same.
    for (const entry of ALLOWED) {
      expect(
        UNCUED.some((faint) => faint.file === entry.file && faint.classes === entry.classes),
        `${entry.file} "${entry.classes}" is allowed but no longer used`,
      ).toBe(true);
      expect(entry.reason.length).toBeGreaterThan(30);
    }
  });

  describe('the checker can actually fail', () => {
    it('flags faint body text with nothing else to tell it apart', () => {
      expect(uncuedFaint('x.tsx', `<p className="mt-1.5 text-ink-faint">None.</p>`)).toHaveLength(
        1,
      );
    });

    it('boundary: text-sm is the body size, so it is not a cue', () => {
      expect(uncuedFaint('x.tsx', `<p className="mt-2 text-sm text-ink-faint">x</p>`)).toHaveLength(
        1,
      );
    });

    it('accepts a size or a weight cue in the same string', () => {
      for (const classes of [
        'text-xs text-ink-faint',
        'text-[11px] text-ink-faint',
        'text-[10px] text-ink-faint',
        'font-normal text-ink-faint',
      ]) {
        expect(uncuedFaint('x.tsx', `"${classes}"`), classes).toEqual([]);
      }
    });

    it('negative: a state-only faint colour is not a text level', () => {
      for (const classes of [
        'text-ink disabled:text-ink-faint',
        'aria-disabled:text-ink-faint',
        'placeholder:text-ink-faint text-ink',
      ]) {
        expect(uncuedFaint('x.tsx', `"${classes}"`), classes).toEqual([]);
      }
    });

    it('negative: a cue under a state prefix does not count', () => {
      expect(uncuedFaint('x.tsx', `"text-ink-faint md:text-xs"`)).toHaveLength(1);
    });
  });
});
