/**
 * The privacy-promise contract: no screen and no page makes an ABSOLUTE claim
 * that all activity stays on the machine.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * "Fetch from link" makes a real outbound request to a site the app has never
 * spoken to before. The moment that shipped, one sentence in this product
 * stopped being true.
 *
 * `README.md` was corrected in `34c4900` — "Everything stays on your machine"
 * became "**Your data** stays on your machine", which is the promise that was
 * actually being made and is still exactly right. `Welcome.tsx` carries the
 * same sentence, is the FIRST thing a new user reads, and kept the old absolute
 * claim for two more commits. It was found by a human reading the screen.
 *
 * Nothing stopped that, and nothing stops the next one. This repo already
 * reduces its loudest claim to something a machine checks —
 * `features/settings/telemetry.contract.test.ts` proves "we collect nothing" by
 * proving no branch anywhere reads the flag. The privacy sentence a new user
 * reads first had no equivalent. This is it.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * The check encodes "Y must be absent", never "X must be present". A guard that
 * asserted `Welcome.tsx` CONTAINS "Your data stays on this computer" would go
 * green on the day somebody rewrote the paragraph into something worse, and
 * would go red on the day somebody improved it. It would rot within a release.
 *
 * So what is forbidden is a SHAPE OF CLAIM, not a wording:
 *
 *   * everything / all of it       stays|remains|lives   on|in <this machine>
 *   * everything / all of it       stays|remains|lives   local
 *   * nothing                      leaves                <this machine>
 *   * no data|files|information    leaves                <this machine>
 *   * nothing                      is sent|goes off      <this machine>
 *
 * Any rewording that still means "all of it stays here" still trips it. Any
 * rewording that scopes the promise to the user's DATA — which is the true
 * claim — walks straight through.
 *
 * ============================================================================
 * THE HARD HALF: MOST OF THIS COPY IS STILL TRUE
 * ============================================================================
 * A scanner that fires on honest copy is deleted inside six months and takes
 * the guard for the real bug with it. Every sentence below is in the corpus
 * right now, is accurate, and MUST walk through untouched:
 *
 *   * `"Nothing is sent to us."` (README, the Fetch section) — true. There is
 *     no server belonging to us; the page comes from the site to the user. The
 *     rules require a LOCAL PLACE — "your machine", "this computer" — after the
 *     verb, and "us" is not one.
 *
 *   * `"CViper adds nothing to the link."` — true; `packages/job-apis`
 *     `normalise.ts` strips tracking parameters and adds none. No locality
 *     claim in the sentence at all.
 *
 *   * `"Exactly one page … no other page is loaded"` — true; `fetch_page.rs`
 *     does not follow links and does not load subresources. Same reason.
 *
 *   * `"Nothing you check leaves your PC."` (README, the Ollama section) —
 *     true, and NARROWED by a restrictive relative clause. "Nothing you check"
 *     is not "nothing". The rules deliberately allow no gap between the
 *     quantifier and the verb, so a clause that narrows the subject also
 *     narrows the claim, and a narrowed claim is precisely what the correction
 *     asked for.
 *
 *   * `"Nothing leaves this machine until you press it, and what leaves is a
 *     request for a version number."` (`settings/updates/model.ts`) — true, and
 *     it states its own exception in the same breath. Every rule carries a
 *     negative lookahead for `until|unless|except|other than|apart from|
 *     besides|save for`: an absolute claim with a stated exception is not an
 *     absolute claim.
 *
 * The cost of that precision is a known limitation, stated rather than hidden:
 * an absolute claim with a filler clause wedged in the middle — "Everything you
 * do stays on your machine" — is not caught, because the same gap that would
 * catch it would also catch "Nothing you check leaves your PC", which is true.
 * Given a choice between missing a paraphrase nobody has written and firing on
 * a sentence somebody did, the guard misses the paraphrase.
 *
 * ============================================================================
 * WHAT COUNTS AS COPY
 * ============================================================================
 * Only what a user can read. For `.ts`/`.tsx` that is JSX text and string
 * literals, gathered off the parse tree, so COMMENTS ARE EXCLUDED BY
 * CONSTRUCTION — which matters, because `tracker/runFetch.ts` and
 * `tracker/PasteJobForm.tsx` both quote the old absolute claim in their
 * docblocks in order to explain why the fetch is dangerous, and a guard that
 * failed on the very comments warning about the bug would be deleted on sight.
 *
 * Concatenation is joined before matching (`'…nothing leaves ' + 'your PC'` is
 * one claim, not two), because that is how this codebase actually writes long
 * copy. JSX children are joined for the same reason. `className`, `data-*` and
 * friends are not prose and are skipped.
 *
 * `README.md` is scanned as prose blocks, with fenced code and HTML comments
 * blanked out in place so offsets — and therefore reported line numbers — stay
 * exact.
 *
 * `docs/` is NOT scanned. `docs/FEATURE-MATRIX.md` quotes "Everything stays on
 * your machine" verbatim in order to record that it was corrected; scanning it
 * would make the guard fail on the write-up of the fix it exists to prevent.
 *
 * ============================================================================
 * THE ESCAPE HATCH, AND WHY IT IS ITSELF GUARDED
 * ============================================================================
 * Following `lib/events.contract.test.ts`:
 *
 *     // cviper-allow-absolute-privacy-claim: <why this one is true>
 *     <!-- cviper-allow-absolute-privacy-claim: <why this one is true> -->
 *
 * It attaches to the next piece of copy that starts at or after its own line.
 * The reason is MANDATORY — a bare marker, or a colon with nothing after it, is
 * itself a failure. A hatch that opens without saying why is not a hatch, it is
 * a hole, and a silent bypass is the single most repeated way a guard in this
 * repo has gone quietly inert. A STALE suppression fails too: one sitting over
 * copy that no longer trips a rule is a hole waiting for unrelated copy to
 * drift underneath it. And the marker only works inside a COMMENT — one in a
 * string literal must not open the hatch, or the hatch has a second key.
 *
 * Two suppressions exist, both on sentences that are true and are scoped by
 * something no regular expression can see:
 *
 *   * `analysis/providers.ts` — the Ollama option's note. Judged accurate: it
 *     is a per-option label in a list whose whole grammar is "where does your
 *     CV go with this choice", sitting two lines from "Your CV and the advert
 *     are sent to Anthropic". Ollama's base URL is a `&'static str` pinned to
 *     `http://127.0.0.1:11434` in `src-tauri/src/providers.rs`, never built
 *     from anything JavaScript sends, with a Rust test holding it there.
 *   * `analysis/Analysis.tsx` — the empty state, whose own subject is "The
 *     basic match".
 *
 * ============================================================================
 * WHY THIS CANNOT GO QUIETLY INERT
 * ============================================================================
 * `the scanner can actually fail` feeds it both real regressions verbatim and
 * asserts each is caught. But that only proves the detector works ON THE
 * STRINGS THE TEST HANDS IT. The event guard was found green with 132 passing
 * per-file assertions while every component in the repo went unread, because
 * the corpus had quietly become empty.
 *
 * So `opened a real corpus` asserts a floor on three separate numbers — files
 * opened, pieces of copy extracted, and CANDIDATES, meaning sentences that talk
 * about this subject at all — and asserts candidates were found BY NAME in the
 * files whose copy this guard is for. Break the `.tsx` parse and `Welcome.tsx`
 * yields no candidates and this goes red, whatever the per-file assertions say.
 *
 * This file is a test file, and test files are not scanned, so the bad examples
 * written out below cannot trip it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** The repo root — this file lives in `apps/light/src/lib/`. */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * Stands in for a hole in the copy: a `${…}` substitution, a non-literal
 * operand of a `+`, a blanked-out code fence. Deliberately not a space, so a
 * claim can never be assembled ACROSS a hole that a user would never see as one
 * sentence. U+FFFC (OBJECT REPLACEMENT CHARACTER) is exactly this concept, and
 * unlike NUL it is not a control character, which `no-control-regex` forbids in
 * a pattern.
 */
const HOLE = '￼';

/** "your machine", "this computer", "your own PC", "my laptop". */
const PLACE = String.raw`(?:your|this|my|the)(?:\s+own)?\s+(?:machine|computer|pc|laptop|desktop|device|disk|hard\s+drive)\b`;

/** Subjects that mean "the whole lot", with nothing narrowing them. */
const UNIVERSAL = String.raw`(?:everything|every\s+single\s+thing|all\s+of\s+it|it\s+all)`;

/** Adverbs strengthen a claim; they never narrow it, so they are allowed through. */
const ADVERBS = String.raw`(?:\s+(?:ever|always|at\s+all|even|still))*`;

const STAYS = String.raw`(?:stays?|remains?|lives?|sits?|is\s+kept|are\s+kept|is\s+stored|are\s+stored)`;

const LEAVES = String.raw`(?:leaves?|escapes?)`;

const EXITS = String.raw`(?:sent|uploaded|transmitted|shared|copied|goes|go)`;

/**
 * A stated exception is what turns an absolute claim into an honest one.
 *
 * "Nothing leaves this machine UNTIL you press it" is the most truthful
 * sentence in the app and must not be touched. This is a lookahead rather than
 * an allow-list of blessed sentences on purpose: it recognises the SHAPE of a
 * qualified claim, so it keeps working when the sentence is rewritten.
 */
const EXCEPTION = String.raw`(?!\s*[,;]?\s+(?:until|unless|except|other\s+than|apart\s+from|besides|save\s+for))`;

interface Rule {
  readonly id: string;
  readonly pattern: string;
  readonly why: string;
}

/**
 * Every forbidden shape.
 *
 * Considered and REJECTED as too broad, recorded so nobody re-litigates them:
 *
 *   * `nothing (is being) sent anywhere` — `Analysis.tsx` says exactly this in
 *     the progress line shown WHILE a local model is running. Present
 *     continuous about the operation in front of you is not a standing promise,
 *     and the rule would fire on the truest sentence on the screen.
 *   * `nothing touches the network` / `no requests are made` — no instance
 *     anywhere in the corpus. A rule with nothing to catch is a rule that only
 *     ever produces false positives.
 *   * bare `all …` as a universal — "all of your data stays on your machine" is
 *     the CORRECTED wording. Forbidding `all` would forbid the fix.
 *   * `works offline` / `runs locally` — per-feature statements of fact, true
 *     of the tracker and the keyword match, and not claims about the whole app.
 */
const RULES: readonly Rule[] = [
  {
    id: 'everything-stays-here',
    pattern: String.raw`\b${UNIVERSAL}${ADVERBS}\s+${STAYS}\s+(?:(?:on|in|inside|within)\s+${PLACE}|local(?:ly)?\b)${EXCEPTION}`,
    why:
      'an absolute claim that ALL of it stays on the machine. "Fetch from link" makes a real ' +
      'outbound request, so this is no longer true. Scope it to what is actually promised — ' +
      '"Your data stays on this computer" — and say what a fetch does next to the Fetch button.',
  },
  {
    id: 'nothing-leaves-here',
    pattern: String.raw`\bnothing${ADVERBS}\s+${LEAVES}\s+(?:from\s+)?${PLACE}${EXCEPTION}`,
    why:
      'an absolute claim that NOTHING leaves the machine. A job search, a cloud CV analysis, an ' +
      'update check and a link fetch all leave it. Narrow the subject ("your CV", "your data"), ' +
      'state the exception ("until you press it"), or suppress it with a reason if the ' +
      'surrounding sentence already scopes it.',
  },
  {
    id: 'no-data-leaves-here',
    pattern: String.raw`\bno\s+(?:data|information|files?|documents?|content|personal\s+data)${ADVERBS}\s+${LEAVES}\s+(?:from\s+)?${PLACE}${EXCEPTION}`,
    why:
      'an absolute claim that no data of any kind leaves the machine. The user’s CV goes to ' +
      'Anthropic or OpenAI if they pick one, and a fetched advert comes back from the open web.',
  },
  {
    id: 'nothing-sent-off-here',
    pattern: String.raw`\bnothing(?:\s+(?:ever|is|are|gets|at\s+all|even))*\s+${EXITS}\s+(?:off|outside|beyond|away\s+from)\s+(?:of\s+)?${PLACE}${EXCEPTION}`,
    why:
      'the same absolute claim in different words. "Nothing is sent off your machine" is not ' +
      'true of an app with a Fetch button, a job search and a cloud analysis option.',
  },
];

/**
 * A sentence that talks about this subject at all, true or false.
 *
 * Not a rule — nothing fails for matching it. It is the third leg of the
 * anti-inert check: proof that the extractor actually reached the copy that
 * matters, rather than returning an empty corpus and passing everything.
 */
const CANDIDATE =
  /\b(?:everything|nothing|no\s+data)\b|\b(?:stays?|leaves?|remains?|kept|lives?)\s+(?:on|in|from)?\s*(?:your|this|my|the)(?:\s+own)?\s+(?:machine|computer|pc|laptop|device|disk)\b/i;

/** The hatch. The `(:…)` group is optional ON PURPOSE — a bare marker must fail. */
const SUPPRESSION = /cviper-allow-absolute-privacy-claim(:([^\n]*))?/g;

/** JSX attributes that are never prose. A forbid-list, so a new attribute is copy by default. */
const NOT_PROSE = /^(?:className|class|style|id|key|role|type|href|src|htmlFor|xmlns|d)$|^data-/;

export interface Offence {
  readonly file: string;
  readonly line: number;
  readonly found: string;
  readonly rule: string;
}

/** One piece of copy the guard actually read and adjudicated. */
export interface Candidate {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** A run of user-visible text, with every character mapped back to the source. */
interface Unit {
  readonly text: string;
  /** `offsets[i]` is the source offset of `text[i]`. */
  readonly offsets: readonly number[];
  readonly start: number;
}

interface Piece {
  readonly text: string;
  readonly pos: number;
  /** True when `text` is byte-identical to the source at `pos`, so offsets can be exact. */
  readonly exact: boolean;
}

interface Suppression {
  readonly line: number;
  readonly reason: string | null;
  used: boolean;
}

function unitFrom(pieces: readonly Piece[]): Unit | null {
  if (pieces.length === 0) return null;
  let text = '';
  const offsets: number[] = [];
  for (const piece of pieces) {
    for (let index = 0; index < piece.text.length; index += 1) {
      // A string literal's cooked text can be shorter than its source (escapes),
      // so only genuinely verbatim pieces get per-character offsets. Everything
      // else reports the position the piece starts at, which is never wrong.
      offsets.push(piece.exact ? piece.pos + index : piece.pos);
    }
    text += piece.text;
  }
  const start = pieces[0]?.pos ?? 0;
  return { text, offsets, start };
}

// ── TypeScript and TSX ──────────────────────────────────────────────────────

function scriptKind(file: string): ts.ScriptKind {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** A module specifier is a path, not copy. */
function isModuleSpecifier(node: ts.Node): boolean {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return false;
  return (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isImportTypeNode(parent) ||
    ts.isExternalModuleReference(parent)
  );
}

function isSkippedAttribute(node: ts.Node): boolean {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return false;
  const attribute = ts.isJsxExpression(parent) ? parent.parent : parent;
  if (attribute === undefined || !ts.isJsxAttribute(attribute)) return false;
  return NOT_PROSE.test(attribute.name.getText());
}

function isStringish(node: ts.Node): boolean {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (ts.isTemplateExpression(node)) return true;
  if (ts.isParenthesizedExpression(node)) return isStringish(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return isStringish(node.left) || isStringish(node.right);
  }
  return false;
}

/**
 * Every comment in the file, wherever it sits.
 *
 * `getChildren()` rather than `forEachChild()` because it yields TOKENS as well
 * as nodes. A JSX comment — `{/* … *\/}` — is trivia on the closing brace of an
 * otherwise empty expression container, which `forEachChild` never reaches. A
 * hatch that silently did not work inside JSX would be no hatch at all on the
 * screens this guard is mostly for.
 */
function commentRanges(parsed: ts.SourceFile, text: string): ts.CommentRange[] {
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
    for (const child of node.getChildren(parsed)) visit(child);
  };

  visit(parsed);
  return ranges;
}

function typescriptUnits(source: string, file: string): { units: Unit[]; comments: string[][] } {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const units: Unit[] = [];

  const collect = (node: ts.Node, pieces: Piece[], rest: ts.Node[]): void => {
    if (ts.isParenthesizedExpression(node)) {
      collect(node.expression, pieces, rest);
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      pieces.push({ text: node.text, pos: node.getStart(parsed), exact: false });
      return;
    }
    if (ts.isTemplateExpression(node)) {
      pieces.push({ text: node.head.text, pos: node.head.getStart(parsed), exact: false });
      for (const span of node.templateSpans) {
        pieces.push({
          text: HOLE + span.literal.text,
          pos: span.literal.getStart(parsed),
          exact: false,
        });
        rest.push(span.expression);
      }
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      collect(node.left, pieces, rest);
      collect(node.right, pieces, rest);
      return;
    }
    pieces.push({ text: HOLE, pos: node.getStart(parsed), exact: false });
    rest.push(node);
  };

  const emit = (pieces: readonly Piece[]): void => {
    const unit = unitFrom(pieces);
    // Whitespace and holes are not copy. Dropping these matters for more than
    // tidiness: a JSX element whose children are all other elements produces a
    // unit of nothing but indentation, and a suppression above it would attach
    // to THAT rather than to the paragraph underneath, then fail as stale.
    if (unit !== null && unit.text.replace(/[\s￼]+/g, '').length > 0) units.push(unit);
  };

  const visit = (node: ts.Node): void => {
    // JSX children first: text and interpolated strings become ONE unit, so a
    // sentence broken across `{' '}` is still one sentence.
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const pieces: Piece[] = [];
      const rest: ts.Node[] = [];
      for (const child of node.children) {
        if (ts.isJsxText(child)) {
          // `pos`, not `getStart()`. Leading whitespace in JSX IS the text, and
          // `getStart()` skips trivia — which would slide the piece's offset
          // forward onto the next tag and report the wrong line.
          pieces.push({ text: source.slice(child.pos, child.end), pos: child.pos, exact: true });
          continue;
        }
        if (
          ts.isJsxExpression(child) &&
          child.expression !== undefined &&
          isStringish(child.expression)
        ) {
          collect(child.expression, pieces, rest);
          continue;
        }
        pieces.push({ text: HOLE, pos: child.getStart(parsed), exact: false });
        rest.push(child);
      }
      emit(pieces);
      if (ts.isJsxElement(node)) visit(node.openingElement);
      for (const child of rest) visit(child);
      return;
    }

    if (isStringish(node) && !isModuleSpecifier(node) && !isSkippedAttribute(node)) {
      const pieces: Piece[] = [];
      const rest: ts.Node[] = [];
      collect(node, pieces, rest);
      emit(pieces);
      for (const child of rest) visit(child);
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);

  const comments = commentRanges(parsed, source).map((range) => [
    String(parsed.getLineAndCharacterOfPosition(range.pos).line + 1),
    source.slice(range.pos, range.end),
  ]);

  units.sort((left, right) => left.start - right.start);
  return { units, comments };
}

// ── Markdown ────────────────────────────────────────────────────────────────

/** Replace every non-newline character in `[from, to)` with `HOLE`, keeping length. */
function blank(text: string, from: number, to: number): string {
  const replaced = text.slice(from, to).replace(/[^\n]/g, HOLE);
  return text.slice(0, from) + replaced + text.slice(to);
}

/**
 * Prose blocks, with everything that is not prose blanked in place.
 *
 * Blanking rather than deleting keeps every offset identical to the original
 * file, so a reported line number is the line a person opens.
 */
function markdownUnits(source: string): { units: Unit[]; comments: string[][] } {
  let text = source;

  // HTML comments — where the hatch lives, and therefore the one thing that
  // must never be read as copy: a suppression's REASON would otherwise be
  // scanned for the very claim it is excusing.
  const comments: string[][] = [];
  for (const match of source.matchAll(/<!--[\s\S]*?-->/g)) {
    const from = match.index;
    const line = source.slice(0, from).split('\n').length;
    comments.push([String(line), match[0]]);
    text = blank(text, from, from + match[0].length);
  }

  // Fenced code. Commands, not promises.
  for (const match of source.matchAll(/^```[\s\S]*?^```/gm)) {
    text = blank(text, match.index, match.index + match[0].length);
  }

  // Emphasis and inline-code markers, replaced by spaces so `**Everything**
  // stays…` reads as words rather than as one long token. Same length, so
  // offsets survive.
  text = text.replace(/[*_`~]/g, ' ');

  const units: Unit[] = [];
  const lines = text.split('\n');
  let offset = 0;
  let blockFrom: number | null = null;
  let blockTo = 0;

  const flush = (): void => {
    if (blockFrom === null) return;
    // Copied out of the mutable binding: the narrowing to `number` does not
    // survive into the closure below, and TypeScript is right to say so.
    const from = blockFrom;
    const slice = text.slice(from, blockTo);
    const offsets = Array.from({ length: slice.length }, (_unused, index) => from + index);
    units.push({ text: slice, offsets, start: from });
    blockFrom = null;
  };

  for (const line of lines) {
    const isBlank = /^[\s￼]*$/.test(line);
    if (isBlank) flush();
    else {
      if (blockFrom === null) blockFrom = offset;
      blockTo = offset + line.length;
    }
    offset += line.length + 1;
  }
  flush();

  return { units, comments };
}

// ── The scan ────────────────────────────────────────────────────────────────

function lineCounter(source: string): (offset: number) => number {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return (offset: number): number => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((starts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

function tidy(found: string): string {
  return found.replace(/\s+/g, ' ').trim();
}

export interface Scan {
  readonly offences: Offence[];
  readonly candidates: Candidate[];
  readonly units: number;
}

/**
 * Everything this guard has to say about one file.
 *
 * Exported through `findClaims` and `copyCandidates` so the self-proof blocks
 * below can hand it strings — including both real regressions — and prove the
 * detector still bites, and still looks.
 */
export function scan(source: string, file: string): Scan {
  const markdown = file.endsWith('.md');
  const { units, comments } = markdown ? markdownUnits(source) : typescriptUnits(source, file);
  const lineOf = lineCounter(source);

  const suppressions: Suppression[] = [];
  const malformed: Offence[] = [];

  for (const [rawLine, body] of comments) {
    for (const match of (body ?? '').matchAll(SUPPRESSION)) {
      const line =
        Number(rawLine ?? '1') + (body ?? '').slice(0, match.index).split('\n').length - 1;
      // The comment's own terminator is not a reason. Without this,
      // `<!-- cviper-allow-absolute-privacy-claim: -->` reads as the reason
      // "--" and opens the hatch on nothing at all — the exact silent bypass
      // the mandatory reason exists to stop.
      const reason = (match[2] ?? '').replace(/(?:\*\/|-->)\s*$/, '').trim();
      if (match[1] === undefined || reason === '') {
        malformed.push({
          file,
          line,
          found: tidy(match[0]),
          rule:
            'a suppression must say WHY, as `cviper-allow-absolute-privacy-claim: <reason>`. A ' +
            'marker with no reason is a silent bypass, which is the failure this guard exists to stop.',
        });
        continue;
      }
      suppressions.push({ line, reason, used: false });
    }
  }

  const candidates: Candidate[] = [];
  const raw: Array<{ unit: Unit; offence: Offence }> = [];

  for (const unit of units) {
    if (CANDIDATE.test(unit.text)) {
      candidates.push({ file, line: lineOf(unit.start), text: tidy(unit.text).slice(0, 160) });
    }
    for (const rule of RULES) {
      for (const match of unit.text.matchAll(new RegExp(rule.pattern, 'gi'))) {
        const at = unit.offsets[match.index] ?? unit.start;
        raw.push({
          unit,
          offence: {
            file,
            line: lineOf(at),
            found: tidy(match[0]),
            rule: `${rule.id}: ${rule.why}`,
          },
        });
      }
    }
  }

  // A suppression covers the first piece of copy starting at or after its own
  // line. Reach is unbounded on purpose and is safe because it only ever
  // reaches ONE unit: park it in the wrong place and it covers clean copy,
  // which fails as stale, while the real offence survives and fails too.
  const covered = new Map<Unit, Suppression>();
  for (const suppression of suppressions) {
    const target = units.find((unit) => lineOf(unit.start) >= suppression.line);
    if (target === undefined || covered.has(target)) continue;
    covered.set(target, suppression);
  }

  const surviving = raw
    .filter(({ unit }) => {
      const hit = covered.get(unit);
      if (hit === undefined) return true;
      hit.used = true;
      return false;
    })
    .map(({ offence }) => offence);

  const stale = suppressions
    .filter((suppression) => !suppression.used)
    .map((suppression): Offence => ({
      file,
      line: suppression.line,
      found: 'cviper-allow-absolute-privacy-claim',
      rule:
        'this suppression suppresses nothing. Delete it — a live hatch over copy that no ' +
        'longer makes an absolute claim is a hole waiting for other copy to drift underneath it.',
    }));

  return {
    offences: [...surviving, ...malformed, ...stale].sort((left, right) => left.line - right.line),
    candidates,
    units: units.length,
  };
}

/** Every forbidden claim in one source. */
export function findClaims(source: string, file = '(inline).tsx'): Offence[] {
  return scan(source, file).offences;
}

/** Every piece of copy about this subject that the guard adjudicated. */
export function copyCandidates(source: string, file = '(inline).tsx'): Candidate[] {
  return scan(source, file).candidates;
}

function explain(offences: readonly Offence[]): string {
  return offences.map((o) => `${o.file}:${o.line}  "${o.found}"\n    -> ${o.rule}`).join('\n');
}

// ── The corpus ──────────────────────────────────────────────────────────────

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

const NAME_OF = (file: string): string => relative(ROOT, file).replaceAll('\\', '/');

/** Every file a user's eyes can reach: the app's own copy, plus the front page of the repo. */
const FILES = [...sourceFiles(join(ROOT, 'apps', 'light', 'src')), join(ROOT, 'README.md')];

const SCANNED = FILES.map((file) => ({
  name: NAME_OF(file),
  result: scan(readFileSync(file, 'utf8'), NAME_OF(file)),
}));

describe('privacy promise — no copy claims that everything stays on the machine', () => {
  it('opened a real corpus, and read the copy in the files this guard is for', () => {
    // Leg one: files. A broken walk or a moved directory fails here.
    expect(FILES.length).toBeGreaterThan(70);
    const names = SCANNED.map((entry) => entry.name);
    expect(names).toContain('apps/light/src/features/onboarding/Welcome.tsx');
    expect(names).toContain('README.md');
    expect(names.every((name) => !/\.test\.tsx?$/.test(name))).toBe(true);

    // Leg two: copy. An extractor that returned nothing would clear the repo.
    const units = SCANNED.reduce((total, entry) => total + entry.result.units, 0);
    expect(units).toBeGreaterThan(800);

    // Leg three, the one the other two cannot cover: sentences ABOUT THIS
    // SUBJECT, found by name in the files whose copy this guard exists for.
    // Break the TSX parse and Welcome.tsx yields nothing here while every
    // per-file assertion below stays green.
    const candidates = SCANNED.flatMap((entry) => entry.result.candidates);
    expect(candidates.length).toBeGreaterThanOrEqual(30);

    for (const file of [
      'apps/light/src/features/onboarding/Welcome.tsx',
      'apps/light/src/features/analysis/Analysis.tsx',
      'apps/light/src/features/analysis/providers.ts',
      'apps/light/src/features/settings/updates/model.ts',
      'README.md',
    ]) {
      expect(
        candidates.filter((candidate) => candidate.file === file).length,
        `no copy about this subject was read in ${file}`,
      ).toBeGreaterThan(0);
    }
  });

  it.each(SCANNED.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    expect(entry.result.offences, `\n${explain(entry.result.offences)}\n`).toEqual([]);
  });
});

describe('privacy promise — the scanner can actually fail', () => {
  const regressions: ReadonlyArray<readonly [string, string, string]> = [
    [
      'the Welcome.tsx regression, transcribed',
      'Welcome.tsx',
      `<p className="mt-1 max-w-2xl text-ink-muted">
         Everything stays on this computer. There is no account and nothing to sign up for. Two of
         these work better with a free key, and the page says which — you can start without one.
       </p>`,
    ],
    [
      'the README.md regression, transcribed',
      'README.md',
      `## Your privacy, in plain words\n\n**Everything stays on your machine. No accounts. We collect nothing.**\n`,
    ],
    ['everything stays on your machine', 'a.tsx', `<p>Everything stays on your machine.</p>`],
    ['everything stays local', 'a.tsx', `<p>Everything stays local.</p>`],
    [
      'everything always remains on this PC',
      'a.tsx',
      `<p>Everything always remains on this PC.</p>`,
    ],
    [
      'all of it lives on your own computer',
      'a.tsx',
      `<p>All of it lives on your own computer.</p>`,
    ],
    ['nothing leaves your machine', 'a.tsx', `<p>Nothing leaves your machine.</p>`],
    [
      'nothing ever leaves this computer',
      'a.ts',
      `export const NOTE = 'Nothing ever leaves this computer.';`,
    ],
    ['no data leaves your PC', 'a.ts', `export const NOTE = 'No data leaves your PC.';`],
    [
      'no files ever leave this machine',
      'a.ts',
      `export const NOTE = 'No files ever leave this machine.';`,
    ],
    [
      'nothing is sent off your machine',
      'a.ts',
      `export const NOTE = 'Nothing is sent off your machine.';`,
    ],
    ['nothing goes beyond this computer', 'a.md', `Nothing goes beyond this computer.\n`],
    [
      'the claim split across a concatenation',
      'a.ts',
      `export const NOTE = 'Everything stays ' + 'on your machine, always.';`,
    ],
    [
      'the claim split across JSX children',
      'a.tsx',
      `<p>Everything stays on {'your machine'}. Truly.</p>`,
    ],
    [
      'the claim inside a template literal',
      'a.ts',
      'export const NOTE = `Hello ${name}, nothing leaves your PC.`;',
    ],
    [
      'the claim in a markdown bullet',
      'a.md',
      `- **Everything stays on your machine.** Promise.\n`,
    ],
  ];

  it.each(regressions)('catches %s', (_name, file, source) => {
    expect(findClaims(source, file)).not.toEqual([]);
  });

  it('reports the file and the line of the claim', () => {
    const source = ['<p>', '  Fine.', '  Everything stays on your machine.', '</p>'].join('\n');
    const [offence, ...rest] = findClaims(source, 'Thing.tsx');
    expect(rest).toEqual([]);
    expect(offence?.file).toBe('Thing.tsx');
    expect(offence?.line).toBe(3);
    expect(offence?.found).toBe('Everything stays on your machine');
    expect(offence?.rule).toContain('everything-stays-here');
  });

  it('reports the line of the claim inside a wrapped markdown paragraph', () => {
    const source = [
      'A first line of prose',
      'that wraps, and then says',
      'nothing leaves your PC.',
    ].join('\n');
    expect(findClaims(source, 'a.md')[0]?.line).toBe(3);
  });
});

describe('privacy promise — the copy that is still true walks through', () => {
  // Every one of these is in the corpus right now. A scanner that fired on any
  // of them is one somebody deletes in a week, taking the guard with it.
  const honest: ReadonlyArray<readonly [string, string, string]> = [
    ['the corrected Welcome sentence', 'a.tsx', `<p>Your data stays on this computer.</p>`],
    [
      'the corrected README headline',
      'a.md',
      `**Your data stays on your machine. No accounts.**\n`,
    ],
    ['nothing is sent to us', 'a.md', `- **Nothing is sent to us.** There is no server of ours.\n`],
    [
      'CViper adds nothing to the link',
      'a.ts',
      `export const N = 'CViper adds nothing to the link.';`,
    ],
    ['no other page is loaded', 'a.md', `Exactly one page. No other page is loaded.\n`],
    [
      'a restrictive clause narrows the subject',
      'a.md',
      `CViper Light finds it by itself. Nothing you check leaves your PC. The first run\n`,
    ],
    [
      'a stated exception is not an absolute claim',
      'a.ts',
      `export const N = 'Nothing leaves this machine until you press it, and what leaves is a version number.';`,
    ],
    [
      'an exception after a comma',
      'a.ts',
      `export const N = 'Nothing leaves your machine, unless you press Fetch.';`,
    ],
    [
      'the progress line, in the present continuous',
      'a.tsx',
      `<p>Asking llama3.2 on this machine. Nothing is being sent anywhere.</p>`,
    ],
    [
      'your key never leaves this computer except to the provider',
      'a.ts',
      `export const N = 'The key is saved, and it never leaves this computer except to Anthropic.';`,
    ],
    ['everything lives in one SQLite file', 'a.md', `Everything lives in one SQLite file.\n`],
    [
      'it keeps everything there',
      'a.md',
      `It runs on your own computer and keeps everything there.\n`,
    ],
    [
      'everything under packages is source-only',
      'a.md',
      `Everything under packages/ is source-only.\n`,
    ],
    [
      'works completely offline',
      'a.md',
      `| Application tracker | **No.** Works completely offline. |\n`,
    ],
    [
      'a docblock quoting the old claim in order to warn about it',
      'a.ts',
      `/**\n * THE APP SAYS "EVERYTHING STAYS ON YOUR MACHINE". THIS IS A REAL REQUEST.\n */\nexport const x = 1;`,
    ],
    [
      'a JSX comment quoting the old claim',
      'a.tsx',
      `<p>{/* This app tells people everything stays on their machine. */}Fetch</p>`,
    ],
    ['a fenced code block', 'a.md', 'Text.\n\n```\nEverything stays on your machine\n```\n'],
    [
      'a className that happens to contain the words',
      'a.tsx',
      `<p className="nothing leaves your pc" />`,
    ],
  ];

  it.each(honest)('does not fire on %s', (_name, file, source) => {
    expect(findClaims(source, file), explain(findClaims(source, file))).toEqual([]);
  });

  it('boundary: empty and whitespace-only sources have nothing to say', () => {
    expect(findClaims('', 'a.tsx')).toEqual([]);
    expect(findClaims('   \n\n  ', 'a.md')).toEqual([]);
    expect(copyCandidates('', 'a.tsx')).toEqual([]);
  });
});

describe('privacy promise — the escape hatch must carry a reason', () => {
  const CLAIM = `<p>Everything stays on your machine.</p>`;

  it('the claim is an offence without a suppression', () => {
    expect(findClaims(CLAIM)).not.toEqual([]);
  });

  it('a suppression with a reason clears it', () => {
    const source = `// cviper-allow-absolute-privacy-claim: this label is about the Ollama option only\n${CLAIM}`;
    expect(findClaims(source)).toEqual([]);
  });

  it('a JSX comment suppression with a reason clears it', () => {
    const source = `<div>
      {/* cviper-allow-absolute-privacy-claim: scoped by "the basic match" earlier in the sentence */}
      <p>Everything stays on your machine.</p>
    </div>`;
    expect(findClaims(source)).toEqual([]);
  });

  it('an HTML comment suppression with a reason clears it in markdown', () => {
    const source = `<!-- cviper-allow-absolute-privacy-claim: scoped to the Ollama section above -->\n\nEverything stays on your machine.\n`;
    expect(findClaims(source, 'a.md')).toEqual([]);
  });

  it('negative: a marker with no colon and no reason FAILS', () => {
    const source = `// cviper-allow-absolute-privacy-claim\n${CLAIM}`;
    const offences = findClaims(source);
    expect(offences.map((offence) => offence.rule).join('\n')).toContain('must say WHY');
  });

  it('negative: a colon with an empty reason FAILS', () => {
    const source = `// cviper-allow-absolute-privacy-claim:\n${CLAIM}`;
    expect(
      findClaims(source)
        .map((offence) => offence.rule)
        .join('\n'),
    ).toContain('must say WHY');
  });

  it('negative: a reason of nothing but whitespace FAILS', () => {
    const source = `// cviper-allow-absolute-privacy-claim:  \t\n${CLAIM}`;
    expect(
      findClaims(source)
        .map((offence) => offence.rule)
        .join('\n'),
    ).toContain('must say WHY');
  });

  it('negative: a colon with only a comment terminator after it FAILS', () => {
    // `*/` and `-->` are the comment closing, not a reason. A hatch that
    // accepted them would be a hatch that opens on an empty string.
    const block = `/* cviper-allow-absolute-privacy-claim: */\n${CLAIM}`;
    expect(
      findClaims(block)
        .map((offence) => offence.rule)
        .join('\n'),
    ).toContain('must say WHY');

    const html = `<!-- cviper-allow-absolute-privacy-claim: -->\n\nEverything stays on your machine.\n`;
    expect(
      findClaims(html, 'a.md')
        .map((offence) => offence.rule)
        .join('\n'),
    ).toContain('must say WHY');
  });

  it('negative: a reasonless marker in markdown FAILS', () => {
    const source = `<!-- cviper-allow-absolute-privacy-claim -->\n\nEverything stays on your machine.\n`;
    expect(
      findClaims(source, 'a.md')
        .map((offence) => offence.rule)
        .join('\n'),
    ).toContain('must say WHY');
  });

  it('negative: the marker inside a string literal does NOT open the hatch', () => {
    const source = `const note = "cviper-allow-absolute-privacy-claim: not a comment";\nconst copy = 'Everything stays on your machine.';`;
    expect(findClaims(source, 'a.ts')).not.toEqual([]);
  });

  it('negative: a suppression that suppresses nothing FAILS as stale', () => {
    const source = `// cviper-allow-absolute-privacy-claim: nothing here needs this\nconst copy = 'Your data stays on your machine.';`;
    expect(
      findClaims(source, 'a.ts')
        .map((offence) => offence.rule)
        .join('\n'),
    ).toContain('suppresses nothing');
  });

  it('negative: a suppression left behind after the copy was fixed FAILS', () => {
    // The real drift: somebody narrows the sentence and leaves the hatch open.
    const fixed = `<div>
      {/* cviper-allow-absolute-privacy-claim: scoped by the sentence around it */}
      <p>Your data stays on your machine.</p>
    </div>`;
    expect(
      findClaims(fixed)
        .map((offence) => offence.rule)
        .join('\n'),
    ).toContain('suppresses nothing');
  });

  it('boundary: a suppression only ever reaches the NEXT piece of copy', () => {
    const source = `const first = 'Your data stays on your machine.';
// cviper-allow-absolute-privacy-claim: covers the line below, and only that
const second = 'A harmless line.';
const third = 'Everything stays on your machine.';`;
    expect(findClaims(source, 'a.ts').length).toBe(2);
  });

  it('the corpus carries exactly the suppressions this guard was built with', () => {
    // Not a style rule. Every entry is a sentence somebody has to re-read
    // before they can believe the promise, and the value of the promise is that
    // it is cheap to check. A new one arriving silently is the drift.
    //
    // The list is allowed to SHRINK, and shrinking is the point. `providers.ts`
    // was here until its Ollama note was rewritten from "nothing leaves your
    // PC" to "your CV stays on your PC" — same fact, subject narrowed to the
    // one thing the option actually governs, so no rule fires and no hatch is
    // needed. Prefer that to a suppression every time: a reworded sentence is
    // checked by the machine forever, a suppressed one only by whoever next
    // reads the comment.
    const used = FILES.filter((file) =>
      readFileSync(file, 'utf8').includes('cviper-allow-absolute-privacy-claim'),
    ).map(NAME_OF);

    expect(used).toEqual(['apps/light/src/features/analysis/Analysis.tsx']);
  });
});
