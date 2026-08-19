/**
 * Analyses — one CV scored against one job, or against nothing at all.
 *
 * `job_id` is nullable: a job-agnostic CV review is a first-class result, and
 * deleting the job an analysis referred to sets the column to NULL rather than
 * destroying the analysis. Past evidence outlives the advert.
 *
 * `result_json` is a TEXT column here and a structured object everywhere else.
 * The conversion happens in `rows.ts` and nowhere else — see `analysisToValues`
 * and `analysisFromRow`.
 *
 * Every function returns a `Result`; nothing here throws.
 */
import { ok, type Analysis, type Result } from '@cviper/core-types';

import { withDb } from './client';
import { type DbError } from './errors';
import { analysisFromRow, analysisToValues, mapRows } from './rows';
import { deleteFrom, selectFrom, upsertInto } from './statements';

const TABLE = 'analyses';

const LIST = `${selectFrom(TABLE)} ORDER BY created_at DESC, id`;
const LIST_FOR_CV = `${selectFrom(TABLE)} WHERE cv_id = $1 ORDER BY created_at DESC, id`;
const GET = `${selectFrom(TABLE)} WHERE id = $1`;
const UPSERT = upsertInto(TABLE);
const DELETE = deleteFrom(TABLE);

export async function listAnalyses(): Promise<Result<Analysis[], DbError>> {
  const rows = await withDb((db) => db.select<unknown[]>(LIST), TABLE);
  return rows.ok ? mapRows(rows.value, analysisFromRow) : rows;
}

/** Every analysis run against one CV, newest first. Backed by `idx_analyses_cv_id`. */
export async function listAnalysesForCv(cvId: string): Promise<Result<Analysis[], DbError>> {
  const rows = await withDb((db) => db.select<unknown[]>(LIST_FOR_CV, [cvId]), TABLE);
  return rows.ok ? mapRows(rows.value, analysisFromRow) : rows;
}

export async function getAnalysis(id: string): Promise<Result<Analysis | null, DbError>> {
  const rows = await withDb((db) => db.select<unknown[]>(GET, [id]), TABLE);
  if (!rows.ok) return rows;

  const analyses = mapRows(rows.value, analysisFromRow);
  if (!analyses.ok) return analyses;

  return ok(analyses.value[0] ?? null);
}

/**
 * Insert, or replace the analysis with the same id.
 *
 * Serialisation happens BEFORE the statement runs: a `result_json` that cannot
 * be turned into JSON fails without the database being touched at all.
 */
export async function upsertAnalysis(analysis: Analysis): Promise<Result<void, DbError>> {
  const values = analysisToValues(analysis);
  if (!values.ok) return values;

  const written = await withDb((db) => db.execute(UPSERT, values.value), TABLE);
  return written.ok ? ok(undefined) : written;
}

export async function deleteAnalysis(id: string): Promise<Result<void, DbError>> {
  const deleted = await withDb((db) => db.execute(DELETE, [id]), TABLE);
  return deleted.ok ? ok(undefined) : deleted;
}
