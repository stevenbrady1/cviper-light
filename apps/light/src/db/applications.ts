/**
 * Applications — the pipeline state of a job the user is actually chasing.
 *
 * Every function returns a `Result`; nothing here throws.
 */
import {
  ok,
  type Application,
  type ApplicationStatus,
  type IsoDate,
  type Result,
} from '@cviper/core-types';

import { withDb } from './client';
import { type DbError } from './errors';
import { applicationFromRow, applicationToValues, mapRows } from './rows';
import { deleteFrom, selectFrom, upsertInto } from './statements';

const TABLE = 'applications';

const LIST = `${selectFrom(TABLE)} ORDER BY updated_at DESC, id`;
const LIST_BY_STATUS = `${selectFrom(TABLE)} WHERE status = $1 ORDER BY updated_at DESC, id`;

/**
 * `next_action_date IS NOT NULL` is NOT redundant next to `<= $1`.
 *
 * It is what lets SQLite use the partial index
 * `idx_applications_next_action_date`, whose WHERE clause it has to match. It
 * also states the intent: an application with no next action is not "overdue",
 * it is simply not in this view.
 *
 * The comparison is a plain string comparison, which is only correct because
 * dates are `YYYY-MM-DD` throughout — fixed width, zero padded, so codepoint
 * order and calendar order are the same. This is the convention paying for
 * itself; a `DD/MM/YYYY` column would sort by day of the month.
 */
const LIST_DUE_BY =
  `${selectFrom(TABLE)} WHERE next_action_date IS NOT NULL AND next_action_date <= $1 ` +
  `ORDER BY next_action_date, id`;

const GET = `${selectFrom(TABLE)} WHERE id = $1`;
const UPSERT = upsertInto(TABLE);
const DELETE = deleteFrom(TABLE);

export async function listApplications(): Promise<Result<Application[], DbError>> {
  const rows = await withDb((db) => db.select<unknown[]>(LIST), TABLE);
  return rows.ok ? mapRows(rows.value, applicationFromRow) : rows;
}

/** One board column. Backed by `idx_applications_status`. */
export async function listApplicationsByStatus(
  status: ApplicationStatus,
): Promise<Result<Application[], DbError>> {
  const rows = await withDb((db) => db.select<unknown[]>(LIST_BY_STATUS, [status]), TABLE);
  return rows.ok ? mapRows(rows.value, applicationFromRow) : rows;
}

/** Everything with a next action due on or before `date` (`YYYY-MM-DD`). */
export async function listApplicationsDueBy(
  date: IsoDate,
): Promise<Result<Application[], DbError>> {
  const rows = await withDb((db) => db.select<unknown[]>(LIST_DUE_BY, [date]), TABLE);
  return rows.ok ? mapRows(rows.value, applicationFromRow) : rows;
}

export async function getApplication(id: string): Promise<Result<Application | null, DbError>> {
  const rows = await withDb((db) => db.select<unknown[]>(GET, [id]), TABLE);
  if (!rows.ok) return rows;

  const applications = mapRows(rows.value, applicationFromRow);
  if (!applications.ok) return applications;

  return ok(applications.value[0] ?? null);
}

/**
 * Insert, or replace the application with the same id.
 *
 * `job_id` must already exist: the foreign key is enforced, so an application
 * for a job that was never saved comes back as `CONSTRAINT_VIOLATION` rather
 * than becoming an orphan row that no view can render.
 */
export async function upsertApplication(application: Application): Promise<Result<void, DbError>> {
  const written = await withDb((db) => db.execute(UPSERT, applicationToValues(application)), TABLE);
  return written.ok ? ok(undefined) : written;
}

export async function deleteApplication(id: string): Promise<Result<void, DbError>> {
  const deleted = await withDb((db) => db.execute(DELETE, [id]), TABLE);
  return deleted.ok ? ok(undefined) : deleted;
}
