/**
 * Delete every row in the database, as one transaction, then compact the file.
 *
 * ============================================================================
 * THE OPPOSITE OF `writeAll`, AND JUST AS DELIBERATE ABOUT IT
 * ============================================================================
 * `backup.ts` goes to some lengths to promise that an import NEVER deletes.
 * This is the one place that does, and it is the whole database or nothing:
 * there is no "delete my jobs but keep my CVs", because a half-erased database
 * is the state nobody asked for and nobody can reason about afterwards.
 *
 * Children before parents — the reverse of `WRITE_ORDER` — because foreign
 * keys are enforced and SQLite will refuse to delete a job that still has an
 * application. `WIPE_ORDER` is pinned against `TABLE_COLUMNS` by
 * `wipe.test.ts`: a table added to the schema and forgotten here fails the
 * build, which is what "delete everything" has to mean.
 *
 * `VACUUM` afterwards, outside the transaction (SQLite refuses it inside one).
 * A `DELETE` marks pages free; it does not overwrite them, and a CV's text
 * would still be readable in the file with a hex editor. `VACUUM` rewrites the
 * file without the free pages, so what the user was told is gone is gone from
 * the bytes on disk as well as from the queries.
 */
import { type Result } from '@cviper/core-types';

import { withDb } from './client';
import { type DbError } from './errors';
import { type TableName } from './rows';

/** Children first. Applications need jobs; analyses need CVs (and may name jobs). */
export const WIPE_ORDER: readonly TableName[] = ['analyses', 'applications', 'cvs', 'jobs'];

export async function wipeAll(): Promise<Result<void, DbError>> {
  return withDb(async (db) => {
    // IMMEDIATE takes the write lock up front, for the same reason `writeAll`
    // does: SQLITE_BUSY half way through a wipe is the worst moment to learn
    // the database is in use elsewhere.
    await db.execute('BEGIN IMMEDIATE;');

    try {
      for (const table of WIPE_ORDER) {
        await db.execute(`DELETE FROM ${table};`);
      }
      await db.execute('COMMIT;');
    } catch (cause) {
      // The ROLLBACK's own failure is deliberately not propagated; the
      // original error is what the caller needs, and it is rethrown either way.
      await db.execute('ROLLBACK;').catch(() => undefined);
      throw cause;
    }

    await db.execute('VACUUM;');
  });
}
