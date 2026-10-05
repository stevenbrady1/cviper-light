/**
 * The ONE cleaner for a single-line value that goes inside one of our fences:
 * a keyword gap, a skill, a user-supplied achievement (L-205).
 *
 * `sanitizeForPrompt` is a single-pass, ASCII-minded filter built for adverts.
 * It is deliberately not changed here. What a one-line value needs on top of it:
 *
 * DETECT on a folded copy, STORE the original.
 *   Each character is folded with NFKC for DETECTION only, so a fullwidth
 *   `＝＝＝` or `ＳＹＳＴＥＭ：` is seen for what it is. What is kept is the
 *   user's own text (NFC): `10²`, `½`, `™` and the digits are never rewritten,
 *   because a cleaner that turns `10²` into `102` changes a number the user
 *   typed, and the figure check would then wave `102` through.
 *
 * What is removed.
 *   * Line separators (including U+0085, U+001E, U+2028, U+2029) become a space,
 *     so removing controls never glues two words together.
 *   * Controls and format characters are removed, EXCEPT U+200C and U+200D: the
 *     joiners are part of how Persian, Indic and emoji text is spelled.
 *   * Runs of two or more `=` (or the box-drawing double line) are removed.
 *   * Optionally `[` and `]` (a skill sits inside `[ ]`).
 *   * The injection phrases `sanitizeForPrompt` knows, found on the folded copy
 *     and removed from the stored text.
 *
 * FAIL CLOSED.
 *   Phrase removal can re-form another phrase (`SysSystem:tem:`), so the
 *   cleaner repeats until the text stops changing. If it has not settled after
 *   `MAX_ROUNDS` it returns the EMPTY string, never a half-cleaned value: no
 *   honest achievement is nested that deep, and an empty entry cannot be
 *   approved.
 */
import { injectionPatterns } from '@cviper/cv-parsing';

export interface CleanOneLineOptions {
  /** Remove `[` and `]`. For a skill, which is printed between brackets. */
  readonly stripBrackets?: boolean;
}

/** Built from code points so no invisible character sits in this source file. */
const SEPARATOR = new RegExp(`[\t\n\v\f\r\x1c-\x1f\x85${String.fromCharCode(0x2028, 0x2029)}]`);
const INVISIBLE = /[\p{Cc}\p{Cf}]/u;
const FENCE_RUN = /[=＝═]{2,}/g;
const BRACKETS = /[[\]]/g;
const JOINERS = new Set([String.fromCharCode(0x200c), String.fromCharCode(0x200d)]);

/** Rounds allowed before giving up. A genuine entry settles in one or two. */
export const MAX_ROUNDS = 12;

/** One character of stored text and what it looks like once folded. */
interface Unit {
  readonly shown: string;
  readonly fold: string;
}

function toUnits(text: string): Unit[] {
  const units: Unit[] = [];
  for (const char of text.normalize('NFC')) {
    if (SEPARATOR.test(char)) {
      units.push({ shown: ' ', fold: ' ' });
      continue;
    }
    if (INVISIBLE.test(char) && !JOINERS.has(char)) continue;
    units.push({ shown: char, fold: char.normalize('NFKC') });
  }
  return units;
}

/** Remove every span `pattern` finds in the folded text; units touched go. */
function removeMatches(units: Unit[], pattern: RegExp, replacement: string): Unit[] {
  const folded = units.map((unit) => unit.fold).join('');
  const owner: number[] = [];
  units.forEach((unit, index) => {
    for (let i = 0; i < unit.fold.length; i += 1) owner.push(index);
  });

  const doomed = new Set<number>();
  const firstOfSpan = new Map<number, string>();
  for (const match of folded.matchAll(new RegExp(pattern.source, pattern.flags))) {
    if (match[0] === '') continue;
    const start = match.index;
    let first = true;
    for (let i = start; i < start + match[0].length; i += 1) {
      const index = owner[i];
      if (index === undefined) continue;
      if (first) {
        firstOfSpan.set(index, replacement);
        first = false;
      }
      doomed.add(index);
    }
  }
  if (doomed.size === 0) return units;

  const out: Unit[] = [];
  units.forEach((unit, index) => {
    const swap = firstOfSpan.get(index);
    if (swap !== undefined && swap !== '') out.push({ shown: swap, fold: swap });
    if (!doomed.has(index)) out.push(unit);
  });
  return out;
}

function round(text: string, stripBrackets: boolean): string {
  let units = toUnits(text);
  units = removeMatches(units, FENCE_RUN, ' ');
  if (stripBrackets) units = removeMatches(units, BRACKETS, '');
  for (const { pattern } of injectionPatterns) units = removeMatches(units, pattern, '');
  return units
    .map((unit) => unit.shown)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The cleaned text, on one line, at most `max` UTF-16 units (never half a
 * surrogate pair); the empty string if it cannot be made stable.
 */
export function cleanOneLine(text: string, max: number, options: CleanOneLineOptions = {}): string {
  const stripBrackets = options.stripBrackets === true;
  let current = text;
  let settled = false;
  for (let i = 0; i < MAX_ROUNDS; i += 1) {
    const next = round(current, stripBrackets);
    if (next === current) {
      settled = true;
      break;
    }
    current = next;
  }
  if (!settled) return '';
  if (current.length <= max) return current;
  let cut = max;
  const last = current.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return current.slice(0, cut).trim();
}
