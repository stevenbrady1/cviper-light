/**
 * The five things the tailor view does to storage, and nothing else.
 *
 * Same reasoning as `features/analysis/port.ts`: `src/db` talks to
 * `tauri-plugin-sql`, which needs a Tauri runtime a Vitest process does not
 * have, so a component that reached into it directly could only be tested by
 * pretending to be SQLite. And naming the view's whole appetite for storage
 * in one place means adding a sixth call is a decision somebody makes on
 * purpose.
 *
 * Nothing here WRITES a CV row or a job: the tailor reads what the Analysis
 * and Tracker screens saved, and the only thing it writes is a `Document`
 * archived against an application (L-155) — the tailored CV, the letter.
 */
import {
  getProfile,
  listApplications,
  listCvs,
  listDocumentsForApplication,
  listJobs,
  upsertDocument,
  type DbError,
} from '../../db';
import {
  ok,
  type Application,
  type Cv,
  type Document,
  type Job,
  type Profile,
  type Result,
} from '@cviper/core-types';

export interface TailorPort {
  /** Every CV the user has uploaded, newest first. */
  loadCvs(): Promise<Result<Cv[], DbError>>;
  /** Every job on the tracker board, so a saved advert can be reused. */
  loadJobs(): Promise<Result<Job[], DbError>>;
  /** The applications chasing ONE job — where a tailored CV can be archived. */
  loadApplicationsFor(jobId: string): Promise<Result<Application[], DbError>>;
  /** The candidate profile, or `null` if there has never been one. */
  profile(): Promise<Result<Profile | null, DbError>>;
  /** Archive a document against an application. */
  saveDocument(document: Document): Promise<Result<void, DbError>>;
  /** What is already archived against an application, newest first. */
  loadDocumentsFor(applicationId: string): Promise<Result<Document[], DbError>>;
}

export function createDbTailorPort(): TailorPort {
  return {
    loadCvs: listCvs,
    loadJobs: listJobs,
    async loadApplicationsFor(jobId) {
      // There is no `listApplicationsForJob` in `src/db`, and one job has a
      // handful of applications at most: filtering the board here keeps the
      // data layer's query list short.
      const all = await listApplications();
      if (!all.ok) return all;
      return ok(all.value.filter((application) => application.job_id === jobId));
    },
    profile: getProfile,
    saveDocument: upsertDocument,
    loadDocumentsFor: listDocumentsForApplication,
  };
}
