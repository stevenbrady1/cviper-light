/**
 * Every button wears one of the shared styles in `buttons.ts` (L-349).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * L-315 gave all four shared styles a disabled look, and
 * `buttons.contract.test.ts` proves each one has it. That proof covers the
 * STYLES. It says nothing about a button that copies a style by hand. The
 * paste form's Cancel did exactly that: `disabled={busy}` on a hand-written
 * class with no `disabled:` styles, so while an advert was being read it was
 * switched off and looked exactly as pressable as before. Four more buttons
 * copied the quiet or secondary look the same way, each missing the 44px
 * phone height as well.
 *
 * ============================================================================
 * THE TWO RULES — both forbid-lists
 * ============================================================================
 * 1. No `<button>` that can be switched off (`disabled` or `aria-disabled`)
 *    without a `_BUTTON` constant from `buttons.ts` in its `className`. A
 *    switched-off button with no shared style has no switched-off LOOK. There
 *    is no allow-list for this rule.
 * 2. No `<button>` without a shared constant unless it is in `ALLOWED` below,
 *    keyed by its file and a key that does not move when lines do, with a
 *    written reason. The list holds the buttons that are genuinely a different
 *    kind of thing (navigation, text links, a whole card); a stale entry fails,
 *    so the list cannot outlive the button it excuses.
 *
 * Comments are stripped before scanning: a commented-out `<button>` neither
 * trips the guard nor satisfies it, and nor does a `_BUTTON` name in a comment.
 *
 * The parser is lexical, like the other repository scans (`lib/repo-scan.ts`):
 * it walks the opening tag counting braces and quotes, so a multi-line tag
 * whose handler contains `=>` is read to its real end.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { displayPath, stripComments, walk } from '../lib/repo-scan';

import * as buttons from './buttons';

/** `apps/light/src`. */
const SRC = fileURLToPath(new URL('../', import.meta.url));

const SHARED_NAMES = Object.keys(buttons);
const SHARED = new RegExp(`\\b(?:${SHARED_NAMES.join('|')})\\b`);

interface ButtonTag {
  /** The opening tag's source, `<button` to its closing `>`. */
  readonly source: string;
  /** Raw value of `className=…` (quotes or braces included), or null. */
  readonly className: string | null;
  /** Raw value of `data-testid=…`, or null. */
  readonly testId: string | null;
  /** Carries `disabled` or `aria-disabled`. */
  readonly canBeSwitchedOff: boolean;
}

/**
 * The index of the `>` that closes the opening tag starting at `start`, and the
 * tag with every brace expression and quoted value blanked to spaces (their
 * outer delimiters kept), so attribute names can be found with a plain search.
 */
function readOpeningTag(source: string, start: number): { end: number; topLevel: string } {
  const stack: string[] = [];
  let topLevel = '';
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] ?? '';
    const top = stack.at(-1);
    const wasTopLevel = stack.length === 0;

    if (top === '"' || top === "'") {
      if (char === '\\' && stack.length > 1) {
        topLevel += '  ';
        index += 1;
        continue;
      }
      if (char === top) stack.pop();
    } else if (top === '`') {
      if (char === '\\') {
        topLevel += '  ';
        index += 1;
        continue;
      }
      if (char === '`') stack.pop();
      else if (char === '$' && source[index + 1] === '{') {
        stack.push('{');
        topLevel += '  ';
        index += 1;
        continue;
      }
    } else if (char === '"' || char === "'" || char === '`' || char === '{') {
      stack.push(char);
    } else if (char === '}') {
      stack.pop();
    } else if (char === '>' && wasTopLevel) {
      return { end: index, topLevel: topLevel + char };
    }

    // Keep a character only at the top level, or as the delimiter that leaves it.
    topLevel += wasTopLevel || stack.length === 0 ? char : ' ';
  }
  throw new Error(`an opening <button> tag at offset ${start} never closes`);
}

/** The raw value of attribute `name` in a tag, or null when it is absent. */
function attributeValue(tag: string, topLevel: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}=`).exec(topLevel);
  if (match === null) return null;
  const valueStart = match.index + match[0].length;
  const opener = topLevel[valueStart];
  const closer = opener === '{' ? '}' : opener;
  const valueEnd = topLevel.indexOf(closer ?? '', valueStart + 1);
  return tag.slice(valueStart, valueEnd + 1);
}

/** Every `<button>` opening tag in a piece of TSX, comments stripped first. */
function buttonTags(tsx: string): ButtonTag[] {
  const source = stripComments(tsx);
  const tags: ButtonTag[] = [];
  for (const match of source.matchAll(/<button(?=[\s>])/g)) {
    const { end, topLevel } = readOpeningTag(source, match.index);
    const tag = source.slice(match.index, end + 1);
    tags.push({
      source: tag,
      className: attributeValue(tag, topLevel, 'className'),
      testId: attributeValue(tag, topLevel, 'data-testid'),
      canBeSwitchedOff: /\s(?:aria-)?disabled(?=[\s=/>])/.test(topLevel),
    });
  }
  return tags;
}

function usesSharedStyle(tag: ButtonTag): boolean {
  return tag.className !== null && SHARED.test(tag.className);
}

/** Rule 1: switched-off buttons with no shared style. No allow-list. */
function switchedOffWithoutStyle(tags: readonly ButtonTag[]): ButtonTag[] {
  return tags.filter((tag) => tag.canBeSwitchedOff && !usesSharedStyle(tag));
}

/**
 * A key for a button that survives lines moving: its test id, else its class,
 * with the quotes, braces or backticks around the value taken off.
 */
function keyOf(tag: ButtonTag): string {
  const raw = tag.testId ?? tag.className ?? '(no className)';
  return raw
    .replace(/^\{\s*([`'"])([\s\S]*)\1\s*\}$/, '$2')
    .replace(/^(["'])([\s\S]*)\1$/, '$2')
    .replace(/\s+/g, ' ');
}

/**
 * The buttons that are deliberately NOT one of the four shared styles, by file
 * (relative to `apps/light/src`) and key (see `keyOf`), each with the reason.
 * None of them can be switched off: rule 1 has no list.
 */
const ALLOWED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'app/BottomNav.tsx': {
    'nav-${view.id}': 'A navigation tab: icon over label, with the teal marker rule on top.',
  },
  'app/Hint.tsx': {
    'hint-info':
      'The small "i" after a hint\'s words, inline in a line of text. Named exception (owner, ' +
      'L-384): 24×24px, the WCAG 2.2 AA minimum, not the 44px phone rule, so no row grows.',
  },
  'app/Sidebar.tsx': {
    'nav-${view.id}': 'A navigation item in the rail, with the teal marker rule on its left edge.',
  },
  'app/StatusStrip.tsx': {
    'status-none-settings': 'A text link inside a sentence on the dark status strip.',
  },
  'features/analysis/OllamaDownloadLink.tsx': {
    '${idPrefix}-ollama-link': 'A text link to a web page, underlined, 44px tall on a phone.',
  },
  'features/onboarding/Welcome.tsx': {
    'welcome-key-link': 'A text link to a web page inside the welcome copy.',
  },
  'features/search/ResultCard.tsx': {
    'result-source-${job.id}':
      "The link to the advert's own site: Adzuna's terms fix its minimum size (L-239).",
  },
  'features/signposts/Signpost.tsx': {
    'signpost-${id}-open': 'A quiet text link to a web page, 44px tall on a phone.',
  },
  'features/tracker/ConfirmDelete.tsx': {
    'confirm-delete-confirm':
      'Its class arrives as a prop the scan cannot follow; the one caller ' +
      '(ApplicationDetail) passes DESTRUCTIVE_BUTTON.',
  },
  'features/tracker/TrackerCard.tsx': {
    'tracker-card-${application.id}': 'The whole tracker card is one draggable button.',
  },
};

interface Found {
  readonly file: string;
  readonly tag: ButtonTag;
}

const FILES = walk(SRC, { extensions: ['.tsx'] });
const FOUND: Found[] = FILES.flatMap((path) =>
  buttonTags(readFileSync(path, 'utf8')).map((tag) => ({
    file: displayPath(path).replace(/^apps\/light\/src\//, ''),
    tag,
  })),
);

function describeFound({ file, tag }: Found): string {
  return `${file}: ${keyOf(tag)}`;
}

describe('every button wears a shared style (L-349)', () => {
  it('finds the buttons, so this contract cannot pass by reading nothing', () => {
    expect(FILES.length).toBeGreaterThan(40);
    expect(FOUND.length).toBeGreaterThan(100);
    expect(FOUND.filter(({ tag }) => usesSharedStyle(tag)).length).toBeGreaterThan(80);
  });

  it('rule 1: no button that can be switched off is missing a shared style', () => {
    const offenders = FOUND.filter(({ tag }) => switchedOffWithoutStyle([tag]).length > 0);
    expect(offenders.map(describeFound)).toEqual([]);
  });

  it('rule 2: no button is missing a shared style unless ALLOWED says why', () => {
    const offenders = FOUND.filter(
      ({ file, tag }) => !usesSharedStyle(tag) && ALLOWED[file]?.[keyOf(tag)] === undefined,
    );
    expect(offenders.map(describeFound)).toEqual([]);
  });

  it('every ALLOWED entry still names a real button with no shared style', () => {
    const stale = Object.entries(ALLOWED).flatMap(([file, keys]) =>
      Object.keys(keys)
        .filter(
          (key) =>
            !FOUND.some(
              (found) =>
                found.file === file && keyOf(found.tag) === key && !usesSharedStyle(found.tag),
            ),
        )
        .map((key) => `${file}: ${key}`),
    );
    expect(stale).toEqual([]);
  });

  it('every ALLOWED entry gives a reason', () => {
    const reasons = Object.values(ALLOWED).flatMap((keys) => Object.values(keys));
    expect(reasons.filter((reason) => reason.trim().length < 20)).toEqual([]);
  });
});

describe('the checker itself can fail (L-349)', () => {
  it('negative: a switched-off button with a hand-written class is caught', () => {
    const tags = buttonTags(
      '<button type="button" disabled={busy} className="rounded-control px-3 text-ink-muted">Cancel</button>',
    );
    expect(tags).toHaveLength(1);
    expect(switchedOffWithoutStyle(tags)).toHaveLength(1);
  });

  it('negative: aria-disabled counts as switched off, and so does a bare disabled', () => {
    const ariaDisabled = buttonTags('<button aria-disabled={saving} className="px-3">a</button>');
    const bareDisabled = buttonTags('<button disabled className="px-3">a</button>');
    expect(switchedOffWithoutStyle(ariaDisabled)).toHaveLength(1);
    expect(switchedOffWithoutStyle(bareDisabled)).toHaveLength(1);
  });

  it('boundary: a template literal that includes a shared constant passes', () => {
    const tags = buttonTags(
      '<button type="button" disabled={busy} className={`mt-3 ${SECONDARY_BUTTON}`}>Fill</button>',
    );
    expect(tags).toHaveLength(1);
    expect(usesSharedStyle(tags[0]!)).toBe(true);
    expect(switchedOffWithoutStyle(tags)).toEqual([]);
  });

  it('boundary: a name that only ends like a shared constant is not one', () => {
    const tags = buttonTags('<button disabled className={MY_QUIET_BUTTON}>a</button>');
    expect(switchedOffWithoutStyle(tags)).toHaveLength(1);
  });

  it('reads a multi-line tag whose handler contains => to its real end', () => {
    const tags = buttonTags(
      [
        '<button',
        '  type="button"',
        '  onClick={() => setOpen((was) => (was > 1 ? 0 : 1))}',
        '  disabled={busy}',
        '  className="px-3"',
        '>',
        '  Open',
        '</button>',
      ].join('\n'),
    );
    expect(tags).toHaveLength(1);
    expect(tags[0]?.source.endsWith('className="px-3"\n>')).toBe(true);
    expect(tags[0]?.className).toBe('"px-3"');
    expect(switchedOffWithoutStyle(tags)).toHaveLength(1);
  });

  it('a comment can neither trip the guard nor satisfy it', () => {
    expect(buttonTags('{/* <button disabled className="px-3">old</button> */}')).toEqual([]);
    expect(buttonTags('// <button disabled className="px-3">old</button>')).toEqual([]);
    const tags = buttonTags(
      '<button\n  /* QUIET_BUTTON */\n  disabled={busy}\n  className="px-3" // QUIET_BUTTON\n>a</button>',
    );
    expect(switchedOffWithoutStyle(tags)).toHaveLength(1);
  });

  it('negative: the word disabled inside a value is not the attribute', () => {
    const tags = buttonTags(
      '<button aria-label="Off while busy, disabled" className="px-3">a</button>',
    );
    expect(tags[0]?.canBeSwitchedOff).toBe(false);
  });
});
