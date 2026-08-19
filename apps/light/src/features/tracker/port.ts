/**
 * The four things the tracker does to storage, and nothing else.
 *
 * ============================================================================
 * WHY A PORT AND NOT DIRECT CALLS INTO `src/db`
 * ============================================================================
 * Two reasons, and the second is the important one.
 *
 * 1. The board can be tested. `src/db` talks to `tauri-plugin-sql`, which needs
 *    a Tauri runtime that a Vitest process does not have. A component that
 *    imports it directly can only be tested by mocking a SQL driver and
 *    pretending to be SQLite, which tests the mock.
 *
 * 2. It names the tracker's whole appetite for storage IN ONE PLACE. Four
 *    methods, listed here. When somebody adds a fifth, they have to add it here
 *    first, which is a moment to ask whether the board should really be doing
 *    that. Scattered `upsertApplication` calls across six components have no
 *    such moment.
 *
 * No SQL, and no SQL-shaped thinking, reaches a component: everything above
 * this file works in `TrackerEntry`s and `Result`s.
 */
import {
  deleteJob,
  listApplications,
  listJobs,
  upsertApplication,
  upsertJob,
  type DbError,
} from '../../db';
import { ok, type Application, type Result } from '@cviper/core-types';

import { joinEntries, type TrackerEntry } from './model';

export interface TrackerPort {
  /** Every application on the board, paired with its job. */
  load(): Promise<Result<TrackerEntry[], DbError>>;
  /** Add a new job and the application chasing it. */
  create(entry: TrackerEntry): Promise<Result<void, DbError>>;
  /** Save an edited application. */
  saveApplication(application: Application): Promise<Result<void, DbError>>;
  /** Remove an application and the job it belongs to. */
  remove(entry: TrackerEntry): Promise<Result<void, DbError>>;
}

export function createDbTrackerPort(): TrackerPort {
  return {
    async load() {
      const jobs = await listJobs();
      if (!jobs.ok) return jobs;

      const applications = await listApplications();
      if (!applications.ok) return applications;

      return ok(joinEntries(jobs.value, applications.value));
    },

    async create(entry) {
      // JOB FIRST. `applications.job_id` has a foreign key onto `jobs.id` and
      // foreign keys are enforced (see `db/client.ts`), so the other order is a
      // guaranteed CONSTRAINT_VIOLATION rather than a race.
      const job = await upsertJob(entry.job);
      if (!job.ok) return job;

      return upsertApplication(entry.application);
    },

    saveApplication(application) {
      return upsertApplication(application);
    },

    remove(entry) {
      // Deleting the JOB, not the application. `applications.job_id` is
      // `ON DELETE CASCADE` (0001_init.sql), so one statement removes both and
      // there is no window in which a job sits there with nothing pointing at
      // it. Deleting the application alone would leave an invisible orphan row
      // that nothing in the app can ever reach or clean up.
      return deleteJob(entry.job.id);
    },
  };
}
