/**
 * Conservative singular/plural folding for a single token.
 *
 * Ported verbatim from `backend/ai/keywords.py::_plural_variants` (line 85)
 * and the guard rationale documented at lines 57-82 (CV-1040).
 *
 * ============================================================================
 * THIS IS NOT A STEMMER AND MUST NOT BECOME ONE.
 * ============================================================================
 * Whole-token matching meant `developer` never matched `developers` — the
 * single most common miss in keyword scoring. The fix is deliberately the
 * smallest one that works: add or strip ONE trailing `s`, behind four guards.
 * Reach for a real stemmer and you get `ios` matching `io`, `analysis`
 * matching `analysi`, and `kubernetes` matching a thing called `kubernete`.
 *
 * The irregular `-es` / `-ies` forms are intentionally out of scope.
 */

/** Below this length a token is too ambiguous to fold at all. */
export const PLURAL_MIN_LEN = 4;

/** A token containing any of these is an identifier, not a word. */
export const PLURAL_SYMBOL_CHARS = '#+./-';

/** Words that end in s and are not plurals. */
export const PLURAL_EXEMPT: ReadonlySet<string> = new Set([
  'ios',
  'kubernetes',
  'jenkins',
  'redis',
  'sass',
  'express',
  'less',
  'devops',
  'https',
  'cors',
  'kudos',
  'analysis',
  'aws',
  'gcp',
  'dns',
  'cics',
]);

/**
 * The whole-token singular/plural variants of `term`, always including `term`
 * itself. Returns just `{term}` for anything that must not fold.
 */
export function pluralVariants(term: string): Set<string> {
  const variants = new Set<string>([term]);
  if (
    term.length < PLURAL_MIN_LEN ||
    PLURAL_EXEMPT.has(term) ||
    [...PLURAL_SYMBOL_CHARS].some((char) => term.includes(char)) ||
    term.endsWith('ss') ||
    term.endsWith('us') ||
    term.endsWith('is')
  ) {
    return variants;
  }
  if (term.endsWith('s')) {
    variants.add(term.slice(0, -1)); // developers -> developer
  } else {
    variants.add(`${term}s`); // developer -> developers
  }
  return variants;
}
