/**
 * CVs — the documents the user analyses against jobs.
 *
 * `file_path` is a path on THIS machine and nothing more; the file itself is
 * never copied into the database. `extracted_text` is `null` until parsing has
 * run, which is why a CV row is useful before it is readable.
 *
 * Every function returns a `Result`; nothing here throws.
 */
import { ok, type Cv, type Result } from '@cviper/core-types';

import { withDb } from './client';
import { type DbError } from './errors';
import { cvFromRow, cvToValues, mapRows } from './rows';
import { deleteFrom, selectFrom, upsertInto } from './statements';

const TABLE = 'cvs';

const LIST = `${selectFrom(TABLE)} ORDER BY created_at DESC, id`;
const GET = `${selectFrom(TABLE)} WHERE id = $1`;
const UPSERT = upsertInto(TABLE);
const DELETE = deleteFrom(TABLE);

export async function listCvs(): Promise<Result<Cv[], DbError>> {
  const rows = await withDb((db) => db.select<unknown[]>(LIST), TABLE);
  return rows.ok ? mapRows(rows.value, cvFromRow) : rows;
}

export async function getCv(id: string): Promise<Result<Cv | null, DbError>> {
  const rows = await withDb((db) => db.select<unknown[]>(GET, [id]), TABLE);
  if (!rows.ok) return rows;

  const cvs = mapRows(rows.value, cvFromRow);
  if (!cvs.ok) return cvs;

  return ok(cvs.value[0] ?? null);
}

export async function upsertCv(cv: Cv): Promise<Result<void, DbError>> {
  const written = await withDb((db) => db.execute(UPSERT, cvToValues(cv)), TABLE);
  return written.ok ? ok(undefined) : written;
}

/** Deleting a CV cascades to its analyses (see `0001_init.sql`). */
export async function deleteCv(id: string): Promise<Result<void, DbError>> {
  const deleted = await withDb((db) => db.execute(DELETE, [id]), TABLE);
  return deleted.ok ? ok(undefined) : deleted;
}
