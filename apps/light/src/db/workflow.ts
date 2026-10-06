/**
 * A job's work in progress, kept across a restart (L-199, 0007_job_workflow).
 *
 * One row per job — `id` IS the job's id — written through by the Tailor
 * screen's session store a moment after each change, and read once at launch.
 * The row goes with its job (`ON DELETE CASCADE`), and "Delete everything"
 * empties the table with the rest (`WIPE_ORDER`).
 *
 * Plain columns, checked by hand: this is not a domain record in
 * `@cviper/core-types` and is never exported in a backup. `draft_json` is
 * opaque here; the Tailor side decodes it, and drops a draft it cannot read
 * rather than losing the rest of the job.
 *
 * Every function returns a `Result`; nothing here throws.
 */
import { err, ok, type Result } from '@cviper/core-types';

import { withDb } from './client';
import { dbError, type DbError } from './errors';
import { mapRows } from './rows';
import { selectFrom, upsertInto } from './statements';

const TABLE = 'job_workflow';

const LIST = `${selectFrom(TABLE)} ORDER BY updated_at DESC, id`;
const UPSERT = upsertInto(TABLE);

export interface JobWorkflowRow {
  /** The job's id. */
  readonly id: string;
  /** Which step the user was on. Only `tailor` today; L-200 adds the rest. */
  readonly step: string;
  readonly cv_id: string | null;
  readonly ai_option: string | null;
  readonly advert: string;
  readonly draft_json: string | null;
  readonly updated_at: string;
}

function malformed(detail: string): Result<never, DbError> {
  return err(dbError('MALFORMED_ROW', `A row in "${TABLE}" could not be read — ${detail}`, TABLE));
}

function text(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];
  return typeof value === 'string' ? value : null;
}

function rowFrom(raw: unknown): Result<JobWorkflowRow, DbError> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return malformed('expected a row object.');
  }
  const row = raw as Record<string, unknown>;
  for (const required of ['id', 'step', 'advert', 'updated_at']) {
    if (text(row, required) === null) return malformed(`${required} is missing.`);
  }
  for (const optional of ['cv_id', 'ai_option', 'draft_json']) {
    const value = row[optional] ?? null;
    if (value !== null && typeof value !== 'string') {
      return malformed(`${optional} is not text.`);
    }
  }
  return ok({
    id: text(row, 'id') ?? '',
    step: text(row, 'step') ?? '',
    cv_id: text(row, 'cv_id'),
    ai_option: text(row, 'ai_option'),
    advert: text(row, 'advert') ?? '',
    draft_json: text(row, 'draft_json'),
    updated_at: text(row, 'updated_at') ?? '',
  });
}

/** Every job's work in progress, most recently touched first. */
export async function listJobWorkflows(): Promise<Result<JobWorkflowRow[], DbError>> {
  const rows = await withDb((db) => db.select<unknown[]>(LIST), TABLE);
  return rows.ok ? mapRows(rows.value, rowFrom) : rows;
}

/** Write one job's work in progress, replacing what was there. */
export async function upsertJobWorkflow(row: JobWorkflowRow): Promise<Result<void, DbError>> {
  const values = [
    row.id,
    row.step,
    row.cv_id,
    row.ai_option,
    row.advert,
    row.draft_json,
    row.updated_at,
  ];
  const written = await withDb((db) => db.execute(UPSERT, values), TABLE);
  return written.ok ? ok(undefined) : written;
}
