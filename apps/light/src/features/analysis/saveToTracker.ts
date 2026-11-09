/**
 * "Save this job to the tracker" (L-325): the rules, with no React in sight.
 *
 * A check on a PASTED advert belongs to no tracked job, so it gets no step bar
 * and Tailor has to be given the advert again. Saving it makes it one, through
 * the tracker's own `createEntry` and `validateDraft` — the same rows, limits
 * and messages as adding a job on the board, and no new SQL.
 *
 * NO GUESSING. The title and company are typed by the user. Reading them off
 * the advert's first line would be wrong often enough to be worse than an
 * empty box, and wrong invisibly (see "NO REGEX FALLBACK" in `PasteJobForm`).
 * The same goes for spotting a duplicate: only an advert that is the SAME text
 * as a tracked job's counts. Anything looser would attach this check to
 * someone else's advert.
 */
import { type IsoTimestamp, type Job } from '@cviper/core-types';

import {
  createEntry,
  draftIsValid,
  EMPTY_DRAFT,
  validateDraft,
  type DraftErrors,
  type TrackerEntry,
} from '../tracker/model';

import { jobAdvertText } from './model';

/** Whether to offer the save: a checked advert with words in it, not yet a tracked job. */
export function canOfferSave(checkedAdvert: string | null, jobId: string | null): boolean {
  return jobId === null && checkedAdvert !== null && checkedAdvert.trim() !== '';
}

/**
 * The tracked job this advert already is, or `null`.
 *
 * Exact text only, once the paste's outer whitespace is gone: the job's own
 * description, or the whole advert as Analysis shows a tracked job.
 */
export function trackedJobForAdvert(advert: string, jobs: readonly Job[]): Job | null {
  const text = advert.trim();
  if (text === '') return null;
  return (
    jobs.find(
      (job) =>
        (job.description !== null && job.description.trim() === text) ||
        jobAdvertText(job) === text,
    ) ?? null
  );
}

/** What the user typed. */
export interface TrackerFields {
  readonly title: string;
  readonly company: string;
}

export type TrackerEntryBuild =
  | { readonly ok: true; readonly entry: TrackerEntry }
  | { readonly ok: false; readonly errors: DraftErrors };

/**
 * The job and Saved application for this advert, or what is wrong with it.
 *
 * Everything but the title and company comes from the advert: it is the
 * description, the source is `manual` and the card starts in Saved.
 */
export function trackerEntryForAdvert(
  fields: TrackerFields,
  advert: string,
  ids: { readonly jobId: string; readonly applicationId: string },
  now: IsoTimestamp,
): TrackerEntryBuild {
  const draft = {
    ...EMPTY_DRAFT,
    title: fields.title,
    company: fields.company,
    description: advert,
    status: 'saved' as const,
  };
  const errors = validateDraft(draft);
  if (!draftIsValid(errors)) return { ok: false, errors };
  return { ok: true, entry: createEntry(draft, ids, now) };
}
