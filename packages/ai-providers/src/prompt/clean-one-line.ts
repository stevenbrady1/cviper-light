/**
 * The ONE cleaner for a single-line value that goes inside one of our fences:
 * a keyword gap, a skill, a user-supplied achievement (L-205).
 *
 * `sanitizeForPrompt` is a single-pass, ASCII-minded filter built for adverts.
 * It is deliberately not changed here. What a one-line value needs on top of it:
 *
 *   * NFKC, so a fullwidth equals run becomes `===` before anything looks at it.
 *   * Invisible characters (format `\p{Cf}`, controls `\p{Cc}`) removed, so a
 *     zero-width space inside an equals run cannot hide a fence. Every line separator (including
 *     U+0085, U+001E, U+2028 and U+2029) becomes a space FIRST, so removing
 *     controls never glues two words together.
 *   * Runs of two or more of `= ＝ ═` removed (the box-drawing double line is
 *     not touched by NFKC). A single-line value never needs one.
 *   * Optionally `[` and `]` removed (a skill sits inside `[ ]`, and must not
 *     be able to close its own bracket).
 *   * `sanitizeForPrompt` run until the text stops changing, so a filter that
 *     removes `System:` from `SysSystem:tem:` is run again on what is left.
 */
import { sanitizeForPrompt } from '@cviper/cv-parsing';

export interface CleanOneLineOptions {
  /** Remove `[` and `]`. For a skill, which is printed between brackets. */
  readonly stripBrackets?: boolean;
}

/** Built from code points so no invisible character sits in this source file. */
const SEPARATORS = new RegExp(
  `[\\t\\n\\v\\f\\r\\x1c-\\x1f\\x85${String.fromCharCode(0x2028, 0x2029)}]`,
  'g',
);
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;
const FENCE_RUN = /[=＝═]{2,}/g;
const BRACKETS = /[[\]]/g;

/** A stable result is reached in two or three rounds; ten is a hard stop. */
const MAX_ROUNDS = 10;

function round(text: string, stripBrackets: boolean): string {
  let out = text.normalize('NFKC');
  out = out.replace(SEPARATORS, ' ').replace(INVISIBLE, '');
  out = out.replace(FENCE_RUN, ' ');
  if (stripBrackets) out = out.replace(BRACKETS, '');
  out = sanitizeForPrompt(out);
  return out.replace(/\s+/g, ' ').trim();
}

/** The cleaned text, on one line, at most `max` UTF-16 units (never half a surrogate pair). */
export function cleanOneLine(text: string, max: number, options: CleanOneLineOptions = {}): string {
  const stripBrackets = options.stripBrackets === true;
  let current = text;
  for (let i = 0; i < MAX_ROUNDS; i += 1) {
    const next = round(current, stripBrackets);
    if (next === current) break;
    current = next;
  }
  if (current.length <= max) return current;
  let cut = max;
  const last = current.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return current.slice(0, cut).trim();
}
