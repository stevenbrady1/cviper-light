/**
 * Text tidying. Pure, synchronous, no I/O, no dependencies.
 */

/**
 * Characters that are whitespace but are not the space character.
 *
 * pdf.js hands back whatever the PDF encoded, so a CV laid out with
 * non-breaking spaces arrives full of U+00A0. Leaving them in means a search
 * for "50 %" never matches the "50 %" that is plainly on the screen, and
 * nobody ever works out why.
 */
const EXOTIC_HORIZONTAL_SPACE = /[ \t\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+/g;

/**
 * Invisible characters that carry no meaning and are safe to delete.
 *
 * A soft hyphen (U+00AD) sitting inside "Ana-lyst" makes the word unfindable by
 * any matcher while looking completely normal. Same for a zero-width space or a
 * byte-order mark that survived a conversion. These are DELETED, not replaced
 * with a space: they were never a word break.
 *
 * ==========================================================================
 * U+200C and U+200D ARE DELIBERATELY NOT IN THIS LIST.
 * ==========================================================================
 * They are invisible too, and stripping them looked tidy right up until you
 * ask what they are for:
 *   - U+200D (zero-width JOINER) is what holds an emoji sequence together.
 *     Deleting it turns a single glyph into two unrelated ones.
 *   - U+200C (zero-width NON-joiner) is a real orthographic character in
 *     Persian, Arabic and several Indic scripts. Deleting it changes the
 *     spelling of a candidate's name.
 * Neither is noise, so neither is removed. ESLint's
 * `no-misleading-character-class` is what stopped this going in.
 */
const ZERO_WIDTH = /[\u00ad\u200b\u2060\ufeff]/g;

/**
 * Normalise the whitespace in extracted text without touching anything else.
 *
 * Currency symbols, accented Latin, CJK, em dashes and bullets come through
 * byte-for-byte — they are the content. Idempotent by construction: running
 * this twice gives the same answer as running it once.
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(ZERO_WIDTH, '')
    .replace(/\r\n?/g, '\n')
    .replace(EXOTIC_HORIZONTAL_SPACE, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n +/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Appended when text has been cut short.
 *
 * The model needs to know it is looking at a fragment; without this it will
 * happily conclude the candidate's career ended mid-sentence.
 */
export const TRUNCATION_MARKER = '\n\n[truncated]';

/** How far back from the cut we will look for a word boundary. */
const BOUNDARY_SEARCH_FRACTION = 0.2;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Cut `text` down to fit a prompt budget.
 *
 * ============================================================================
 * THE RESULT IS NEVER LONGER THAN `maxChars`. THAT IS THE WHOLE CONTRACT.
 * ============================================================================
 * Callers use this to fit inside a context window, so "usually under the
 * budget" is worthless — the marker has to be paid for out of the budget, not
 * added on top of it. Length is counted in UTF-16 code units, the same thing
 * `String.length` counts, and a surrogate pair is never split down the middle:
 * a lone surrogate is not valid text and corrupts anything that re-encodes it.
 *
 * Text that already fits is returned untouched, with no marker.
 */
export function truncateForPrompt(text: string, maxChars: number): string {
  const budget = Math.floor(maxChars);
  if (budget <= 0) return '';
  if (text.length <= budget) return text;

  // The marker only goes in if it can be paid for and still leave room for
  // enough text to be worth sending. Otherwise a hard cut is more honest.
  const useMarker = budget >= TRUNCATION_MARKER.length * 2;
  const bodyBudget = useMarker ? budget - TRUNCATION_MARKER.length : budget;

  let cut = bodyBudget;
  if (isHighSurrogate(text.charCodeAt(cut - 1))) cut -= 1;

  // Prefer to end on a word boundary, but only if one is nearby — backing off
  // half the document to find a space would lose more than it gains.
  const earliest = cut - Math.floor(bodyBudget * BOUNDARY_SEARCH_FRACTION);
  for (let index = cut - 1; index >= earliest && index > 0; index -= 1) {
    if (/\s/.test(text.charAt(index))) {
      cut = index;
      break;
    }
  }

  const body = text.slice(0, cut).trimEnd();
  return useMarker ? body + TRUNCATION_MARKER : body;
}
