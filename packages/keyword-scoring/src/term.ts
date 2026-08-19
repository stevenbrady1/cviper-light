/**
 * `termInText` — the single source of truth for "does this skill appear in
 * this text".
 *
 * Ported from `backend/ai/keywords.py::KeywordService.term_in_text` (line 302)
 * and the `_TOKEN_LEFT` / `_TOKEN_RIGHT` lookarounds at lines 21-22 (CV-700).
 *
 * ============================================================================
 * WHY NOT `\b`, AND WHY NOT `includes()`.
 * ============================================================================
 * `text.includes('java')` reports a hit on "javascript", so a Java advert
 * matches a JavaScript CV. That was the original bug.
 *
 * The obvious fix, `\bjava\b`, is worse in a different direction: `\b` is a
 * transition between a word character and a non-word character, and `#`, `+`,
 * `.` and `/` are all non-word. So `\bc#\b` requires a word character straight
 * after the `#` and can never match the token `c#` standing on its own.
 * `.NET`, `C++`, `CI/CD` and `Node.js` all fail the same way — the exact
 * skills most worth matching precisely.
 *
 * So the boundary is written as lookarounds over a character class that
 * INCLUDES those symbols. `c#` matches as a whole token; `c` does not match
 * inside `c#`; `go` does not match inside `ongoing`.
 *
 * `\w` in Python is Unicode-aware and JavaScript's is ASCII-only, so the class
 * is spelled `\p{L}\p{N}` under the `u` flag rather than `\w`. Without that a
 * CV written with accented words ("Analyse données") would find token
 * boundaries the Python original does not, and the two implementations would
 * disagree on the same input.
 */
import { escapeRegExp, foldSpelling } from './spelling';
import { pluralVariants } from './plurals';

const TOKEN_CHARS = '\\p{L}\\p{N}_#+./\\-';
const TOKEN_LEFT = '(?<![' + TOKEN_CHARS + '])';
const TOKEN_RIGHT = '(?![' + TOKEN_CHARS + '])';

/**
 * Compiled patterns, keyed by the folded term.
 *
 * A single scoring run tests a few hundred terms against two documents, and
 * `matchProfileToJob` re-tests many of them. Python's `re` module memoises
 * compiled patterns internally; JavaScript's `RegExp` constructor does not, so
 * this cache is what keeps the port's cost comparable to the original's.
 */
const patternCache = new Map<string, RegExp>();

/**
 * Alternation over a token's plural variants, longest-first so the engine
 * prefers the fuller token (`developers` before `developer`) rather than
 * relying on boundary-driven backtracking.
 */
function alternation(token: string): string {
  const variants = [...pluralVariants(token)].sort(
    (a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0),
  );
  const escaped = variants.map(escapeRegExp).join('|');
  return variants.length === 1 ? escaped : '(?:' + escaped + ')';
}

function patternFor(foldedTerm: string): RegExp {
  const cached = patternCache.get(foldedTerm);
  if (cached) return cached;

  const words = foldedTerm.split(/\s+/).filter(Boolean);
  const lastWord = words[words.length - 1];
  let body: string;
  if (words.length > 1 && lastWord !== undefined) {
    // Multi-word: fold the plural on the HEAD NOUN (the last word) only, and
    // keep strict adjacency. "data pipeline" matches "data pipelines";
    // "market risk" still requires the two words next to each other, so
    // "market and credit risk" is correctly not a match.
    const head = words.slice(0, -1).map(escapeRegExp);
    body = [...head, alternation(lastWord)].join('\\s+');
  } else {
    body = alternation(foldedTerm);
  }

  const pattern = new RegExp(TOKEN_LEFT + body + TOKEN_RIGHT, 'u');
  patternCache.set(foldedTerm, pattern);
  return pattern;
}

/**
 * Whole-token, symbol-aware, US/UK-aware membership test against text that has
 * ALREADY been lowercased and passed through `foldSpelling`.
 *
 * This is the hot path. A scan folds the haystack once and then calls this
 * once per candidate term; `termInText` below is the same test with the
 * folding done for you. They must always agree — `term.test.ts` pins that.
 */
export function termInFoldedText(term: string, foldedText: string): boolean {
  if (!term || !foldedText) return false;
  const folded = foldSpelling(term.toLowerCase().trim());
  if (!folded) return false;
  return patternFor(folded).test(foldedText);
}

/**
 * Whole-token, symbol-aware membership test. Case-insensitive; multi-word
 * terms match across whitespace only.
 *
 * Ultra-short single-character tokens are inherently ambiguous in prose ("r"
 * in "R&D"), so callers with a corroborating signal should gate them — see the
 * `skillHit` helper in `match.ts`.
 */
export function termInText(term: string, text: string): boolean {
  if (!term || !text) return false;
  return termInFoldedText(term, foldSpelling(text.toLowerCase()));
}
