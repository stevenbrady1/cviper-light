/**
 * No typed mark or control glyph reaches the screen (L-369).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Ticks, crosses, warnings, the step dots, the score arrows, the reorder
 * arrows and the remove × were all typed characters. A typed character
 * renders in whatever fallback font the machine has, so its size, weight and
 * even its shape changed from one computer to the next. L-354, L-360, L-362
 * and L-369 drew every one of them instead: meaning-bearing marks are
 * `StateMark`s, controls are `Icon`s. This check keeps it that way — a new
 * screen that types one of these characters fails here, not on somebody's PC.
 *
 * ============================================================================
 * WHAT IT READS — A FORBID-LIST, ON THE COPY ONLY
 * ============================================================================
 * Every shipped .ts/.tsx under `apps/light/src` and `packages/ui/src` (the two
 * places screen code lives; the same two the L-215 check reads), tests and
 * test helpers excluded. From each, only the words that can reach the screen:
 * string literals, template literals and JSX text, read off the PARSE TREE by
 * `lib/copy-text.ts`, so comments are excluded by construction — a comment can
 * neither trip the check nor excuse a real mark. `className` and `data-*`
 * values are not copy and are skipped. HTML entities and escapes are decoded
 * first, so `&times;`, `&#8593;` and `'✓'` are the characters they draw.
 *
 * ============================================================================
 * WHAT STAYS TYPED ON PURPOSE — `KEPT`
 * ============================================================================
 * Each entry names its file, the exact words around the character, and why.
 * An entry excuses those words in that file and nothing else, and must match
 * EXACTLY ONCE: a stale entry (the words are gone) fails, and so does a second
 * copy of the words in the same file (a new use needs its own decision).
 *
 * HONEST LIMITS: text built at run time from character codes, or arriving as
 * data (a job advert, a CV), is not source and is not read here. The drawn
 * controls themselves are pinned by their components' own tests (`shownAs`).
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { HOLE, copyText } from '../lib/copy-text';
import { REPO_ROOT, displayPath, walk } from '../lib/repo-scan';

/** The characters that used to be marks or controls. None may be typed. */
export const TYPED_MARKS = [
  '✓',
  '✔',
  '✗',
  '✕',
  '✖',
  '×',
  '⚠',
  '▲',
  '▼',
  '◀',
  '▶',
  '●',
  '○',
  '⊘',
  '↑',
  '↓',
  '←',
  '→',
] as const;

const HAS_TYPED_MARK = new RegExp(`[${TYPED_MARKS.join('')}]`, 'u');
const EVERY_TYPED_MARK = new RegExp(`[${TYPED_MARKS.join('')}]`, 'gu');

/** Why a typed character is kept. */
type KeptBecause =
  /** The → at the end of the words of a link or an onward button: part of the sentence. */
  | 'onward'
  /** "Settings → …" in the privacy wording, copied word for word to the published page. */
  | 'privacy'
  /** A character in DATA the app decodes, never a mark the app draws. */
  | 'data';

interface Kept {
  readonly file: string;
  /** The exact words, as the copy reader gives them, entities decoded. */
  readonly text: string;
  readonly because: KeptBecause;
  readonly reason: string;
}

const ONWARD =
  'The arrow ends the words of a link or an onward button and is part of the sentence; ' +
  'the words carry the whole meaning, so nothing is lost if the arrow draws a little differently.';
const PRIVACY =
  'Privacy wording: it is copied word for word to the published privacy page and changes only ' +
  'with the owner. "Settings → …" is a path through the app, written as a sentence, not a control.';

/** Everything that stays typed on purpose. Each must match exactly once. */
export const KEPT: readonly Kept[] = [
  {
    file: 'apps/light/src/features/onboarding/Welcome.tsx',
    text: "I'll look around myself →",
    because: 'onward',
    reason: `${ONWARD} The welcome's skip button; its screen-reader words follow it.`,
  },
  {
    file: 'apps/light/src/features/onboarding/Welcome.tsx',
    text: 'Want sharper AI? Add a key →',
    because: 'onward',
    reason: `${ONWARD} A link-styled button into Settings.`,
  },
  {
    file: 'apps/light/src/features/search/ResultCard.tsx',
    text: 'Open original →',
    because: 'onward',
    reason: `${ONWARD} Opens the advert in the browser.`,
  },
  {
    file: 'apps/light/src/features/settings/about/About.tsx',
    text: 'cviper.ai/light →',
    because: 'onward',
    reason: `${ONWARD} A web link.`,
  },
  {
    file: 'apps/light/src/features/settings/about/About.tsx',
    text: 'Source and licence on GitHub →',
    because: 'onward',
    reason: `${ONWARD} A web link.`,
  },
  {
    file: 'apps/light/src/features/settings/about/About.tsx',
    text: 'Terms of use →',
    because: 'onward',
    reason: `${ONWARD} A web link.`,
  },
  {
    file: 'apps/light/src/features/settings/keys/AiKeySetup.tsx',
    text: `${HOLE} →`,
    because: 'onward',
    reason: `${ONWARD} After the provider's sign-up link label.`,
  },
  {
    file: 'apps/light/src/features/settings/keys/KeySetup.tsx',
    text: `${HOLE} →`,
    because: 'onward',
    reason: `${ONWARD} After the job board's sign-up link label.`,
  },
  {
    file: 'apps/light/src/features/tracker/ApplicationDetail.tsx',
    text: 'Open the advert →',
    because: 'onward',
    reason: `${ONWARD} Opens the advert in the browser.`,
  },
  {
    file: 'apps/light/src/features/tracker/PasteJobForm.tsx',
    text: 'Open Settings →',
    because: 'onward',
    reason: `${ONWARD} A link-styled button into Settings.`,
  },
  {
    file: 'apps/light/src/features/settings/privacy/policyDocument.ts',
    text: 'Settings → Privacy',
    because: 'privacy',
    reason: PRIVACY,
  },
  {
    file: 'apps/light/src/features/settings/privacy/policyDocument.ts',
    text: 'Settings → Delete everything removes the database',
    because: 'privacy',
    reason: PRIVACY,
  },
  {
    file: 'apps/light/src/features/settings/privacy/policyDocument.ts',
    text: 'Settings → Delete everything removes all of it at once',
    because: 'privacy',
    reason: PRIVACY,
  },
  {
    file: 'apps/light/src/lib/outbound-hosts.ts',
    text: 'Settings → About',
    because: 'privacy',
    reason: `${PRIVACY} The update check's "why", shown in Settings → Privacy and on the published page.`,
  },
  {
    file: 'apps/light/src/features/tracker/htmlToText.ts',
    text: '×',
    because: 'data',
    reason:
      "The HTML-entity table that reads a pasted advert: `&times;` becomes the × the advert's " +
      'author wrote ("2 × 3 days"). It is the advert\'s text, never a mark the app draws.',
  },
];

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  times: '×',
  check: '✓',
  cross: '✗',
  uarr: '↑',
  darr: '↓',
  larr: '←',
  rarr: '→',
  apos: "'",
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  nbsp: ' ',
};

/** HTML entities as the characters they draw, so `&times;` is not a way round. */
function decoded(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** One shipped file: its path from the repository root, and its text. */
export interface SourceFile {
  readonly path: string;
  readonly source: string;
}

export interface TypedMarkReport {
  /** `path:line: [mark] in "…"`, one per piece of copy still holding a typed mark. */
  readonly offences: readonly string[];
  /** Kept entries that did not match exactly once. */
  readonly stale: readonly string[];
}

/** The check, pure, so it can be shown failing on made-up files. */
export function findTypedMarks(
  files: readonly SourceFile[],
  kept: readonly Kept[] = KEPT,
): TypedMarkReport {
  const offences: string[] = [];
  const matched = new Map<Kept, number>(kept.map((entry) => [entry, 0]));

  for (const { path, source } of files) {
    const mine = kept.filter((entry) => entry.file === path);
    for (const piece of copyText(source, path)) {
      let text = decoded(piece.text);
      for (const entry of mine) {
        const parts = text.split(entry.text);
        matched.set(entry, (matched.get(entry) ?? 0) + parts.length - 1);
        text = parts.join(' ');
      }
      if (HAS_TYPED_MARK.test(text)) {
        const marks = [...new Set(text.match(EVERY_TYPED_MARK) ?? [])].join(' ');
        offences.push(`${path}:${String(piece.line)}: ${marks} in "${text.slice(0, 120)}"`);
      }
    }
  }

  const stale = kept
    .filter((entry) => matched.get(entry) !== 1)
    .map(
      (entry) =>
        `${entry.file}: "${entry.text}" matched ${String(matched.get(entry))} times, not exactly once`,
    );
  return { offences, stale };
}

const FILES = [
  ...walk(`${REPO_ROOT}/apps/light/src`, { extensions: ['.ts', '.tsx'] }),
  ...walk(`${REPO_ROOT}/packages/ui/src`, { extensions: ['.ts', '.tsx'] }),
];

function shipped(): SourceFile[] {
  return FILES.map((file) => ({ path: displayPath(file), source: readFileSync(file, 'utf8') }));
}

describe('no typed mark or control glyph reaches the screen (L-369)', () => {
  it('reads a real corpus (anti-inert)', () => {
    const files = shipped();
    const names = files.map((file) => file.path);
    expect(names.length).toBeGreaterThan(200);
    for (const known of [
      'apps/light/src/features/boards/BoardSettings.tsx',
      'apps/light/src/features/search/SearchSaved.tsx',
      'apps/light/src/features/tracker/SubstageEditor.tsx',
      'apps/light/src/features/tailor/AtsStep.tsx',
      'apps/light/src/app/hints.ts',
    ]) {
      expect(names, known).toContain(known);
    }
    expect(names.some((name) => /\.test\.tsx?$/.test(name))).toBe(false);
    const pieces = files.reduce(
      (total, file) => total + copyText(file.source, file.path).length,
      0,
    );
    expect(pieces).toBeGreaterThan(3000);
  });

  it('forbid-list: no shipped copy types one of the marks', () => {
    expect(findTypedMarks(shipped()).offences).toEqual([]);
  });

  it('every kept exception still exists, exactly once', () => {
    expect(findTypedMarks(shipped()).stale).toEqual([]);
  });

  it('every kept exception holds a typed mark, says why, and is the kind it claims', () => {
    for (const entry of KEPT) {
      const label = `${entry.file}: ${entry.text}`;
      expect(HAS_TYPED_MARK.test(entry.text), label).toBe(true);
      expect(entry.reason.length, label).toBeGreaterThan(40);
      if (entry.because === 'onward') expect(entry.text.endsWith(' →'), label).toBe(true);
      if (entry.because === 'privacy') expect(entry.text, label).toMatch(/^Settings → [A-Z]/);
    }
  });

  describe('the checker can fail', () => {
    const FILE = 'apps/light/src/features/tracker/Elsewhere.tsx';
    const offences = (source: string, kept: readonly Kept[] = []): readonly string[] =>
      findTypedMarks([{ path: FILE, source }], kept).offences;

    it('a typed tick in JSX text is reported, naming the file', () => {
      const found = offences('export const A = () => <span>✓ Saved</span>;');
      expect(found).toHaveLength(1);
      expect(found[0]).toContain(FILE);
    });

    it.each(TYPED_MARKS.map((mark) => [mark]))('%s in a string literal is reported', (mark) => {
      expect(offences(`export const label = 'Move ${mark}';`)).toHaveLength(1);
    });

    it('a typed arrow as the whole content of a button is reported', () => {
      const source = [
        'export const Up = () => (',
        '  <button type="button" aria-label="Move up">',
        '    ↑',
        '  </button>',
        ');',
      ].join('\n');
      expect(offences(source)).toHaveLength(1);
    });

    it('a mark in a template literal or an attribute a reader sees is reported', () => {
      expect(offences('export const t = (n: number) => `${String(n)} ×`;')).toHaveLength(1);
      expect(offences('export const A = () => <b title="Done ✓">x</b>;')).toHaveLength(1);
    });

    it('an entity or an escape is not a way round', () => {
      expect(offences('export const A = () => <span>&times;</span>;')).toHaveLength(1);
      expect(offences('export const A = () => <span>&#8593;</span>;')).toHaveLength(1);
      expect(offences('export const A = () => <span>&#x2713;</span>;')).toHaveLength(1);
      expect(offences("export const t = '\\u2713';")).toHaveLength(1);
    });

    it('negative: a comment holding a mark is not an offence', () => {
      const source = ['// was ↑ and ↓ (L-369)', '/* ✓ ⚠ ✗ */', 'export const later = 1;'].join(
        '\n',
      );
      expect(offences(source)).toEqual([]);
    });

    it('negative: a class name or a data attribute is not copy', () => {
      expect(offences('export const A = () => <b className="x→y" data-x="✓">ok</b>;')).toEqual([]);
    });

    const KEEP_LINK: Kept = {
      file: FILE,
      text: 'Open original →',
      because: 'onward',
      reason: 'a made-up exception for these tests, long enough to be a reason',
    };

    it('boundary: a kept exception excuses its own words and nothing else beside them', () => {
      expect(offences('export const A = () => <a>Open original →</a>;', [KEEP_LINK])).toEqual([]);
      expect(
        offences('export const A = () => <a>Open original → ✓</a>;', [KEEP_LINK]),
      ).toHaveLength(1);
    });

    it('a kept exception excuses nothing in another file', () => {
      const report = findTypedMarks(
        [
          {
            path: 'apps/light/src/other.tsx',
            source: 'export const A = () => <a>Open original →</a>;',
          },
        ],
        [KEEP_LINK],
      );
      expect(report.offences).toHaveLength(1);
      expect(report.stale).toHaveLength(1);
    });

    it('a stale exception fails, and so does a second copy of its words', () => {
      const gone = findTypedMarks([{ path: FILE, source: 'export const a = 1;' }], [KEEP_LINK]);
      expect(gone.stale).toEqual([`${FILE}: "Open original →" matched 0 times, not exactly once`]);
      const twice = findTypedMarks(
        [
          {
            path: FILE,
            source: "export const a = 'Open original →';\nexport const b = 'Open original →';",
          },
        ],
        [KEEP_LINK],
      );
      expect(twice.stale).toEqual([`${FILE}: "Open original →" matched 2 times, not exactly once`]);
    });
  });
});
