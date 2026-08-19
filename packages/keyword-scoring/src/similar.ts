/**
 * Synonym and stem expansion.
 *
 * Ported from `backend/ai/keywords.py::KeywordService.get_similar_terms`
 * (line 334). The source consults three sources — the curated `RELATED_TERMS`
 * map, the operator-configured synonyms from the database, and a small table
 * of role/noun suffix pairs. CViper Light has no database and no operator, so
 * the configured-synonyms leg is replaced by the lexicon-derived alias index
 * (`skill_canonical.py::_build_alias_index`), which is what the source's own
 * comment at `keywords.py` line 108 points at.
 *
 * Expansion is what lets a CV that says "Business Analysis" cover an advert
 * that says "Business Analyst" without either side having to guess the other's
 * phrasing.
 */
import { aliasIndex, lexicon } from './lexicon';

/**
 * Role noun / activity noun pairs. Ported verbatim from the source's
 * `suffix_pairs` (line 356). Order is preserved so expansion is deterministic.
 */
const SUFFIX_PAIRS: readonly (readonly [string, string])[] = [
  ['analyst', 'analysis'],
  ['developer', 'development'],
  ['engineer', 'engineering'],
  ['designer', 'design'],
  ['manager', 'management'],
  ['administrator', 'administration'],
  ['consultant', 'consulting'],
  ['architect', 'architecture'],
  ['tester', 'testing'],
  ['coordinator', 'coordination'],
];

/**
 * Terms related to `term`: curated synonyms, the canonical form behind an
 * alias and its siblings, and simple role/noun stem variations.
 *
 * Never contains `term` itself and never contains the empty string — stripping
 * "analyst" from the bare word "analyst" leaves "", and an empty term matches
 * every document ever written.
 */
export function getSimilarTerms(term: string): string[] {
  const termLower = (term || '').toLowerCase().trim();
  if (!termLower) return [];

  // Insertion-ordered so the result is deterministic run to run.
  const related = new Set<string>();

  const direct = lexicon.relatedTerms[termLower];
  if (direct) for (const alias of direct) related.add(alias.toLowerCase());

  // Reverse leg: given an alias, recover the canonical term and every sibling
  // alias that shares it.
  const canonical = aliasIndex.get(termLower);
  if (canonical !== undefined && canonical !== termLower) {
    related.add(canonical);
    const siblings = lexicon.relatedTerms[canonical];
    if (siblings) for (const alias of siblings) related.add(alias.toLowerCase());
  }

  for (const [roleSuffix, nounSuffix] of SUFFIX_PAIRS) {
    if (termLower.endsWith(roleSuffix)) {
      related.add(termLower.slice(0, -roleSuffix.length) + nounSuffix);
    } else if (termLower.endsWith(nounSuffix)) {
      related.add(termLower.slice(0, -nounSuffix.length) + roleSuffix);
    }
  }

  related.delete(termLower);
  related.delete('');
  return [...related];
}
