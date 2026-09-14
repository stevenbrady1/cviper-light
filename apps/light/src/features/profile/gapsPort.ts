/**
 * The one thing the skills-gap panel does to storage: read.
 *
 * Same reasoning as `port.ts` beside it — `src/db` needs a Tauri runtime a
 * Vitest process does not have, and naming the appetite in one place keeps it
 * small. This one is smaller still: the panel writes nothing, ever.
 *
 * ============================================================================
 * ONLY THE JOBS ON THE BOARD
 * ============================================================================
 * `jobs` is every row in the table, and the table also holds search results
 * the user looked at and never saved. The question the panel answers is about
 * the adverts the user is CHASING, so the set is the tracker's — jobs an
 * application points at — via the same `joinEntries` the board itself uses.
 * A search result that happens to be in the table is not an application.
 */
import { ok, type Job, type Result } from '@cviper/core-types';

import { listApplications, listCvs, listJobs, type DbError } from '../../db';
import { joinEntries } from '../tracker/model';

export interface GapsSource {
  /**
   * The newest CV's extracted text, or `null` when no CV has text. A CV whose
   * parse has not run yet has `null` text; it does not hide an older CV that
   * has some, because the panel would then say "upload a CV" to someone who
   * has uploaded two.
   */
  readonly cvText: string | null;
  /** The jobs an application points at. */
  readonly jobs: Job[];
}

export interface GapsPort {
  load(): Promise<Result<GapsSource, DbError>>;
}

export function createDbGapsPort(): GapsPort {
  return {
    async load() {
      // `listCvs` is `ORDER BY created_at DESC`, so the first with text is the newest with text.
      const cvs = await listCvs();
      if (!cvs.ok) return cvs;

      const jobs = await listJobs();
      if (!jobs.ok) return jobs;

      const applications = await listApplications();
      if (!applications.ok) return applications;

      const cvText = cvs.value.find((cv) => cv.extracted_text !== null)?.extracted_text ?? null;
      return ok({
        cvText,
        jobs: joinEntries(jobs.value, applications.value).map((entry) => entry.job),
      });
    },
  };
}
