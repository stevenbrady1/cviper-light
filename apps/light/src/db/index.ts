/**
 * The data-access layer for CViper Light.
 *
 * The rules that hold across every export here:
 *
 *   * **Nothing throws.** Everything returns `Result<T, DbError>` from
 *     `@cviper/core-types`, so a caller that forgets the failure path is a
 *     compile error rather than an unhandled rejection.
 *   * **All coercion happens in `rows.ts`.** Nothing above this layer sees a
 *     SQLite value, a JSON string, or a raw row.
 *   * **All access is serialised through `withDb`.** `backup.ts` depends on it
 *     for transaction atomicity — see the note at the top of `client.ts`.
 *   * **Ids are UUIDs from `crypto.randomUUID()`**, made by the caller. Nothing
 *     in this layer invents an id.
 */
export { DB_URL } from './constants';
export { getDb, withDb } from './client';
export { dbError, type DbError, type DbErrorCode } from './errors';
export {
  ANALYSIS_COLUMNS,
  APPLICATION_COLUMNS,
  CV_COLUMNS,
  JOB_COLUMNS,
  TABLE_COLUMNS,
  type SqlValue,
  type TableName,
} from './rows';

export { findJobByExternalId, getJob, listJobs, upsertJob, deleteJob } from './jobs';
export {
  getApplication,
  listApplications,
  listApplicationsByStatus,
  listApplicationsDueBy,
  upsertApplication,
  deleteApplication,
} from './applications';
export { getCv, listCvs, upsertCv, deleteCv } from './cvs';
export {
  getAnalysis,
  listAnalyses,
  listAnalysesForCv,
  upsertAnalysis,
  deleteAnalysis,
} from './analyses';
export { readAll, writeAll, type DbSnapshot } from './backup';
