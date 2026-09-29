/**
 * The three things the search screen does to the outside world, and nothing
 * else.
 *
 * ============================================================================
 * WHY A PORT AND NOT DIRECT CALLS INTO `src/db`
 * ============================================================================
 * Same two reasons as the tracker's. `src/db` talks to `tauri-plugin-sql`,
 * which needs a Tauri runtime a Vitest process does not have — and naming the
 * screen's whole appetite for storage in one place gives somebody a moment to
 * ask whether it should really be doing that.
 *
 * No SQL, and no SQL-shaped thinking, reaches a component.
 *
 * ============================================================================
 * SAVING THE SAME ADVERT TWICE IS NOT AN ERROR
 * ============================================================================
 * A search builds a fresh UUID for every advert it normalises, so the same
 * advert saved on Monday and again on Thursday is two rows with two different
 * ids and one `(source, external_id)`. That trips the partial unique index and
 * comes back as `CONSTRAINT_VIOLATION` — which is correct, and which is a
 * sentence about a database index that no user should ever be shown.
 *
 * So this looks the advert up first and reports `already-saved`. The constraint
 * is not removed and not absorbed anywhere else: it stays as the backstop for
 * the one race the lookup cannot close, two windows saving the same advert
 * between the SELECT and the INSERT. Only `CONSTRAINT_VIOLATION` is turned into
 * `already-saved`; every other failure is still reported, because telling
 * somebody their advert is on the board when the database would not open is a
 * far worse lie than a database error.
 */
import {
  browseKeylessJobs,
  searchJobs,
  type JobSearchOutcome,
  type JobSearchRequest,
  type JobSearchTransport,
  type KeylessBrowseOutcome,
  type KeylessBrowseRequest,
  type KeylessFetchTransport,
} from '@cviper/job-apis';
import { ok, type Application, type IsoTimestamp, type Job, type Result } from '@cviper/core-types';

import {
  findJobByExternalId,
  getProfile,
  listApplications,
  listCvs,
  listJobs,
  upsertApplication,
  upsertJob,
  type DbError,
} from '../../db';
import { createTauriJobTransport } from '../../jobs/transport';
import { createTauriKeylessTransport } from '../../jobs/keylessTransport';
import { fetchFullAdvert } from '../flow/advert';
import { createTauriPageTransport, type PageFetchTransport } from '../tracker/pageFetch';

import { externalKey } from './model';

/** What happened when the user pressed Save. Neither of these is a failure. */
export type SaveOutcome = 'saved' | 'already-saved';

/**
 * What a save left in the database — the STORED job, not the one passed in.
 *
 * ============================================================================
 * WHY THE JOB COMES BACK (L-190)
 * ============================================================================
 * "Analyse this job" saves the advert and then attaches the analysis, the
 * tailored CV and the cover letter to it. When the advert was already saved,
 * the stored row carries a DIFFERENT id from the fresh UUID this search gave
 * it, so anything keyed on the search's copy would point at a job that is not
 * in the database. The caller gets the row that is.
 */
export interface SavedToTracker {
  readonly outcome: SaveOutcome;
  readonly job: Job;
  /**
   * The application chasing that job. `null` only in the one race described
   * in `saveToTracker`: another window wrote the job and has not yet written
   * its application.
   */
  readonly applicationId: string | null;
}

/** A job with the best advert text there is, and the sentence to show beside it. */
export interface FullAdvertRead {
  readonly job: Job;
  /** Safe to show verbatim; `null` when the job now carries the whole advert. */
  readonly note: string | null;
}

export interface SearchPort {
  /** Run one search. Never rejects: each board succeeds or fails on its own. */
  search(request: JobSearchRequest): Promise<JobSearchOutcome>;
  /**
   * Read the keyless feeds and narrow them on this machine (L-110).
   *
   * A SEPARATE METHOD, not a flag on `search`. The two spend different things:
   * a search spends one of Reed's hundred daily requests and needs a key that
   * may not exist, while a browse spends nothing and needs nothing. Folding
   * them together would mean one call site deciding, per provider, which of
   * those two it was doing.
   *
   * Never rejects: each feed succeeds or fails on its own, and a feed that
   * failed comes back as a message rather than as an absence.
   */
  browseKeyless(request: KeylessBrowseRequest): Promise<KeylessBrowseOutcome>;
  /** `source:external_id` for every advert already on the tracker board. */
  loadTracked(): Promise<Result<ReadonlySet<string>, DbError>>;
  /**
   * The text of the most recent CV, for ranking results against (L-157).
   *
   * `null` when there is no CV, or the newest one has no extracted text yet —
   * both mean "nothing to rank against", and neither is an error. Read once
   * when the screen opens; the ranking itself runs on this machine and touches
   * nothing outside the process.
   */
  latestCvText(): Promise<Result<string | null, DbError>>;
  /** The profile's deal-breakers, or `[]` when no profile has been saved. */
  dealBreakers(): Promise<Result<string[], DbError>>;
  /** Add an advert and the application chasing it. */
  saveToTracker(
    job: Job,
    ids: { readonly applicationId: string },
    now: IsoTimestamp,
  ): Promise<Result<SavedToTracker, DbError>>;
  /**
   * Bring in the full advert for a job whose search result was only a preview
   * (L-190), and write it onto the stored job.
   *
   * Reads ONE page — the job's own — and only when the stored text is a
   * preview; see `flow/advert.ts`. Never rejects: a page that cannot be read
   * leaves the job as it was and comes back with a note saying what to do.
   */
  readFullAdvert(job: Job): Promise<FullAdvertRead>;
}

/**
 * A brand-new application, at the start of the pipeline.
 *
 * `applied_date` stays `null`. Saving an advert to read later is not applying
 * for it, and stamping a date here would put a false fact on the card the
 * moment it appeared — the tracker sets it when the user says they applied
 * (see `withStatus` in `features/tracker/model.ts`).
 */
function newApplication(jobId: string, applicationId: string, now: IsoTimestamp): Application {
  return {
    id: applicationId,
    job_id: jobId,
    status: 'saved',
    applied_date: null,
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: now,
  };
}

/** The first application chasing this job, or `null`. */
async function applicationFor(jobId: string): Promise<Result<string | null, DbError>> {
  const applications = await listApplications();
  if (!applications.ok) return applications;
  return ok(applications.value.find((application) => application.job_id === jobId)?.id ?? null);
}

export function createDbSearchPort(
  transport?: JobSearchTransport,
  keylessTransport?: KeylessFetchTransport,
  createPageTransport: () => PageFetchTransport = createTauriPageTransport,
): SearchPort {
  // Built once per port. `createTauriJobTransport` is cheap, but a new one per
  // search would be a new object identity in every dependency array above.
  const jobTransport = transport ?? createTauriJobTransport();
  // The keyless one is built here too, and is a DIFFERENT object reaching a
  // DIFFERENT Rust command — the one that cannot reach the credential store.
  const feedTransport = keylessTransport ?? createTauriKeylessTransport();

  return {
    search(request) {
      return searchJobs(jobTransport, request);
    },

    browseKeyless(request) {
      return browseKeylessJobs(feedTransport, request);
    },

    async loadTracked() {
      const jobs = await listJobs();
      if (!jobs.ok) return jobs;

      const applications = await listApplications();
      if (!applications.ok) return applications;

      // A job row with no application is not on the board. It can only come
      // from an import, and the card should still offer to save it.
      const chased = new Set(applications.value.map((application) => application.job_id));

      const tracked = new Set<string>();
      for (const job of jobs.value) {
        if (!chased.has(job.id)) continue;
        const key = externalKey(job.source, job.external_id);
        if (key !== null) tracked.add(key);
      }
      return ok(tracked);
    },

    async latestCvText() {
      // `listCvs` orders by `created_at DESC`, so the first row is the newest.
      // One ordering rule, in the data layer — not a second one here that
      // happens to agree with it today.
      const cvs = await listCvs();
      if (!cvs.ok) return cvs;
      return ok(cvs.value[0]?.extracted_text ?? null);
    },

    async dealBreakers() {
      const profile = await getProfile();
      if (!profile.ok) return profile;
      return ok(profile.value?.deal_breakers ?? []);
    },

    async saveToTracker(job, ids, now) {
      if (job.external_id !== null) {
        const existing = await findJobByExternalId(job.source, job.external_id);
        // A lookup that failed is NOT "it is not there". Writing on that
        // assumption is how the constraint violation gets in front of a user.
        if (!existing.ok) return existing;

        if (existing.value !== null) {
          const stored = existing.value;
          const chasing = await applicationFor(stored.id);
          if (!chasing.ok) return chasing;

          if (chasing.value !== null) {
            return ok({ outcome: 'already-saved', job: stored, applicationId: chasing.value });
          }

          // The advert is in the database but on nobody's board — an import,
          // usually. Chase the EXISTING row: writing the fresh id from this
          // search is exactly what trips the unique index.
          const created = await upsertApplication(
            newApplication(stored.id, ids.applicationId, now),
          );
          return created.ok
            ? ok({ outcome: 'saved', job: stored, applicationId: ids.applicationId })
            : created;
        }
      }

      // JOB FIRST. `applications.job_id` has a foreign key onto `jobs.id` and
      // foreign keys are enforced (see `db/client.ts`), so the other order is a
      // guaranteed constraint violation rather than a race.
      const written = await upsertJob(job);
      if (!written.ok) {
        // The backstop, and ONLY for the duplicate. Another window inserted the
        // same advert between our lookup and this write — so look up the row it
        // wrote, and hand THAT back (L-190). If it cannot be found, the write's
        // own failure is reported: the fresh id is not in the database, and
        // handing it on would attach an analysis to a job that does not exist.
        if (written.error.code === 'CONSTRAINT_VIOLATION' && job.external_id !== null) {
          const raced = await findJobByExternalId(job.source, job.external_id);
          if (!raced.ok) return raced;
          if (raced.value === null) return written;

          const chasing = await applicationFor(raced.value.id);
          if (!chasing.ok) return chasing;
          return ok({ outcome: 'already-saved', job: raced.value, applicationId: chasing.value });
        }
        return written;
      }

      const created = await upsertApplication(newApplication(job.id, ids.applicationId, now));
      return created.ok ? ok({ outcome: 'saved', job, applicationId: ids.applicationId }) : created;
    },

    async readFullAdvert(job) {
      const full = await fetchFullAdvert(job, createPageTransport);
      if (full.text === (job.description ?? '')) return { job, note: full.note };

      // The tracker keeps the whole advert too, so the next visit — and the
      // tailor screen — read it rather than the preview.
      //
      // A failed write FALLS BACK rather than failing the analysis: the whole
      // advert is still handed on, and is on screen in the advert box where
      // the user can read it. What is lost is only the tracker's copy, which
      // keeps the preview it already had — and the next Analyse reads the
      // page again, because the stored text still looks like a preview.
      const better: Job = { ...job, description: full.text };
      await upsertJob(better);
      return { job: better, note: full.note };
    },
  };
}
