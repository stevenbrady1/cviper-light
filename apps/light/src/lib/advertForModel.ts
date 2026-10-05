/**
 * The one door an advert goes through on its way to a model (L-208).
 *
 * L-205 taught the scorers to ignore a cookie notice, an equal-opportunities
 * statement and an agency footer. The same words cost a model tokens and dilute
 * its reading, so every prompt that uses the advert as CONTEXT gets it through
 * here: analysis, tailor, cover letter, review, follow-up, interview.
 *
 * One function, so the paths cannot drift. `lib/advert-boilerplate.contract.test.ts`
 * fails when a `run*.ts` module sends an advert without calling it.
 *
 * Applied once per action, at the app layer (`@cviper/ai-providers` has no
 * runtime dependency on the scorer). The raw text stays wherever it is stored
 * or shown. NOT used for job extraction: that reads company, location and
 * salary out of the text, and a footer can be the only place they appear.
 *
 * Pure and deterministic; an advert with nothing to strip comes back
 * byte-for-byte.
 */
import { stripJobBoilerplate } from '@cviper/keyword-scoring';

export function advertForModel(advert: string): string {
  return stripJobBoilerplate(advert);
}
