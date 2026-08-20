/**
 * The prose contract: a slot that carries a SENTENCE is never clipped to one
 * line.
 *
 * ============================================================================
 * WHAT WENT WRONG
 * ============================================================================
 * `DetailPane`'s subtitle was rendered with Tailwind's `truncate`
 * (`overflow:hidden; text-overflow:ellipsis; white-space:nowrap`). The pane is
 * 380px wide, which leaves the header's text block 287px. Measured in Chrome at
 * the app's minimum width and again at 1400px, the paste-review subtitle was:
 *
 *     text        "Nothing has been saved yet. Correct anything that is wrong,
 *                  then save."
 *     clientWidth 287px      scrollWidth 402px
 *
 * So every user read "Nothing has been saved yet. Correct anything th...". That
 * sentence is the entire confirm-before-save promise of the paste flow, and it
 * was invisible in the half that matters.
 *
 * Every unit test passed throughout. The full string IS in the DOM, so
 * `getByText` found it; jsdom does no layout, so nothing noticed it was
 * unreadable. Present in the markup, unreadable by a human — a defect no
 * assertion in this repo could see.
 *
 * ============================================================================
 * THIS GUARD CHECKS CLASSES, NOT PIXELS. SAY IT PLAINLY.
 * ============================================================================
 * jsdom does no layout: `scrollWidth` is 0 for everything, always. A
 * rendered-width assertion is IMPOSSIBLE in Vitest, and faking one — asserting
 * against a hand-computed character count, or stubbing `scrollWidth` — would
 * produce a number that agrees with nothing a browser does and rots the moment
 * the font changes.
 *
 * So this guard does the thing that CAN be checked honestly: it forbids the
 * CLASS. It prevents this specific regression — a one-line clip reappearing on
 * a prose slot — and it does not and cannot prove any given sentence fits. A
 * genuine layout check needs a real browser and belongs in an end-to-end run.
 *
 * ============================================================================
 * TWO RULES, BOTH FORBID-LISTS (LESSON-033)
 * ============================================================================
 * 1. REGISTERED SLOTS. A component that renders a caller's prose into an
 *    element of its own — `DetailPane`'s subtitle is the one in this app —
 *    cannot be judged from its own source, because the sentence lives at the
 *    call site. Those slots are named below by `data-testid` and must carry no
 *    clipping class.
 *
 * 2. ANY LITERAL SENTENCE, ANYWHERE. Any JSX element in the app whose own
 *    literal text reads as a sentence must carry no clipping class. This needs
 *    no registry and catches the same mistake made somewhere nobody thought to
 *    list.
 *
 * Neither rule says "X must be present", so neither goes green on the day
 * somebody rewords the copy, and neither goes red on the day somebody improves
 * it.
 *
 * ============================================================================
 * WHAT IS *NOT* FORBIDDEN, AND WHY THAT IS THE HARD HALF
 * ============================================================================
 * `truncate` is CORRECT on a value on one line, and this app is full of them:
 * the pane's own title (a job title), a card's job title and its
 * "company / location" line, a board name in Settings. Clipping a long job
 * title to one line is the right call — it keeps a card the same height as
 * every other card, and the full text is one click away in the pane. A guard
 * that fired on those would be deleted within a release, and would take the
 * guard for the real bug with it.
 *
 * So the forbidden set is only what destroys a sentence by forcing it onto ONE
 * line: `truncate`, `text-ellipsis`, `whitespace-nowrap`, `line-clamp-1`.
 *
 * Deliberately NOT forbidden:
 *
 *   * bare `overflow-hidden`. It clips nothing on its own where the height is
 *     free, and it is load-bearing on things that are not text at all —
 *     `BandScale` uses it to keep a segmented bar inside its pill radius, and
 *     `Tracker` uses it on the board's scroll container.
 *   * `line-clamp-2` and above. A two- or three-line preview of a long
 *     description is a deliberate design decision, not a sentence lost.
 *
 * ============================================================================
 * WHY THIS CANNOT GO QUIETLY INERT
 * ============================================================================
 * The failure mode of every guard in this repo is scanning nothing and
 * reporting green. Four floors, each of which fails on its own:
 *
 *   * `it opens the app source` — the walker found files, including the file
 *     the registered slot lives in.
 *   * the registered-slot assertion requires EXACTLY ONE match, so a slot whose
 *     `data-testid` is renamed or deleted goes RED rather than unchecked. This
 *     is the floor that matters most: the registry is the half a scan of
 *     literal text cannot replace.
 *   * `it extracted a real corpus` — floors on classed elements and on
 *     sentence-bearing elements found across the app. Break the parse and both
 *     collapse to zero.
 *   * `the rules can actually fail` — one synthetic source per forbidden class,
 *     each asserted caught, plus the legitimate uses asserted clean.
 *
 * This file is `.ts` and scans only `.tsx`, so the forbidden class names below
 * can be written out in full without tripping it. Do not rename it to `.tsx`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** `src/` — this file lives in `src/styles/`. */
const SRC = fileURLToPath(new URL('..', import.meta.url));

/**
 * Utilities that force text onto one line and cut what does not fit.
 *
 * `line-clamp-1` is here and `line-clamp-2` is not: clamping to a single line
 * is the same defect wearing a different name, and clamping to two or more is a
 * preview somebody chose.
 */
const CLIPPING_CLASSES = ['truncate', 'text-ellipsis', 'whitespace-nowrap', 'line-clamp-1'];

/**
 * Slots that render PROSE SUPPLIED BY A CALLER.
 *
 * The element's own source shows `{subtitle}` and nothing else, so rule 2
 * cannot see the sentence; only a human reading the call sites can. Each entry
 * records the judgement so the next person does not have to make it again.
 */
const PROSE_SLOTS: ReadonlyArray<{ testid: string; file: string; why: string }> = [
  {
    testid: 'detail-pane-subtitle',
    file: 'app/DetailPane.tsx',
    why:
      'Every caller passes a sentence: "Nothing has been saved yet. Correct anything ' +
      'that is wrong, then save.", "An AI reads the advert. You check every field ' +
      'before it is saved.", "Anything you have applied to, typed in by hand." The ' +
      'longest needs 402px and the slot is 287px, so a one-line clip hides the end ' +
      'of the sentence at every window size the app supports.',
  },
];

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
    else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) found.push(full);
  }
  return found.sort();
}

/** One JSX element, reduced to the three things these rules care about. */
export interface Element {
  /** Every class name mentioned anywhere in `className`, however it is built. */
  readonly classes: readonly string[];
  /** `data-testid`, when it is a plain string. */
  readonly testid: string | null;
  /** The element's own literal text, with `{...}` holes left out. */
  readonly text: string;
  readonly line: number;
}

/**
 * Every string literal inside an expression, so an array-joined class list is
 * seen.
 *
 * Two traps, both of which silently returned a SHORT list rather than an error,
 * which is the shape of an inert guard:
 *
 *   * `forEachChild` stops walking the moment its callback returns something
 *     truthy, and `Array.prototype.push` returns the new length. The callback
 *     therefore has a block body and returns nothing.
 *   * a template literal keeps its text in `head` and in each span's
 *     `literal` (`TemplateMiddle`/`TemplateTail`), none of which is a
 *     `StringLiteral`, so they are collected by hand. Without the tail,
 *     `` `${base} truncate` `` reads as having no classes at all.
 */
function stringsIn(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];

  const found: string[] = [];
  if (ts.isTemplateExpression(node)) {
    found.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
  }
  node.forEachChild((child) => {
    found.push(...stringsIn(child));
  });
  return found;
}

function attributeStrings(element: ts.JsxOpeningLikeElement, name: string): string[] {
  for (const property of element.attributes.properties) {
    if (!ts.isJsxAttribute(property) || property.name.getText() !== name) continue;
    const value = property.initializer;
    if (value === undefined) continue;
    if (ts.isStringLiteral(value)) return [value.text];
    if (ts.isJsxExpression(value) && value.expression !== undefined) {
      return stringsIn(value.expression);
    }
  }
  return [];
}

/**
 * The element's OWN literal text.
 *
 * `{expression}` children contribute nothing — deliberately, since a value
 * substituted in is exactly the case rule 1's registry exists for, and guessing
 * at it here is how a guard starts firing on job titles.
 */
function ownText(node: ts.Node): string {
  if (!ts.isJsxElement(node)) return '';
  return node.children
    .filter((child) => ts.isJsxText(child))
    .map((child) => child.getText())
    .join(' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/** Every classed or testid-bearing element in one source file. */
export function elementsIn(source: string, file = '(inline)'): Element[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Element[] = [];

  function visit(node: ts.Node): void {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const classes = attributeStrings(opening, 'className').flatMap((value) =>
        value.split(/\s+/).filter((token) => token !== ''),
      );
      const testid = attributeStrings(opening, 'data-testid')[0] ?? null;
      if (classes.length > 0 || testid !== null) {
        found.push({
          classes,
          testid,
          text: ownText(node),
          line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
        });
      }
    }
    node.forEachChild(visit);
  }

  visit(parsed);
  return found;
}

/**
 * Does this text read as a SENTENCE rather than a value?
 *
 * Four or more words AND terminal punctuation, or an internal sentence break.
 * "Paste a job" is three words with no stop; "CV.docx" is one word. Both walk
 * through, which is the point — they are values, and clipping a value is fine.
 */
export function isSentence(text: string): boolean {
  const words = text.split(/\s+/).filter((word) => word !== '');
  if (words.length < 4) return false;
  return /[.!?]$/.test(text) || /[.!?]\s/.test(text);
}

export function clippingClassesOn(element: Element): string[] {
  return element.classes.filter((token) => CLIPPING_CLASSES.includes(token));
}

/** Rule 2, over one source string. */
export function findClippedSentences(source: string, file = '(inline)'): Offence[] {
  return elementsIn(source, file)
    .filter((element) => isSentence(element.text) && clippingClassesOn(element).length > 0)
    .map((element) => ({
      file,
      line: element.line,
      found: clippingClassesOn(element).join(' '),
      rule: `a sentence must not be clipped to one line: "${element.text.slice(0, 60)}"`,
    }));
}

function describeOffences(offences: readonly Offence[]): string {
  return offences.map((o) => `${o.file}:${o.line}  ${o.found}  <- ${o.rule}`).join('\n');
}

const FILES = tsxFiles(SRC);

const CORPUS = FILES.map((file) => {
  const name = relative(SRC, file).replaceAll('\\', '/');
  return { name, elements: elementsIn(readFileSync(file, 'utf8'), name) };
});

const ALL_ELEMENTS = CORPUS.flatMap((entry) =>
  entry.elements.map((element) => ({ ...element, file: entry.name })),
);

describe('prose contract — registered prose slots are never clipped', () => {
  it.each(PROSE_SLOTS.map((slot) => [slot.testid, slot] as const))('%s', (testid, slot) => {
    const matches = ALL_ELEMENTS.filter((element) => element.testid === testid);

    // The floor that matters: a renamed or deleted testid must go RED, not
    // silently stop being checked.
    expect(matches, `no element carries data-testid="${testid}"`).toHaveLength(1);
    expect(matches[0]?.file).toBe(slot.file);

    const clipping = clippingClassesOn(matches[0]!);
    expect(clipping, `\n${testid} carries "${clipping.join(' ')}"\n${slot.why}\n`).toEqual([]);
  });
});

describe('prose contract — no literal sentence anywhere is clipped to one line', () => {
  it.each(CORPUS.map((entry) => [entry.name, entry] as const))('%s', (name, entry) => {
    const offences = entry.elements
      .filter((element) => isSentence(element.text) && clippingClassesOn(element).length > 0)
      .map((element) => ({
        file: name,
        line: element.line,
        found: clippingClassesOn(element).join(' '),
        rule: `a sentence must not be clipped: "${element.text.slice(0, 60)}"`,
      }));

    expect(offences, `\n${describeOffences(offences)}\n`).toEqual([]);
  });
});

describe('prose contract — the scan opened a real corpus', () => {
  it('it opens the app source', () => {
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES.some((file) => file.endsWith('DetailPane.tsx'))).toBe(true);
  });

  it('it extracted a real corpus', () => {
    // Break the parse and both of these collapse to zero, whatever the
    // per-file assertions above say.
    const classed = ALL_ELEMENTS.filter((element) => element.classes.length > 0);
    const sentences = ALL_ELEMENTS.filter((element) => isSentence(element.text));

    expect(classed.length).toBeGreaterThan(300);
    expect(sentences.length).toBeGreaterThan(20);
  });

  it('it still sees the clipping that is legitimate', () => {
    // Half the value of this guard is that it does NOT fire on these. If they
    // stop being found, the scanner has stopped reading class names and every
    // assertion above is vacuous.
    const clipped = ALL_ELEMENTS.filter((element) => clippingClassesOn(element).length > 0);
    expect(clipped.length).toBeGreaterThan(3);
  });
});

describe('prose contract — the rules can actually fail', () => {
  const violations: ReadonlyArray<[string, string]> = [
    [
      'truncate',
      'const c = <p className="truncate text-xs">Nothing has been saved yet. Save it.</p>;',
    ],
    [
      'text-ellipsis',
      'const c = <p className="text-ellipsis">Nothing has been saved yet. Save it.</p>;',
    ],
    [
      'whitespace-nowrap',
      'const c = <p className="whitespace-nowrap">Nothing has been saved yet. Save it.</p>;',
    ],
    [
      'line-clamp-1',
      'const c = <p className="line-clamp-1">Nothing has been saved yet. Save it.</p>;',
    ],
    [
      'a clip built up in an array of class names',
      'const c = <p className={["text-xs", "truncate"].join(" ")}>An AI reads it. You check it.</p>;',
    ],
    [
      'a clip in a template literal',
      'const c = <p className={`text-xs truncate ${tone}`}>An AI reads it. You check it.</p>;',
    ],
  ];

  it.each(violations)('catches %s', (_name, source) => {
    expect(findClippedSentences(source)).not.toEqual([]);
  });

  it('leaves the legitimate clipping alone', () => {
    // Every one of these is in the app right now and must stay clean.
    const clean = `
      const Card = () => (
        <div>
          <h2 className="truncate font-semibold text-ink">{title}</h2>
          <p className="truncate font-medium text-ink">{job.title}</p>
          <p className="truncate text-xs text-ink-muted">{where}</p>
          <span className="min-w-0 truncate text-ink">{board.label}</span>
          <span className="truncate">Paste a job</span>
          <span className="truncate">CV.docx</span>
          <div className="flex h-2 overflow-hidden rounded-pill" />
          <p className="line-clamp-2">Two lines of a long advert, previewed. Nothing lost.</p>
        </div>
      );
    `;
    expect(findClippedSentences(clean)).toEqual([]);
  });

  it('a sentence with no clipping class is clean', () => {
    const source = 'const c = <p className="text-xs">Nothing has been saved yet. Save.</p>;';
    expect(findClippedSentences(source)).toEqual([]);
  });

  it('boundary: three words with a full stop is a value, four is a sentence', () => {
    expect(isSentence('Salary not stated.')).toBe(false);
    expect(isSentence('Nothing has been saved.')).toBe(true);
  });

  it('boundary: a long label with no terminal stop is not a sentence', () => {
    expect(isSentence('Senior Quantitative Developer, Systematic Credit')).toBe(false);
    expect(isSentence('Goldman Sachs International, London, Greater London')).toBe(false);
  });

  it('boundary: an internal sentence break counts even with no terminal stop', () => {
    expect(isSentence('An AI reads the advert. You check every field')).toBe(true);
  });

  it('boundary: empty and whitespace-only text are not sentences', () => {
    expect(isSentence('')).toBe(false);
    expect(isSentence('   ')).toBe(false);
  });

  it('negative: a substituted value is not read as the element own text', () => {
    // `{subtitle}` is a hole, not prose. Guessing at it is how a guard starts
    // firing on job titles — which is why rule 1 has a registry.
    const [element] = elementsIn('const c = <p className="truncate">{subtitle}</p>;');
    expect(element?.text).toBe('');
  });

  it('the class extractor reads every shape of className the app uses', () => {
    const shapes = [
      'const a = <p className="truncate" />;',
      'const b = <p className={"truncate"} />;',
      'const c = <p className={`x truncate`} />;',
      'const d = <p className={["x", "truncate"].join(" ")} />;',
      'const e = <p className={`${base} truncate`} />;',
    ];
    for (const source of shapes) {
      expect(elementsIn(source)[0]?.classes).toContain('truncate');
    }
  });
});
