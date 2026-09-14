/**
 * The candidate profile — one row, fixed id (L-154).
 *
 * There is no `list` and no `delete`: the profile is a `get` that may come
 * back empty, and an `upsert` that always lands on `PROFILE_ID`. "Delete
 * everything" clears the table through `wipeAll`, which is the only path that
 * removes it, so the profile cannot be half-erased on its own.
 *
 * The `_json` list columns are serialised in `rows.ts` and nowhere else — see
 * `profileToValues`. Serialisation happens BEFORE the statement runs, so a
 * profile that cannot be turned into JSON fails without the database being
 * touched at all.
 *
 * Every function returns a `Result`; nothing here throws.
 */
import { PROFILE_ID, ok, type Profile, type Result } from '@cviper/core-types';

import { withDb } from './client';
import { type DbError } from './errors';
import { mapRows, profileFromRow, profileToValues } from './rows';
import { selectFrom, upsertInto } from './statements';

const TABLE = 'profile';

const GET = `${selectFrom(TABLE)} WHERE id = $1`;
const UPSERT = upsertInto(TABLE);

/** The profile, or `null` when it has never been saved. Absence is an answer. */
export async function getProfile(): Promise<Result<Profile | null, DbError>> {
  const rows = await withDb((db) => db.select<unknown[]>(GET, [PROFILE_ID]), TABLE);
  if (!rows.ok) return rows;

  const profiles = mapRows(rows.value, profileFromRow);
  if (!profiles.ok) return profiles;

  return ok(profiles.value[0] ?? null);
}

export async function upsertProfile(profile: Profile): Promise<Result<void, DbError>> {
  const values = profileToValues(profile);
  if (!values.ok) return values;

  const written = await withDb((db) => db.execute(UPSERT, values.value), TABLE);
  return written.ok ? ok(undefined) : written;
}
