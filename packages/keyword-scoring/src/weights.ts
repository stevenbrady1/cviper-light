/**
 * Rarity weighting — the reason this scorer is not a word count.
 *
 * Ported from `backend/ai/keywords.py::KeywordService.skill_weight`
 * (line 284), CV-704 Phase 2.
 *
 * ============================================================================
 * WHY A WEIGHT AND NOT A COUNT.
 * ============================================================================
 * Every advert in the country asks for "communication", "teamwork", "Agile"
 * and "attention to detail". Count matches and a candidate who shares nothing
 * with the role but that boilerplate scores the same as one who has the
 * role-defining skill — the score stops telling the user anything, which is
 * worse than not showing one.
 *
 * So each requirement carries a weight and coverage is weighted, not counted.
 * Ubiquitous skills sit at 0.4 in `_base.json`; anything the lexicon does not
 * list is role-defining by default and carries 1.0.
 *
 * A constant return value here would leave every other test in this package
 * passing while quietly reverting the scorer to naive counting, so
 * `match.test.ts` asserts the difference end-to-end as well.
 */
import { aliasIndex, lexicon } from './lexicon';

/**
 * The weight of a skill the lexicon says nothing about.
 *
 * 1.0, never 0: an unlisted skill is presumed role-defining, because the
 * lexicon lists boilerplate, not expertise. Weighting an unknown skill at zero
 * would make it free to miss — a specialist requirement the lexicon has not
 * caught up with would cost the candidate nothing.
 */
export const DEFAULT_SKILL_WEIGHT = 1.0;

/**
 * Rarity weight for a skill or requirement.
 *
 * A synonym or alias is resolved to its canonical term first, so an advert
 * asking for "Lean" is recognised as the same boilerplate as "Agile" rather
 * than being mistaken for a rare manufacturing discipline.
 */
export function skillWeight(term: string): number {
  const key = (term || '').toLowerCase().trim();
  if (!key) return DEFAULT_SKILL_WEIGHT;

  const direct = lexicon.skillWeights[key];
  if (direct !== undefined) return direct;

  const canonical = aliasIndex.get(key);
  if (canonical !== undefined) {
    const viaAlias = lexicon.skillWeights[canonical];
    if (viaAlias !== undefined) return viaAlias;
  }

  return DEFAULT_SKILL_WEIGHT;
}
