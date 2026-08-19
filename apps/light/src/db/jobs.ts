/**
 * Jobs — adverts the user has saved, from a provider or entered by hand.
 *
 * Every function returns a `Result`; nothing here throws.
 */
import { ok, type Job, type Result } from '@cviper/core-types';

import { withDb } from './client';
import { type DbError } from './errors';
import { jobFromRow, jobToValues, mapRows } from './rows';
import { deleteFrom, selectFrom, upsertInto } from './statements';

const TABLE = 'jobs';

// Newest first, with `id` as a tie-break so two jobs saved in the same
// millisecond do not swap places between renders.
const LIST = `${selectFrom(TABLE)} ORDER BY created_at DESC, id`;
const GET = `${selectFrom(TABLE)} WHERE id = $1`;
const UPSERT = upsertInto(TABLE);
const DELETE = deleteFrom(TABLE);

export async function listJobs(): Promise<Result<Job[], DbError>> {
  const rows = await withDb((db) => db.select<unknown[]>(LIST), TABLE);
  return rows.ok ? mapRows(rows.value, jobFromRow) : rows;
}

/** The job with this id, or `null`. A missing row is an answer, not a failure. */
export async function getJob(id: string): Promise<Result<Job | null, DbError>> {
  const rows = await withDb((db) => db.select<unknown[]>(GET, [id]), TABLE);
  if (!rows.ok) return rows;

  const jobs = mapRows(rows.value, jobFromRow);
  if (!jobs.ok) return jobs;

  return ok(jobs.value[0] ?? null);
}

/**
 * Insert, or replace the job with the same id.
 *
 * The same advert arriving again under a DIFFERENT id trips the partial unique
 * index on `(source, external_id)` and comes back as `CONSTRAINT_VIOLATION`.
 * That is the free half of duplicate detection, and it is meant to be visible
 * to the caller rather than absorbed here.
 */
export async function upsertJob(job: Job): Promise<Result<void, DbError>> {
  const written = await withDb((db) => db.execute(UPSERT, jobToValues(job)), TABLE);
  return written.ok ? ok(undefined) : written;
}

/** Deleting a job cascades to its applications (see `0001_init.sql`). */
export async function deleteJob(id: string): Promise<Result<void, DbError>> {
  const deleted = await withDb((db) => db.execute(DELETE, [id]), TABLE);
  return deleted.ok ? ok(undefined) : deleted;
}
