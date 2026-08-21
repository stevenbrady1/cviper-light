/**
 * The event contract: nothing reads a React synthetic event after the handler
 * has yielded.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * React reuses one event object per dispatch. The moment the handler returns,
 * `currentTarget` is nulled. Anything that reads the event AFTER that point
 * — a lazy `setState` updater, a line after an `await`, a `setTimeout` — reads
 * from a corpse, and `event.currentTarget.value` throws `TypeError: Cannot read
 * properties of null` in front of the user.
 *
 * This has shipped here twice:
 *
 *   1. `NewApplicationForm`'s status `<select>` read `event.currentTarget.value`
 *      inside `setDraft(current => …)`.
 *   2. `BoardSettings`'s encoding `<select>` had the identical shape and threw
 *      the instant anyone touched it.
 *
 * Twice is a pattern, and a pattern is a machine's job. Both fixes were the
 * same one line — read the value into a local `const` in the handler, then use
 * the local — so what is being guarded is not subtle knowledge, it is a habit
 * nobody can be relied on to keep.
 *
 * ============================================================================
 * WHY A PARSER AND NOT A REGULAR EXPRESSION
 * ============================================================================
 * `styles/tokens.contract.test.ts` and `features/settings/telemetry.contract.test.ts`
 * scan with regular expressions because what they forbid is LEXICAL: a hex
 * literal is a hex literal wherever it appears. This guard forbids something
 * about CONTROL FLOW — the same twelve characters, `event.currentTarget`, are
 * correct one line up and a crash one line down — and no regular expression can
 * see the difference. A guard that cannot tell the two apart is one that either
 * misses the bug or fires on the fix, and both get it deleted.
 *
 * So this one parses. `typescript` is already the compiler every package
 * typechecks with, and `ts.createSourceFile` is a syntax-only parse: no
 * program, no type checker, no `tsconfig`, milliseconds per file.
 *
 * It is a devDependency of `apps/light` ITSELF, not merely of the workspace
 * root (`9444bcd`). Before that it resolved by walking up to the root
 * `node_modules`, which worked only because of where this directory happens to
 * sit. Lift `apps/light` out on its own — the split `monorepo-split.yml`
 * already performs for three of the `packages/*` — and there is no root to walk
 * up to: the import fails, or finds some other copy, and the guard goes inert
 * in exactly the way it was written to warn about.
 *
 * The version is not written here or in `apps/light/package.json`. Both that
 * file and the root say `catalog:`, pointing at the single entry in
 * `pnpm-workspace.yaml`. Two literal strings for one compiler drift, and pnpm
 * settles a disagreement by installing BOTH — which would leave this guard
 * parsing with a different compiler from the one `tsc --noEmit` typechecks
 * with, the same inertness by another route. One string cannot disagree with
 * itself.
 *
 * ============================================================================
 * WHAT IS AN OFFENCE
 * ============================================================================
 *   1. Any mention of the event inside a DEFERRED callback — a lazy state
 *      updater `setX(prev => …)`, a `setTimeout`/`queueMicrotask`/
 *      `requestAnimationFrame` callback, a `.then`/`.catch`/`.finally`
 *      callback, or anything named like a debounce. Reading a field there is a
 *      crash; capturing the whole event there is the same crash one call away.
 *   2. Any FIELD READ on the event after the enclosing handler has passed an
 *      `await`.
 *
 * ============================================================================
 * WHAT IS NOT AN OFFENCE, AND WHY THAT IS THE HARD HALF
 * ============================================================================
 * Twenty handler sites in this repo read an event — forty-two references
 * between them — and every one is correct. Three look wrong:
 *
 *   * `BoardSettings.tsx` — `void apply(setBoardEnabled(…, event.currentTarget
 *     .checked))`. `apply` is async, but ARGUMENTS ARE EVALUATED BEFORE THE
 *     CALL IS ENTERED, so the read is synchronous. The rule below only looks
 *     inside FUNCTION EXPRESSIONS passed to a deferring call, never at an
 *     argument that is merely an expression, which is exactly this distinction.
 *
 *   * `Search.tsx` — the whole event goes into an async handler, but
 *     `event.preventDefault()` is its first statement and the `await` is twelve
 *     lines below. The walk is in SOURCE ORDER and an `await` only marks its
 *     own frame as yielded once it has been passed, so a read above the first
 *     `await` is clean and a read below it is not.
 *
 *   * `ApplicationDetail.tsx` — `nextAction.setDraft(event.currentTarget.value)`
 *     looks like an event being debounced. `setDraft` takes a STRING; only a
 *     string crosses the boundary. Same distinction as the first: the argument
 *     is an expression, not a function.
 *
 * And the pattern that fixed both real bugs — read into a local `const` first,
 * then use the local inside the updater — is invisible to this guard by
 * construction, because the guard tracks the EVENT BINDING, and a local `const`
 * is not it.
 *
 * ============================================================================
 * THE ESCAPE HATCH, AND WHY IT IS ITSELF GUARDED
 * ============================================================================
 * A source scanner that blocks correct code is deleted inside six months, and
 * the bug it was catching comes back. So there is a hatch:
 *
 *     // cviper-allow-event-after-yield: <why this one is actually safe>
 *
 * on the offending line or the line above it. The reason is MANDATORY — a bare
 * marker, or one with nothing after the colon, is itself a failure. A hatch
 * that can be opened without saying why is not a hatch, it is a hole, and a
 * silent bypass is the single most repeated way a guard in this repo has gone
 * quietly inert. An unused suppression fails too: it is a hole waiting for
 * unrelated code to drift underneath it.
 *
 * No file in the repo needs one. That is the target — a guard precise enough
 * that the hatch stays shut.
 *
 * ============================================================================
 * WHY THIS CANNOT GO QUIETLY INERT
 * ============================================================================
 * Three legs, because two of them have a hole between them:
 *
 *   * `the scanner can actually fail` feeds it both real historical bugs
 *     verbatim plus every other shape of the mistake, and asserts each is
 *     caught. A detector regressed to returning `[]` goes red here.
 *   * `finds the source files` asserts the walker returned a real corpus
 *     containing files known to exist. A moved directory or a broken walk goes
 *     red here.
 *   * `actually adjudicated the event handlers it cleared` asserts the guard
 *     examined at least twenty real event references, including at least one
 *     in each of the four files that matter most.
 *
 * The third leg looks redundant and is not. Both of the others prove the guard
 * works ON THE STRINGS THEY HAND IT; neither proves it works on the repo. Make
 * `scriptKind` return `ScriptKind.TS` unconditionally — a one-word change — and
 * every `.tsx` in the app stops parsing as JSX, so every component silently
 * yields no handlers at all. All 132 per-file assertions still pass. Every
 * synthetic violation is still caught, because those default to `.tsx`. The
 * corpus is now completely unguarded and the suite is green. Only the count of
 * what was actually adjudicated notices. That failure was reproduced on purpose
 * before this comment was written; it is not a hypothesis.
 *
 * This file is a test file, and test files are excluded from the scan, so the
 * bad examples written out below cannot trip it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** The repo root — this file lives in `apps/light/src/lib/`. */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * Fields whose presence on an identifier proves it is an event.
 *
 * Deliberately the unambiguous ones. `detail` and `isTrusted` are real event
 * fields and are left out: plenty of things that are not events have a
 * `.detail`, and a marker that misfires turns every later rule into a false
 * positive on an innocent object.
 */
const EVENT_MARKERS: ReadonlySet<string> = new Set([
  'preventDefault',
  'stopPropagation',
  'stopImmediatePropagation',
  'persist',
  'currentTarget',
  'target',
  'nativeEvent',
  'dataTransfer',
  'clipboardData',
  'relatedTarget',
  'touches',
  'changedTouches',
]);

/** Callbacks these run are entered after the current task, never during it. */
const TIMER_CALLEES: ReadonlySet<string> = new Set([
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'requestAnimationFrame',
  'requestIdleCallback',
]);

/** Callbacks these run are entered when a promise settles, never during it. */
const PROMISE_CALLEES: ReadonlySet<string> = new Set(['then', 'catch', 'finally']);

/** Names that mean "call this later", spelled however the author felt. */
const DEFERRING_NAME = /debounce|throttle|defer|schedule|nextTick/i;

/**
 * `FormEvent`, `React.ChangeEvent<HTMLInputElement>`, `KeyboardEvent`, `Event`.
 *
 * The negative lookahead is what keeps `EventTarget` and `MouseEventHandler`
 * out: a parameter typed as either of those is not an event.
 */
const EVENT_TYPE = /Event(?![A-Za-z])/;

/** The hatch. The `(:...)` group is optional ON PURPOSE — see `SUPPRESSION`. */
const SUPPRESSION = /cviper-allow-event-after-yield(:([^\n]*))?/g;

type FunctionLike =
  ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

export interface Offence {
  readonly file: string;
  readonly line: number;
  readonly found: string;
  readonly rule: string;
}

/**
 * One place the guard actually adjudicated: a reference to a bound event.
 *
 * The third leg of the anti-inert guard, and the one the other two cannot
 * cover. `FILES.length > 100` proves the walker found files and the synthetic
 * violations prove the detector bites — but a classifier that quietly stopped
 * recognising event parameters would satisfy both and clear every file in the
 * repo by never looking at anything. Counting the sites it examined is the
 * difference between "twenty sites are clean" and "twenty sites were never
 * opened".
 */
export interface Site {
  readonly file: string;
  readonly line: number;
  readonly found: string;
}

/** One function on the stack, as the walk sees it at the current cursor. */
interface Frame {
  /** Parameters of THIS function that are events. */
  readonly events: ReadonlySet<string>;
  /** Non-null when this function's body runs after its creator returned. */
  readonly deferredBy: string | null;
  /** Set once an `await` in THIS frame has been walked past. */
  yielded: boolean;
}

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** `window.setTimeout` -> `setTimeout`, `promise.then` -> `then`, `f` -> `f`. */
function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

/**
 * Why a function expression handed to this call will run later — or null.
 *
 * The lazy-state-updater clause insists on EXACTLY ONE argument, because that
 * is the shape React's setter actually has. It is what keeps
 * `setBoardEnabled(preferences, board.id, …)` out: a three-argument `setX` is
 * somebody's own helper, called right now, not a state updater queued for the
 * next render.
 */
function deferReason(call: ts.CallExpression): string | null {
  const name = calleeName(call);
  if (name === null) return null;

  if (TIMER_CALLEES.has(name)) return `\`${name}(…)\`, which runs after the handler returns`;
  if (PROMISE_CALLEES.has(name)) return `\`.${name}(…)\`, which runs when the promise settles`;
  if (DEFERRING_NAME.test(name)) return `\`${name}(…)\`, which defers its callback`;
  if (/^set[A-Z]/.test(name) && call.arguments.length === 1) {
    return `\`${name}(prev => …)\`, a lazy state updater React runs during the next render`;
  }
  return null;
}

/** Does this function's body ever touch `name.<an event marker>`? */
function touchesEventMarker(fn: FunctionLike, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name &&
      EVENT_MARKERS.has(node.name.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body !== undefined) visit(fn.body);
  return found;
}

/**
 * Which of this function's parameters are events.
 *
 * Three ways to know, in order of certainty: the type says so; the body treats
 * it as one; or it is literally called `event`, which is what every handler in
 * this app calls it and is the only way to catch a handler that captures the
 * whole event without ever reading a field from it.
 */
function eventParameters(fn: FunctionLike): ReadonlySet<string> {
  const names = new Set<string>();
  for (const parameter of fn.parameters) {
    if (!ts.isIdentifier(parameter.name)) continue;
    const name = parameter.name.text;
    if (parameter.type !== undefined && EVENT_TYPE.test(parameter.type.getText())) {
      names.add(name);
    } else if (name === 'event') {
      names.add(name);
    } else if (touchesEventMarker(fn, name)) {
      names.add(name);
    }
  }
  return names;
}

/**
 * Is this identifier a USE of a binding, rather than a name that merely spells
 * one? `event` in `(event) => …` declares it, `x.event` names a property of
 * something else, and neither is a read of the event.
 */
function isReference(id: ts.Identifier): boolean {
  const parent: ts.Node | undefined = id.parent;
  if (parent === undefined) return false;
  if (ts.isParameter(parent) && parent.name === id) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if (ts.isQualifiedName(parent) && parent.right === id) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === id) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === id) return false;
  if (ts.isBindingElement(parent) && parent.name === id) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === id) return false;
  if (ts.isJsxAttribute(parent)) return false;
  return true;
}

function scriptKind(file: string): ts.ScriptKind {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/**
 * Every comment in the file, by position.
 *
 * Comments are trivia and are not AST nodes, so they are collected off the
 * nodes they lead and trail. The point of doing it this way rather than with a
 * regular expression is that a suppression is only a suppression when it is in
 * a COMMENT — a marker sitting inside a string literal must not open the hatch,
 * or the hatch has a second, undocumented key.
 */
function commentRanges(source: ts.SourceFile, text: string): ts.CommentRange[] {
  const ranges: ts.CommentRange[] = [];
  const seen = new Set<number>();

  const add = (found: readonly ts.CommentRange[] | undefined): void => {
    for (const range of found ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      ranges.push(range);
    }
  };

  const visit = (node: ts.Node): void => {
    add(ts.getLeadingCommentRanges(text, node.pos));
    add(ts.getTrailingCommentRanges(text, node.end));
    ts.forEachChild(node, visit);
  };

  visit(source);
  add(ts.getLeadingCommentRanges(text, source.endOfFileToken.pos));
  return ranges;
}

interface Suppression {
  readonly line: number;
  readonly reason: string | null;
  used: boolean;
}

/** A suppression covers the line it is on and the line below it. */
function coversLine(suppression: Suppression, line: number): boolean {
  return line === suppression.line || line === suppression.line + 1;
}

/**
 * Every violation in one source, and every event reference it adjudicated.
 *
 * Exported through `findOffences` and `eventSites` so the self-proof block
 * below can feed it strings — including both real historical bugs — and prove
 * the detector still bites, and still looks.
 */
function analyse(source: string, file: string): { offences: Offence[]; sites: Site[] } {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const lineOf = (pos: number): number => parsed.getLineAndCharacterOfPosition(pos).line + 1;

  const raw: Offence[] = [];
  const sites: Site[] = [];
  const stack: Frame[] = [];
  const deferred = new Map<ts.Node, string>();

  const record = (id: ts.Identifier, found: string, rule: string): void => {
    raw.push({ file, line: lineOf(id.getStart(parsed)), found, rule });
  };

  const check = (id: ts.Identifier): void => {
    if (!isReference(id)) return;

    let binding = -1;
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index]?.events.has(id.text) === true) {
        binding = index;
        break;
      }
    }
    if (binding === -1) return;

    const access = ts.isPropertyAccessExpression(id.parent) && id.parent.expression === id;
    const found = access ? `${id.text}.${id.parent.name.getText()}` : id.text;

    sites.push({ file, line: lineOf(id.getStart(parsed)), found });

    // 1. Anything at all about the event, inside a callback that runs later.
    for (let index = binding + 1; index < stack.length; index += 1) {
      const reason = stack[index]?.deferredBy;
      if (reason === undefined || reason === null) continue;
      record(
        id,
        found,
        `the event is used inside ${reason} — by then React has recycled it and ` +
          '`currentTarget` is null. Read the value into a local `const` in the handler ' +
          'and use the local.',
      );
      return;
    }

    // 2. A field read after the handler has already yielded.
    if (!access) return;
    for (let index = binding; index < stack.length; index += 1) {
      if (stack[index]?.yielded !== true) continue;
      record(
        id,
        found,
        'the event is read after an `await` — the handler has already yielded and React ' +
          'has recycled it. Read the value into a local `const` before the first `await`.',
      );
      return;
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const reason = deferReason(node);
      if (reason !== null) {
        for (const argument of node.arguments) {
          if (isFunctionLike(argument)) deferred.set(argument, reason);
        }
      }
    }

    if (isFunctionLike(node)) {
      stack.push({
        events: eventParameters(node),
        deferredBy: deferred.get(node) ?? null,
        yielded: false,
      });
      ts.forEachChild(node, visit);
      stack.pop();
      return;
    }

    if (ts.isAwaitExpression(node)) {
      // Children FIRST. `await f(event.currentTarget.value)` evaluates its
      // argument before it suspends, so that read is synchronous and clean —
      // the frame only counts as yielded once the await itself is behind us.
      ts.forEachChild(node, visit);
      const frame = stack[stack.length - 1];
      if (frame !== undefined) frame.yielded = true;
      return;
    }

    if (ts.isForOfStatement(node) && node.awaitModifier !== undefined) {
      visit(node.expression);
      const frame = stack[stack.length - 1];
      if (frame !== undefined) frame.yielded = true;
      visit(node.initializer);
      visit(node.statement);
      return;
    }

    if (ts.isIdentifier(node)) {
      check(node);
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);

  // ── The hatch ────────────────────────────────────────────────────────────
  const suppressions: Suppression[] = [];
  const malformed: Offence[] = [];

  for (const range of commentRanges(parsed, source)) {
    const text = source.slice(range.pos, range.end);
    for (const match of text.matchAll(SUPPRESSION)) {
      const line = lineOf(range.pos + (match.index ?? 0));
      const reason = (match[2] ?? '').trim();
      if (match[1] === undefined || reason === '') {
        malformed.push({
          file,
          line,
          found: match[0].trim(),
          rule:
            'a suppression must say WHY, as `// cviper-allow-event-after-yield: <reason>`. ' +
            'A marker with no reason is a silent bypass, which is the failure this guard exists to stop.',
        });
        continue;
      }
      suppressions.push({ line, reason, used: false });
    }
  }

  const surviving = raw.filter((offence) => {
    const hit = suppressions.find((suppression) => coversLine(suppression, offence.line));
    if (hit === undefined) return true;
    hit.used = true;
    return false;
  });

  const unused = suppressions
    .filter((suppression) => !suppression.used)
    .map((suppression): Offence => ({
      file,
      line: suppression.line,
      found: 'cviper-allow-event-after-yield',
      rule:
        'this suppression suppresses nothing. Delete it — a live hatch over clean code is a ' +
        'hole waiting for unrelated code to drift underneath it.',
    }));

  return {
    offences: [...surviving, ...malformed, ...unused].sort((a, b) => a.line - b.line),
    sites,
  };
}

/** Every violation in one source, with line numbers. */
export function findOffences(source: string, file = '(inline).tsx'): Offence[] {
  return analyse(source, file).offences;
}

/** Every event reference the guard adjudicated in one source. */
export function eventSites(source: string, file = '(inline).tsx'): Site[] {
  return analyse(source, file).sites;
}

function describeOffences(offences: readonly Offence[]): string {
  return offences.map((o) => `${o.file}:${o.line}  ${o.found}\n    -> ${o.rule}`).join('\n');
}

/**
 * `.ts` and `.tsx` under a root, minus the things that are not app behaviour.
 *
 * Excluded, and why:
 *   * `*.test.ts` / `*.test.tsx` and `test/` directories — a test is allowed to
 *     write the bug on purpose, which is what the block at the bottom of this
 *     file does. Scanning them would make this guard fail on itself.
 *   * `*.d.ts` — declarations, no code to run.
 *   * `node_modules`, `dist`, `.turbo`, `src-tauri` — not ours or not source.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  '.turbo',
  'src-tauri',
  'test',
  '__tests__',
]);

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      found.push(...sourceFiles(full));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      found.push(full);
    }
  }
  return found.sort();
}

const SCAN_ROOTS = [
  join(ROOT, 'apps', 'light', 'src'),
  ...readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(ROOT, 'packages', entry.name, 'src')),
];

const FILES = SCAN_ROOTS.flatMap(sourceFiles);

const NAME_OF = (file: string): string => relative(ROOT, file).replaceAll('\\', '/');

describe('event contract — no source reads a React event after yielding', () => {
  it('finds the source files', () => {
    // Half of the anti-inert guard: an empty corpus would make every assertion
    // below vacuously true for ever.
    expect(FILES.length).toBeGreaterThan(100);

    const names = FILES.map(NAME_OF);
    // Both files that have shipped this bug, and one from each other project,
    // named so a moved directory or a broken walker fails loudly.
    expect(names).toContain('apps/light/src/features/tracker/NewApplicationForm.tsx');
    expect(names).toContain('apps/light/src/features/boards/BoardSettings.tsx');
    expect(names).toContain('apps/light/src/features/search/Search.tsx');
    expect(names).toContain('apps/light/src/features/tracker/ApplicationDetail.tsx');
    expect(names.some((name) => name.startsWith('packages/'))).toBe(true);
    expect(names.every((name) => !/\.test\.tsx?$/.test(name))).toBe(true);
  });

  it('actually adjudicated the event handlers it cleared', () => {
    // The leg the other two cannot cover. A classifier that quietly stopped
    // recognising event parameters would still find 132 files and would still
    // catch the synthetic violations below (they name their types), while
    // clearing the whole repo by never opening a single handler. Twenty sites
    // were audited by hand and found safe; the guard has to have SEEN them.
    const sites = FILES.flatMap((file) => eventSites(readFileSync(file, 'utf8'), NAME_OF(file)));

    expect(sites.length).toBeGreaterThanOrEqual(20);

    // Including, by name, the files holding the three deliberate near-misses
    // and the two controls that have shipped this bug.
    for (const file of [
      'apps/light/src/features/boards/BoardSettings.tsx',
      'apps/light/src/features/search/Search.tsx',
      'apps/light/src/features/tracker/ApplicationDetail.tsx',
      'apps/light/src/features/tracker/NewApplicationForm.tsx',
    ]) {
      expect(
        sites.filter((site) => site.file === file).length,
        `no event reference examined in ${file}`,
      ).toBeGreaterThan(0);
    }
  });

  it.each(FILES.map((file) => [NAME_OF(file), file]))('%s', (name, file) => {
    const offences = findOffences(readFileSync(file, 'utf8'), name);
    expect(offences, `\n${describeOffences(offences)}\n`).toEqual([]);
  });
});

describe('event contract — the scanner can actually fail', () => {
  // The other half of the anti-inert guard. The first two are the bugs that
  // actually shipped, transcribed. If the detector stops catching either one,
  // this block goes red even though every file in the repo is clean.
  const violations: ReadonlyArray<[string, string]> = [
    [
      'the NewApplicationForm bug: currentTarget inside a lazy setState updater',
      `<select onChange={(event) => {
         setDraft((current) => ({ ...current, status: event.currentTarget.value as ApplicationStatus }));
       }} />`,
    ],
    [
      'the BoardSettings bug: the same shape as a one-line arrow',
      `<select onChange={(event) =>
         setDraft((current) => ({ ...current, encoding: event.currentTarget.value as BoardEncoding }))
       } />`,
    ],
    [
      'target inside a lazy updater',
      `<input onChange={(event) => setV((c) => c + event.target.value)} />;`,
    ],
    [
      'a field read after an await',
      `async function onPick(event: ChangeEvent<HTMLInputElement>) {
         const file = await openFile();
         use(file, event.currentTarget.value);
       }`,
    ],
    [
      'preventDefault after an await',
      `const h = async (event: FormEvent) => { await save(); event.preventDefault(); };`,
    ],
    [
      'a read after an await inside a later sync callback',
      `const h = async (event: FormEvent) => {
         await save();
         rows.forEach((row) => use(row, event.currentTarget));
       };`,
    ],
    [
      'the event captured into setTimeout',
      `<input onChange={(event) => setTimeout(() => save(event), 300)} />;`,
    ],
    [
      'a field read inside setTimeout',
      `<input onChange={(event) => window.setTimeout(() => save(event.currentTarget.value), 300)} />;`,
    ],
    [
      'a field read inside a .then callback',
      `<button onClick={(event) => void load().then(() => use(event.currentTarget))} />;`,
    ],
    [
      'a field read inside queueMicrotask',
      `<button onClick={(event) => queueMicrotask(() => use(event.target))} />;`,
    ],
    [
      'a field read inside requestAnimationFrame',
      `<button onClick={(event) => requestAnimationFrame(() => use(event.currentTarget))} />;`,
    ],
    [
      'a field read inside a debounce callback',
      `<input onChange={(event) => debounced(() => save(event.currentTarget.value))} />;`,
    ],
    [
      'the event captured into a lazy updater without reading a field',
      `<input onChange={(event) => setLast((c) => ({ ...c, event }))} />;`,
    ],
    [
      'a handler typed as an event, deferred, with no marker field anywhere',
      `const h = (thing: KeyboardEvent) => setTimeout(() => use(thing), 0);`,
    ],
  ];

  it.each(violations)('catches %s', (_name, source) => {
    expect(findOffences(source)).not.toEqual([]);
  });

  it('reports the file and the line of the offence', () => {
    const source = [
      'const a = 1;',
      'const h = (event) => setD((c) => ({ ...c, v: event.target.value }));',
    ].join('\n');
    const [offence, ...rest] = findOffences(source, 'Thing.tsx');
    expect(rest).toEqual([]);
    expect(offence?.file).toBe('Thing.tsx');
    expect(offence?.line).toBe(2);
    expect(offence?.found).toBe('event.target');
    expect(offence?.rule).toContain('local `const`');
  });
});

describe('event contract — the three sites that look wrong and are not', () => {
  // Transcribed from the real files. These are the reason the guard is a parse
  // and not a pattern; a scanner that fires on any of them is one somebody
  // deletes the first week, taking the guard for the real bug with it.
  it('BoardSettings: arguments are evaluated before the async call is entered', () => {
    expect(
      findOffences(
        `<input onChange={(event) =>
           void apply(setBoardEnabled(preferences, board.id, event.currentTarget.checked))
         } />;`,
      ),
    ).toEqual([]);
  });

  it('Search: preventDefault first, the await twelve lines later', () => {
    expect(
      findOffences(
        `const onSubmit = useCallback(async (event: FormEvent) => {
           event.preventDefault();
           const found = validateForm(form);
           setErrors(found);
           if (!formIsValid(found)) return;
           setRunning(true);
           const result = await searchPort.search({ providers, input: toSearchInput(form) });
           setOutcome(result);
         }, [form]);
         <form onSubmit={(event) => void onSubmit(event)} />;`,
      ),
    ).toEqual([]);
  });

  it('ApplicationDetail: setDraft takes a string, so only a string crosses', () => {
    expect(
      findOffences(
        `<input onChange={(event) => nextAction.setDraft(event.currentTarget.value)} />;
         <textarea onChange={(event) => notes.setDraft(event.currentTarget.value)} />;`,
      ),
    ).toEqual([]);
  });
});

describe('event contract — the correct patterns are never flagged', () => {
  it('reads the value into a local const, then uses the local in the updater', () => {
    // The fix that was applied to both real bugs. If this ever goes red the
    // guard is telling people to undo it.
    expect(
      findOffences(
        `<select onChange={(event) => {
           const status = event.currentTarget.value as ApplicationStatus;
           setDraft((current) => ({ ...current, status }));
         }} />;`,
      ),
    ).toEqual([]);
  });

  it('reads the value into a local const before the first await', () => {
    expect(
      findOffences(
        `const h = async (event: FormEvent) => {
           const value = event.currentTarget.value;
           await save(value);
           report(value);
         };`,
      ),
    ).toEqual([]);
  });

  it('passes the field straight into a call', () => {
    expect(
      findOffences(`<input onChange={(event) => onChange(event.currentTarget.value)} />;`),
    ).toEqual([]);
  });

  it('reads the event inside a synchronous array callback', () => {
    // Analysis.tsx does exactly this. `.find` is not a deferral.
    expect(
      findOffences(
        `<select onChange={(event) => {
           const job = jobs.find((candidate) => candidate.id === event.currentTarget.value);
           if (job !== undefined) setJobText(jobAdvertText(job));
         }} />;`,
      ),
    ).toEqual([]);
  });

  it('evaluates the event as an argument to an awaited call', () => {
    // The argument is evaluated before the suspension, so this read is clean.
    expect(
      findOffences(
        `const h = async (event: FormEvent) => { await save(event.currentTarget.value); };`,
      ),
    ).toEqual([]);
  });

  it('awaits inside a nested async callback without yielding the outer frame', () => {
    expect(
      findOffences(
        `const h = async (event: FormEvent) => {
           items.forEach(async (item) => { await save(item); });
           use(event.currentTarget.value);
         };`,
      ),
    ).toEqual([]);
  });

  it('leaves a same-named property of something else alone', () => {
    expect(
      findOffences(`const h = (event: FormEvent) => log(analytics.event, event.type);`),
    ).toEqual([]);
  });

  it('does not invent an event out of an ordinary callback parameter', () => {
    // KeySetup's shape: a local `next`, then a lazy updater that uses it.
    expect(
      findOffences(
        `<input onChange={(event) => {
           const next = event.currentTarget.value;
           setValues((current) => ({ ...current, [field.key]: next }));
           setErrors((current) => ({ ...current, [field.key]: undefined }));
         }} />;
         void port.status(id).then((next) => setState(next));`,
      ),
    ).toEqual([]);
  });

  it('boundary: an empty file and a comment-only file are clean', () => {
    expect(findOffences('')).toEqual([]);
    expect(findOffences('// event.currentTarget inside setTimeout, described in prose\n')).toEqual(
      [],
    );
  });
});

describe('event contract — the escape hatch must carry a reason', () => {
  const OFFENDING = `<select onChange={(event) =>
      setDraft((current) => ({ ...current, status: event.currentTarget.value }))
    } />;`;

  it('a suppression with a reason clears the offence', () => {
    const source = `<select onChange={(event) =>
      // cviper-allow-event-after-yield: the updater is called synchronously by a test double
      setDraft((current) => ({ ...current, status: event.currentTarget.value }))
    } />;`;
    expect(findOffences(source)).toEqual([]);
  });

  it('a suppression on the same line as the offence clears it', () => {
    const source = `const h = (event) => setD((c) => ({ ...c, v: event.target.value })); // cviper-allow-event-after-yield: proven safe by the caller`;
    expect(findOffences(source)).toEqual([]);
  });

  it('negative: a marker with no colon and no reason FAILS', () => {
    const source = `<select onChange={(event) =>
      // cviper-allow-event-after-yield
      setDraft((current) => ({ ...current, status: event.currentTarget.value }))
    } />;`;
    const offences = findOffences(source);
    expect(offences.map((o) => o.rule).join('\n')).toContain('must say WHY');
    // And it did NOT silence the real offence either.
    expect(offences.some((o) => o.found === 'event.currentTarget')).toBe(true);
  });

  it('negative: a colon with an empty reason FAILS', () => {
    const source = `<select onChange={(event) =>
      // cviper-allow-event-after-yield:
      setDraft((current) => ({ ...current, status: event.currentTarget.value }))
    } />;`;
    expect(
      findOffences(source)
        .map((o) => o.rule)
        .join('\n'),
    ).toContain('must say WHY');
  });

  it('boundary: a colon with only whitespace FAILS', () => {
    const source = `<select onChange={(event) =>
      // cviper-allow-event-after-yield:  \t
      setDraft((current) => ({ ...current, status: event.currentTarget.value }))
    } />;`;
    expect(
      findOffences(source)
        .map((o) => o.rule)
        .join('\n'),
    ).toContain('must say WHY');
  });

  it('negative: the marker inside a string literal does NOT open the hatch', () => {
    const source = `const note = "cviper-allow-event-after-yield: not a comment";
    ${OFFENDING}`;
    expect(findOffences(source).some((o) => o.found === 'event.currentTarget')).toBe(true);
  });

  it('negative: a suppression that suppresses nothing FAILS', () => {
    const source = `// cviper-allow-event-after-yield: nothing here needs it
    const h = (event: FormEvent) => event.preventDefault();`;
    expect(
      findOffences(source)
        .map((o) => o.rule)
        .join('\n'),
    ).toContain('suppresses nothing');
  });

  it('boundary: a suppression two lines above the offence does NOT reach it', () => {
    const source = `<select onChange={(event) =>
      // cviper-allow-event-after-yield: too far away to count
      // a second comment line pushes the offence out of reach
      setDraft((current) => ({ ...current, status: event.currentTarget.value }))
    } />;`;
    expect(findOffences(source).some((o) => o.found === 'event.currentTarget')).toBe(true);
  });

  it('a suppression in a block comment works, and still needs a reason', () => {
    const withReason = `<select onChange={(event) =>
      /* cviper-allow-event-after-yield: the double calls this inline */
      setDraft((current) => ({ ...current, status: event.currentTarget.value }))
    } />;`;
    expect(findOffences(withReason)).toEqual([]);

    const without = `<select onChange={(event) =>
      /* cviper-allow-event-after-yield */
      setDraft((current) => ({ ...current, status: event.currentTarget.value }))
    } />;`;
    expect(
      findOffences(without)
        .map((o) => o.rule)
        .join('\n'),
    ).toContain('must say WHY');
  });
});
