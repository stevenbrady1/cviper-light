/**
 * Interview sub-stages (L-205) — the user's own steps inside the Interviewing
 * column, such as "HR Screen" or "Panel Round".
 *
 * Every function returns a `Result`; nothing here throws.
 *
 * The whole list is read and replaced as one unit, never row by row: it is a
 * handful of short names edited together (add, rename, reorder, remove), and
 * "make the stored list this list" is one question with one transaction
 * instead of four operations that can be interrupted half way.
 *
 * Removing a sub-stage needs no code here. `applications.interview_substage_id`
 * is `ON DELETE SET NULL` (0006), so the DELETE below takes the label off every
 * card that used it and touches nothing else about them.
 */
import { ok, type InterviewSubstage, type Result } from '@cviper/core-types';

import { withDb } from './client';
import { type DbError } from './errors';
import { interviewSubstageFromRow, interviewSubstageToValues, mapRows } from './rows';
import { selectFrom, upsertInto } from './statements';

const TABLE = 'interview_substages';

/** `id` as the tie-break so two equal positions always read in the same order. */
const LIST = `${selectFrom(TABLE)} ORDER BY position, id`;
const UPSERT = upsertInto(TABLE);

export async function listInterviewSubstages(): Promise<Result<InterviewSubstage[], DbError>> {
  const rows = await withDb((db) => db.select<unknown[]>(LIST), TABLE);
  return rows.ok ? mapRows(rows.value, interviewSubstageFromRow) : rows;
}

/**
 * Make the stored list exactly `substages`.
 *
 * One immediate transaction: upsert every entry, then delete whatever is not in
 * the list. Ids are bound as parameters, never interpolated; the list is capped
 * at `INTERVIEW_SUBSTAGES_MAX` by the callers, far below any parameter limit.
 * The `DELETE` is plain (no `WHERE`) for the empty list, because
 * `NOT IN ()` is a syntax error in some dialects.
 */
export async function replaceInterviewSubstages(
  substages: readonly InterviewSubstage[],
): Promise<Result<void, DbError>> {
  const written = await withDb(async (db) => {
    await db.execute('BEGIN IMMEDIATE;');

    try {
      for (const substage of substages) {
        await db.execute(UPSERT, interviewSubstageToValues(substage));
      }

      if (substages.length === 0) {
        await db.execute(`DELETE FROM ${TABLE}`);
      } else {
        const placeholders = substages.map((_, index) => `$${index + 1}`).join(', ');
        await db.execute(
          `DELETE FROM ${TABLE} WHERE id NOT IN (${placeholders})`,
          substages.map((substage) => substage.id),
        );
      }

      await db.execute('COMMIT;');
    } catch (cause) {
      // The ROLLBACK's own failure is deliberately not propagated: the caller
      // needs the reason the SAVE failed. The original error is rethrown.
      await db.execute('ROLLBACK;').catch(() => undefined);
      throw cause;
    }
  }, TABLE);

  return written.ok ? ok(undefined) : written;
}
