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
  searchJobs,
  type JobSearchOutcome,
  type JobSearchRequest,
  type JobSearchTransport,
} from '@cviper/job-apis';
import { ok, type Application, type IsoTimestamp, type Job, type Result } from '@cviper/core-types';

import {
  findJobByExternalId,
  listApplications,
  listJobs,
  upsertApplication,
  upsertJob,
  type DbError,
} from '../../db';
import { createTauriJobTransport } from '../../jobs/transport';

import { externalKey } from './model';

/** What happened when the user pressed Save. Neither of these is a failure. */
export type SaveOutcome = 'saved' | 'already-saved';

export interface SearchPort {
  /** Run one search. Never rejects: each board succeeds or fails on its own. */
  search(request: JobSearchRequest): Promise<JobSearchOutcome>;
  /** `source:external_id` for every advert already on the tracker board. */
  loadTracked(): Promise<Result<ReadonlySet<string>, DbError>>;
  /** Add an advert and the application chasing it. */
  saveToTracker(
    job: Job,
    ids: { readonly applicationId: string },
    now: IsoTimestamp,
  ): Promise<Result<SaveOutcome, DbError>>;
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

export function createDbSearchPort(transport?: JobSearchTransport): SearchPort {
  // Built once per port. `createTauriJobTransport` is cheap, but a new one per
  // search would be a new object identity in every dependency array above.
  const jobTransport = transport ?? createTauriJobTransport();

  return {
    search(request) {
      return searchJobs(jobTransport, request);
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

    async saveToTracker(job, ids, now) {
      if (job.external_id !== null) {
        const existing = await findJobByExternalId(job.source, job.external_id);
        // A lookup that failed is NOT "it is not there". Writing on that
        // assumption is how the constraint violation gets in front of a user.
        if (!existing.ok) return existing;

        if (existing.value !== null) {
          const applications = await listApplications();
          if (!applications.ok) return applications;

          const already = applications.value.some(
            (application) => application.job_id === existing.value?.id,
          );
          if (already) return ok('already-saved');

          // The advert is in the database but on nobody's board — an import,
          // usually. Chase the EXISTING row: writing the fresh id from this
          // search is exactly what trips the unique index.
          const created = await upsertApplication(
            newApplication(existing.value.id, ids.applicationId, now),
          );
          return created.ok ? ok('saved') : created;
        }
      }

      // JOB FIRST. `applications.job_id` has a foreign key onto `jobs.id` and
      // foreign keys are enforced (see `db/client.ts`), so the other order is a
      // guaranteed constraint violation rather than a race.
      const written = await upsertJob(job);
      if (!written.ok) {
        // The backstop, and ONLY for the duplicate. Another window inserted the
        // same advert between our lookup and this write.
        if (written.error.code === 'CONSTRAINT_VIOLATION') return ok('already-saved');
        return written;
      }

      const created = await upsertApplication(newApplication(job.id, ids.applicationId, now));
      return created.ok ? ok('saved') : created;
    },
  };
}
