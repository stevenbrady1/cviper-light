/**
 * The skills-gap heatmap: what the adverts on the board ask for that the CV
 * does not say.
 *
 * ============================================================================
 * KEYLESS, AND THE SAME SCANNER AS THE MATCH SCORE
 * ============================================================================
 * Pure and synchronous. Both halves come from `@cviper/keyword-scoring`, so
 * this view can never disagree with the Analysis screen about whether a word
 * is present: `buildJobPosting` names the skills an advert states (the
 * `common_skills` vocabulary, for the reason given in that function), and
 * `cvCoversTerm` decides whether the CV credits one — direct mention, lexicon
 * synonym, or a US/UK spelling variant.
 *
 * ============================================================================
 * NO CV MEANS NOTHING IS COVERED, NOT "UNKNOWN"
 * ============================================================================
 * With `cvText: null` every skill an advert names is a gap. That is the honest
 * reading: the question is "what do these adverts ask for that my CV does not
 * mention", and a CV that does not exist mentions nothing. The panel chooses
 * not to SHOW that list — it tells the user to upload a CV instead — but the
 * function's answer stays true so a caller cannot mistake an absent CV for a
 * full one.
 *
 * ============================================================================
 * THE DENOMINATOR
 * ============================================================================
 * `share` is over the adverts that HAVE a description. A job saved by hand
 * with only a title and a company has no text to scan, and counting it would
 * make every share smaller for no reason the user can see. `describedJobs` is
 * exported so the panel's "3 of 7 adverts" uses the same 7.
 */
import { type Job } from '@cviper/core-types';
import { MAX_TEXT_LENGTH, buildJobPosting, cvCoversTerm } from '@cviper/keyword-scoring';

/**
 * How many rows the panel shows. Past this the list stops being a heatmap and
 * becomes the lexicon; the summary line says the list is the most-wanted
 * skills rather than all of them.
 */
export const MAX_GAPS = 25;

export interface SkillGap {
  /** The lexicon term, lowercase as the scanner has it. Cased for display by the panel. */
  readonly skill: string;
  /** How many adverts with a description name this skill. */
  readonly wantedBy: number;
  /** `wantedBy` over the number of adverts with a description: 0..1. */
  readonly share: number;
}

export interface SkillGapsInput {
  /** The CV's extracted text, or `null` when there is no CV. */
  readonly cvText: string | null;
  /** The jobs on the board. Any without a description are ignored. */
  readonly jobs: readonly Job[];
}

/** The jobs whose description has something to scan. */
export function describedJobs(jobs: readonly Job[]): Job[] {
  return jobs.filter((job) => job.description !== null && job.description.trim() !== '');
}

/**
 * The skills the adverts name that the CV does not cover, most wanted first,
 * ties broken by name, capped at `MAX_GAPS`.
 */
export function skillGaps({ cvText, jobs }: SkillGapsInput): SkillGap[] {
  const described = describedJobs(jobs);
  if (described.length === 0) return [];

  const cvLower = (cvText ?? '').slice(0, MAX_TEXT_LENGTH).toLowerCase();

  // Coverage is a property of the CV and the skill, not of the advert, so it
  // is decided once per skill however many adverts name it. `cvCoversTerm`
  // folds the whole CV on every call; without this a board of thirty adverts
  // would fold a 50,000-character document several hundred times.
  const covered = new Map<string, boolean>();
  const cvCovers = (skill: string): boolean => {
    const known = covered.get(skill);
    if (known !== undefined) return known;
    const answer = cvCoversTerm(skill, cvLower);
    covered.set(skill, answer);
    return answer;
  };

  const wantedBy = new Map<string, number>();
  for (const job of described) {
    // `keySkills` is already one entry per term, so an advert that repeats a
    // skill five times contributes one. The Set is belt and braces against a
    // future scanner that stops de-duplicating.
    const named = new Set(buildJobPosting(job.description ?? '').keySkills);
    for (const skill of named) {
      if (cvCovers(skill)) continue;
      wantedBy.set(skill, (wantedBy.get(skill) ?? 0) + 1);
    }
  }

  const gaps: SkillGap[] = [];
  for (const [skill, count] of wantedBy) {
    gaps.push({ skill, wantedBy: count, share: count / described.length });
  }

  gaps.sort(
    (a, b) => b.wantedBy - a.wantedBy || (a.skill < b.skill ? -1 : a.skill > b.skill ? 1 : 0),
  );
  return gaps.slice(0, MAX_GAPS);
}

/** "this advert" / "these 7 adverts". */
function adverts(jobCount: number): string {
  return jobCount === 1 ? 'this advert' : `these ${jobCount} adverts`;
}

/**
 * The one-line summary above the rows.
 *
 * `jobCount` is the number of adverts with a description — the same
 * denominator as `share` — not the number of cards on the board.
 */
export function describeGaps(gaps: readonly SkillGap[], jobCount: number): string {
  if (jobCount === 0) return 'None of the adverts on your tracker has a description.';
  if (gaps.length === 0) {
    return `Your CV mentions every skill ${adverts(jobCount)} ${jobCount === 1 ? 'names' : 'name'}.`;
  }
  if (gaps.length >= MAX_GAPS) {
    return `The ${MAX_GAPS} skills ${adverts(jobCount)} ask for most that your CV does not mention.`;
  }
  const skills = gaps.length === 1 ? '1 skill' : `${gaps.length} skills`;
  const ask = jobCount === 1 ? 'asks' : 'ask';
  return `${skills} ${adverts(jobCount)} ${ask} for that your CV does not mention.`;
}
