/**
 * Python's `re` character classes, spelled out for JavaScript.
 *
 * Python 3 compiles `str` patterns as Unicode by default: `\d` is any Unicode
 * decimal digit, `\w` is anything `str.isalnum()` accepts plus `_`, `\b` is a
 * boundary between those, and `\s` is Python's whitespace set. JavaScript's
 * `\d`, `\w` and `\b` are ASCII even under the `u` flag, and its `\s` is a
 * DIFFERENT Unicode set (it includes U+FEFF and excludes U+0085 and
 * U+001C-U+001F, which Python treats the other way round).
 *
 * A port that used the JavaScript classes would agree with the Python on every
 * ASCII CV and quietly disagree on the rest. These constants are what the
 * ports below use instead, and `parity.test.ts` carries a measured probe for
 * each difference.
 *
 * Every pattern built from these needs the `u` flag.
 */

/** Python `\s` and `str.split()` / `str.strip()` whitespace (`str.isspace()`). */
export const PY_SPACE =
  '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';

/** Python `\d`: a Unicode decimal digit. */
export const PY_DIGIT = '\\p{Nd}';

/** One Python `\w` character: Unicode letter or number, or underscore. */
export const PY_WORD_CHAR = '[\\p{L}\\p{N}_]';

/** Python `\b`: a word boundary measured with `PY_WORD_CHAR`. */
export const PY_BOUNDARY = `(?:(?<=${PY_WORD_CHAR})(?!${PY_WORD_CHAR})|(?<!${PY_WORD_CHAR})(?=${PY_WORD_CHAR}))`;

const LEADING_SPACE = new RegExp(`^${PY_SPACE}+`, 'u');
const TRAILING_SPACE = new RegExp(`${PY_SPACE}+$`, 'u');
const SPACE_RUN = new RegExp(`${PY_SPACE}+`, 'u');

/** Python's `str.strip()` with no argument. */
export function pyStrip(text: string): string {
  return text.replace(LEADING_SPACE, '').replace(TRAILING_SPACE, '');
}

/** Python's `str.split()` with no argument: runs of whitespace, no empty tokens. */
export function pySplit(text: string): string[] {
  const stripped = pyStrip(text);
  return stripped === '' ? [] : stripped.split(SPACE_RUN);
}
