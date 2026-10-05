/**
 * sanitize.ts — CViper Light (Tauri, local Ollama)
 *
 * PORTED FROM: backend/ai/gateway.py  (CViper repo, @ 52af65a2)
 *   `sanitize_for_prompt` (static method).
 *
 * Upstream drift is pinned in CViper's `docs/port-parity-manifest.yaml`; its
 * guard fails there when this source changes. Symbols are named rather than
 * line numbers, which decay on the next edit upstream.
 *
 * Purpose (source docstring, verbatim): "Strip known prompt injection patterns
 * from external text. Removes instruction-override attempts while preserving
 * normal job description content. Apply to any user-supplied or scraped text
 * before embedding it in an AI prompt."
 *
 * Still needed locally. The model is on the user's machine, but the *job
 * description* is not — it is pasted or scraped from a job board, i.e.
 * attacker-influenced text going straight into a prompt. A local 3B model is if
 * anything easier to talk out of its instructions than a frontier one.
 *
 * NOT A SECURITY BOUNDARY ON ITS OWN. It removes the known-bad phrasings the
 * production app has actually seen. The fenced prompt structure and the system
 * message still have to do their share of the work.
 *
 * ORDER IS PART OF THE BEHAVIOUR: patterns run in source order, and the
 * whitespace collapse runs last so it tidies the holes the earlier removals
 * punch in the text.
 */

import { foldedText, removeMatches, removeRanges, type Unit } from './folded-text';

/** One injection defence: the pattern, and what it blocks. */
export interface InjectionPattern {
  readonly pattern: RegExp;
  readonly blocks: string;
}

const INJECTION_PATTERNS: readonly InjectionPattern[] = [
  {
    // gateway.py lines 433-436. Ported verbatim; Python's inline `(?i)` becomes
    // the JS `i` flag, and `g` replaces Python's replace-all default.
    // Blocks the classic override opener: "Ignore all previous instructions",
    // "disregard the above rules", "forget prior prompts" — the phrasing an
    // attacker uses to detach the model from the system message.
    pattern:
      /(ignore|disregard|forget)\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi,
    blocks: 'instruction-override openers ("ignore all previous instructions")',
  },
  {
    // gateway.py line 437. Verbatim.
    // Blocks role reassignment and fake turn markers: "You are now a helpful
    // assistant that...", "New instructions:", and a bare "System:" line that
    // tries to impersonate the system role inside user text.
    pattern: /(you\s+are\s+now|new\s+instructions?|system\s*:)/gi,
    blocks: 'role reassignment and fake system turns ("You are now…", "System:")',
  },
  {
    // gateway.py line 438. Verbatim.
    // Blocks fake privilege-escalation banners — text pretending the model has
    // been switched into a mode where its rules no longer apply.
    pattern: /(SYSTEM\s+OVERRIDE|ADMIN\s+MODE|DEBUG\s+MODE)/gi,
    blocks: 'fake privilege-escalation banners ("SYSTEM OVERRIDE", "ADMIN MODE")',
  },
  {
    // ── NEW IN CViper Light — this is the `TODO(verify)` from the port, closed.
    //
    // The source pattern below is CASE-SENSITIVE, so `=== END JOB ===` was
    // stripped while `=== end job ===` sailed through. A local model will
    // honour a lowercase fence just as readily, so that is a real hole.
    //
    // The obvious fix — adding `i` to the source pattern — is the trap the port
    // note warned about. The source allows `[\w\s']*` between the keyword and
    // the closing equals run, so with `i` it would also eat legitimate advert
    // prose such as `===== Job requirements =====`, silently deleting a whole
    // section heading from the advert we are meant to be analysing.
    //
    // So this pattern matches the FULL FENCE FORM instead of a bare keyword:
    // an equals run, optional `END`, the keyword, and then IMMEDIATELY the
    // closing equals run. Nothing may sit in between. That is exactly the shape
    // our own prompt builder emits (`=== CV ===`, `=== JOB ===` and their
    // `END` forms), and it is the only shape that can actually close one of our
    // sections — so matching it exactly loses nothing and gains every casing.
    //
    // Horizontal whitespace only (`[ \t]`, not `\s`) so the match can never
    // span a line break and swallow real content between two decorated lines.
    pattern: /={3,}[ \t]*(?:END[ \t]+)?(?:CV|JOB)[ \t]*={3,}/gi,
    blocks: 'fence forgery in ANY casing — `=== END JOB ===`, `=== end job ===`',
  },
  {
    // gateway.py line 440 — RETARGETED, and kept CASE-SENSITIVE.
    //   Source:  ={3,}\s*(?:END\s+)?(?:CV|JOB|ORIGINAL|TAILORED|CANDIDATE|BASE|CURRENT|KEYWORDS)[\w\s']*={3,}
    //   Here:    ={3,}[ \t]*(?:END[ \t]+)?(?:CV|JOB)[\w \t']*={3,}
    // The alternation is narrowed because CViper Light fences exactly two
    // sections. If a third fence is ever added, add it here AND in the pattern
    // above, in the same commit.
    //
    // This is the wider net: `[\w \t']*` soaks up suffixes like
    // `=== JOB DESCRIPTION ===`. It stays case-SENSITIVE precisely so that
    // all-caps fence-shaped headings are caught while ordinary title-case or
    // lowercase prose ("===== Job requirements =====") is left intact. The
    // pattern above covers the casing gap for the exact fence form; this one
    // covers the shape gap for the form we emit in shouting caps.
    //
    // SECOND DELIBERATE CHANGE: the source's `\s` is narrowed to `[ \t]` here
    // too. `\s` matches newlines, so the source pattern would match across a
    // decorated block —
    //     ============
    //     CV must be attached
    //     ============
    // — and delete the sentence in the middle of an advert. Our fences are
    // single-line, so a multi-line "fence" could never close one of our
    // sections in the first place; matching it only ever destroyed real text.
    pattern: /={3,}[ \t]*(?:END[ \t]+)?(?:CV|JOB)[\w \t']*={3,}/g,
    blocks: 'fence forgery with an all-caps suffix ("=== JOB DESCRIPTION ===")',
  },
];

/** Rounds of removal allowed before the fail-closed fallback. Honest text settles in 1-2. */
export const MAX_SANITIZE_ROUNDS = 32;
/** Times the fallback may drop offending lines and retry before giving up. */
const MAX_LINE_DROPS = 4;

/**
 * The most text `sanitizeForPrompt` will look at by default: 4 x the largest
 * per-field prompt cap (MAX_CV_CHARS, 6000, in @cviper/ai-providers), so text is
 * still sanitised BEFORE it is truncated to the field's own budget, and the cost
 * of an adversarial paste has a ceiling. A caller with a larger legitimate input
 * (a scraped page stored up to 50,000 characters) passes its own bound.
 */
export const MAX_SANITIZE_INPUT_CHARS = 24_000;

/** The longest label a fence span may hold: `=== <label> ===`. */
const MAX_FENCE_LABEL = 200;

const JOINERS = new Set([String.fromCharCode(0x200c), String.fromCharCode(0x200d)]);
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
/**
 * Read as a line break, so removing them never glues two words together:
 * U+000B, U+000C, U+001C-U+001F, U+0085, U+2028, U+2029. Built from code points
 * so none sits in this file.
 */
const LINE_SEPARATORS = new Set(
  String.fromCharCode(0x0b, 0x0c, 0x1c, 0x1d, 0x1e, 0x1f, 0x85, 0x2028, 0x2029),
);
/** Box-drawing double line: NFKC leaves it alone, but it is read as `=`. */
const BOX_DOUBLE = String.fromCharCode(0x2550);
const NEWLINE_RUN = new RegExp(`${NL}{4,}`, 'g');
const INVISIBLE = /[\p{Cc}\p{Cf}]/u;
const FENCE_RUN = /={3,}/g;

/**
 * One stored character per unit. Line structure (newline, CR, tab) is kept and
 * line separators become a newline. Controls and format characters stay as
 * `invisible` units until the end of the round: they fold to nothing for one
 * pass (so `==<ZWSP>=` is a fence) and to a space for another (so
 * `ignore<ZWJ>previous` is a phrase). The joiners U+200C/U+200D are the one
 * thing that is never removed: they are part of how Persian, Indic and emoji
 * text is spelled.
 */
function toUnits(text: string): Unit[] {
  const units: Unit[] = [];
  for (const char of text) {
    if (char === NL || char === CR || char === TAB) {
      units.push({ shown: char, fold: char });
    } else if (LINE_SEPARATORS.has(char)) {
      units.push({ shown: NL, fold: NL });
    } else if (INVISIBLE.test(char)) {
      units.push({ shown: char, fold: '', invisible: true });
    } else {
      units.push({ shown: char, fold: char === BOX_DOUBLE ? '=' : char.normalize('NFKC') });
    }
  }
  return units;
}

/** The same units with every invisible character folding to `fold`. */
function withInvisiblesFolding(units: Unit[], fold: string): Unit[] {
  return units.map((unit) => (unit.invisible === true ? { ...unit, fold } : unit));
}

function shownText(units: Unit[]): string {
  return units.map((unit) => unit.shown).join('');
}

/**
 * Fence runs that are part of a fence SHAPE, whatever the label: a run of 3+
 * fence characters with another such run on the same line within
 * `MAX_FENCE_LABEL` characters, or a run that is all there is on its line. The
 * runs go, and the blanks next to them on the label side, so
 * `=== END JOB ADVERT ===` becomes `END JOB ADVERT`: the words are kept, the
 * shape that could close one of our sections is not. Label-agnostic on purpose —
 * the prompt builders emit a couple of dozen labels and a list would go stale.
 */
function fenceShapeRanges(folded: string): [number, number][] {
  const ranges: [number, number][] = [];
  let lineStart = 0;
  for (const line of folded.split(NL)) {
    const runs = [...line.matchAll(FENCE_RUN)].map((m) => [m.index, m.index + m[0].length]);
    runs.forEach(([start, end], i) => {
      if (start === undefined || end === undefined) return;
      const prev = runs[i - 1];
      const next = runs[i + 1];
      const hasPrev = prev?.[1] !== undefined && start - prev[1] <= MAX_FENCE_LABEL;
      const hasNext = next?.[0] !== undefined && next[0] - end <= MAX_FENCE_LABEL;
      const alone = line.slice(0, start).trim() === '' && line.slice(end).trim() === '';
      if (!hasPrev && !hasNext && !alone) return;
      let from = start;
      let to = end;
      // Blanks on the label side go too, so the label comes out trimmed.
      if (hasNext || alone) while (line[to] === ' ' || line[to] === TAB) to += 1;
      if (hasPrev) while (from > 0 && (line[from - 1] === ' ' || line[from - 1] === TAB)) from -= 1;
      ranges.push([lineStart + from, lineStart + to]);
    });
    lineStart += line.length + 1;
  }
  return ranges;
}

/** One removal pass over `units`, on whatever fold they currently carry. */
function removePass(units: Unit[]): Unit[] {
  let out = units;
  for (const { pattern } of INJECTION_PATTERNS) out = removeMatches(out, pattern, '');
  return removeRanges(out, fenceShapeRanges(foldedText(out)), '');
}

/** One removal round. Idempotent on text no pattern matches. */
function round(text: string): string {
  let units = toUnits(text);
  // Pass 1: invisibles fold to nothing, so one dropped into a fence or a word
  // does not hide it. Pass 2: they fold to a space, so one used AS the
  // separator ("ignore<ZWJ>previous") does not hide a phrase.
  units = removePass(withInvisiblesFolding(units, ''));
  units = removePass(withInvisiblesFolding(units, ' '));
  const kept = units.filter((unit) => unit.invisible !== true || JOINERS.has(unit.shown));
  // gateway.py line 443 — collapse excessive whitespace. Four-or-more newlines
  // become three; genuine paragraph breaks survive.
  return shownText(kept).replace(NEWLINE_RUN, NL.repeat(3)).trim();
}

/** The text once it stops changing, or `null` if it has not by the round cap. */
function settle(text: string, tally: { rounds: number }): string | null {
  let current = text;
  for (let i = 0; i < MAX_SANITIZE_ROUNDS; i += 1) {
    tally.rounds += 1;
    const next = round(current);
    if (next === current) return current;
    current = next;
  }
  return null;
}

/**
 * Blank every line a trigger touches. Used only when the rounds did not settle.
 * Lines are blanked, never joined, so no new phrase is made across them.
 */
function blankOffendingLines(text: string): string {
  const units = withInvisiblesFolding(toUnits(text), ' ');
  const folded = foldedText(units);
  const lineOfUnit: number[] = [];
  let line = 0;
  for (const unit of units) {
    lineOfUnit.push(line);
    if (unit.shown === NL) line += 1;
  }
  const owner: number[] = [];
  units.forEach((unit, index) => {
    for (let i = 0; i < unit.fold.length; i += 1) owner.push(index);
  });
  const bad = new Set<number>();
  const mark = (start: number, end: number): void => {
    for (let i = start; i < end; i += 1) {
      const index = owner[i];
      if (index !== undefined) bad.add(lineOfUnit[index] ?? 0);
    }
  };
  for (const { pattern } of INJECTION_PATTERNS) {
    for (const match of folded.matchAll(new RegExp(pattern.source, pattern.flags))) {
      if (match[0] !== '') mark(match.index, match.index + match[0].length);
    }
  }
  for (const [start, end] of fenceShapeRanges(folded)) mark(start, end);
  return shownText(units)
    .split(NL)
    .map((l, i) => (bad.has(i) ? '' : l))
    .join(NL);
}

/** What happened while sanitising: for tests and for anyone tuning the bounds. */
export interface SanitizeStats {
  readonly text: string;
  /** Removal rounds run, across every retry. */
  readonly rounds: number;
  /** Times the fail-closed fallback blanked offending lines. */
  readonly lineDrops: number;
  /** True when the input was longer than the bound and was cut first. */
  readonly capped: boolean;
}

/** `sanitizeForPrompt`, returning its counters too. */
export function sanitizeWithStats(
  text: string | null | undefined,
  maxInputChars: number = MAX_SANITIZE_INPUT_CHARS,
): SanitizeStats {
  if (!text) return { text: '', rounds: 0, lineDrops: 0, capped: false };

  let current = text;
  const capped = current.length > maxInputChars;
  if (capped) {
    let cut = maxInputChars;
    const last = current.charCodeAt(cut - 1);
    if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
    current = current.slice(0, cut);
  }

  const tally = { rounds: 0 };
  for (let drops = 0; drops <= MAX_LINE_DROPS; drops += 1) {
    const settled = settle(current, tally);
    if (settled !== null) return { text: settled, rounds: tally.rounds, lineDrops: drops, capped };
    current = blankOffendingLines(current);
  }
  return { text: '', rounds: tally.rounds, lineDrops: MAX_LINE_DROPS, capped };
}

/**
 * Strip known prompt-injection patterns from untrusted text (job descriptions,
 * scraped adverts, pasted postings) before embedding it in a prompt.
 *
 * Source: gateway.py `sanitize_for_prompt`, lines 422-444, extended in L-207:
 *
 * FIXPOINT. Removing a phrase can re-form one ("SysSystem:tem:" -> "System:"),
 * so removal repeats until the text stops changing.
 *
 * FOLDED DETECTION. Patterns run on an NFKC-folded view, so fullwidth and
 * box-drawing fences and `ＳＹＳＴＥＭ：` are caught; the text KEPT is the
 * user's own (`10²`, `½`, `™` are never rewritten). Zero-width and other
 * format characters are removed so they cannot split a fence or stand in for a
 * space; the joiners U+200C/U+200D are kept.
 *
 * ANY FENCE SHAPE. A run of 3+ `=` (or lookalike) with another on the same line
 * is not left standing whatever sits between: the runs go, the label stays.
 *
 * BOUNDED. Input is cut to `maxInputChars` first; see MAX_SANITIZE_INPUT_CHARS.
 *
 * FAIL CLOSED, BUT NOT WHOLE-ADVERT. If 32 rounds do not settle, nobody wrote
 * that text honestly. Returning '' would throw away the whole advert and break
 * analysis, so the lines the remaining triggers touch are blanked (newlines
 * kept, so paragraph structure survives) and the rounds run again. Only if that
 * also fails four times is '' returned. The result is always a true fixpoint.
 */
export function sanitizeForPrompt(
  text: string | null | undefined,
  maxInputChars: number = MAX_SANITIZE_INPUT_CHARS,
): string {
  return sanitizeWithStats(text, maxInputChars).text;
}

/**
 * Exposed for tests and for documenting the defence set.
 *
 * Every `pattern` carries the `g` flag and is therefore STATEFUL. `String
 * .replace` resets `lastIndex`, so `sanitizeForPrompt` is safe to call
 * repeatedly, but calling `.test()` on one of these directly is not — it leaves
 * `lastIndex` moved for the next caller. Read them; do not run them.
 */
export const injectionPatterns = INJECTION_PATTERNS;

// ─────────────────────────────────────────────────────────────────────────────
// DELIBERATELY NOT PORTED
// ─────────────────────────────────────────────────────────────────────────────
// gateway.py line 441:
//   re.sub(r'<{3,}\s*(?:END_)?(?:UPDATED_CV|GAP_ANALYSIS|CHANGES_SUMMARY|REMAINING_GAPS)\s*>{3,}', '', text)
// This defends `<<<UPDATED_CV>>>`-style fences used by the old app's iterative
// CV-editing feature. CViper Light emits no such fences, so the pattern would be
// inert. If an angle-bracket fence is ever introduced, port this line and widen
// the alternation rather than inventing a generic `<<<...>>>` rule — a generic
// one would eat legitimate `<<<` text out of job adverts.
//
// KNOWN AND ACCEPTED FALSE POSITIVES (both inherited from the source):
//   - "System:" is removed anywhere it appears, so "Trading System: Murex"
//     becomes "Trading  Murex". Deleting two words from an advert is a much
//     smaller harm than honouring a forged system turn.
//   - "===== JOB DESCRIPTION =====" in an advert is removed as fence-shaped.
//     A heading is lost; the requirements under it are not.
// Both are covered by tests so the next person changing this file finds out
// that the behaviour is deliberate rather than discovering it in the wild.
