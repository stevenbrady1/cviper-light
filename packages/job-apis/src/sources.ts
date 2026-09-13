/**
 * What each job source is called on screen.
 *
 * ============================================================================
 * EXHAUSTIVE, BECAUSE THE ALTERNATIVE FAILED SILENTLY
 * ============================================================================
 * The result card derived its source chip with
 * `job.source === 'adzuna' ? 'adzuna' : 'reed'`. That was correct while there
 * were exactly two boards, and the day a third arrived it labelled every advert
 * from it "Reed" — a wrong attribution on screen, on a card whose whole job is
 * to say where the advert came from, and one no test would have caught because
 * nothing was undefined and nothing threw.
 *
 * A `Record<JobSource, string>` cannot do that: adding a member to `JobSource`
 * without adding a name here is a compile error.
 *
 * `PROVIDER_LABEL` in `errors.ts` stays as it is. It is keyed by
 * `JobProviderId` — the two boards that can be SEARCHED with a key — and is
 * used where the code means "a provider", not "wherever this advert came
 * from". Two maps because there are genuinely two questions.
 */
import { type JobSource } from '@cviper/core-types';

export const SOURCE_LABEL: Readonly<Record<JobSource, string>> = {
  adzuna: 'Adzuna',
  reed: 'Reed',
  arbeitnow: 'Arbeitnow',
  guardian: 'Guardian Jobs',
  manual: 'Added by you',
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
};
