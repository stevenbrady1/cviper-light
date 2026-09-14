/**
 * Documents — the texts archived against an application (L-155).
 *
 * A document belongs to exactly one application and goes with it:
 * `documents.application_id` is `ON DELETE CASCADE` (0004_documents.sql), so
 * deleting an application — or the job above it — removes its documents in the
 * same statement. Nothing here deletes by application; the cascade is the
 * only route, and it cannot leave an orphan.
 *
 * `kind` is a closed set validated by Zod in `rows.ts`, not by the column.
 *
 * Every function returns a `Result`; nothing here throws.
 */
import { ok, type Document, type Result } from '@cviper/core-types';

import { withDb } from './client';
import { type DbError } from './errors';
import { documentFromRow, documentToValues, mapRows } from './rows';
import { deleteFrom, selectFrom, upsertInto } from './statements';

const TABLE = 'documents';

const LIST = `${selectFrom(TABLE)} ORDER BY created_at DESC, id`;
const LIST_FOR_APPLICATION = `${selectFrom(TABLE)} WHERE application_id = $1 ORDER BY created_at DESC, id`;
const UPSERT = upsertInto(TABLE);
const DELETE = deleteFrom(TABLE);

export async function listDocuments(): Promise<Result<Document[], DbError>> {
  const rows = await withDb((db) => db.select<unknown[]>(LIST), TABLE);
  return rows.ok ? mapRows(rows.value, documentFromRow) : rows;
}

/**
 * Every document kept with one application, newest first. Backed by
 * `idx_documents_application_id`.
 */
export async function listDocumentsForApplication(
  applicationId: string,
): Promise<Result<Document[], DbError>> {
  const rows = await withDb(
    (db) => db.select<unknown[]>(LIST_FOR_APPLICATION, [applicationId]),
    TABLE,
  );
  return rows.ok ? mapRows(rows.value, documentFromRow) : rows;
}

export async function upsertDocument(document: Document): Promise<Result<void, DbError>> {
  const written = await withDb((db) => db.execute(UPSERT, documentToValues(document)), TABLE);
  return written.ok ? ok(undefined) : written;
}

export async function deleteDocument(id: string): Promise<Result<void, DbError>> {
  const deleted = await withDb((db) => db.execute(DELETE, [id]), TABLE);
  return deleted.ok ? ok(undefined) : deleted;
}
