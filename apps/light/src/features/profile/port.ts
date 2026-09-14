/**
 * The two things the profile view does to storage, and nothing else.
 *
 * Same reasoning as `tracker/port.ts`: `src/db` needs a Tauri runtime a
 * Vitest process does not have, and naming the whole appetite in one place
 * keeps it small. There is no `remove` — the profile is one row that "delete
 * everything" clears, and a view that could delete it on its own would need a
 * confirmation this screen has no reason to carry.
 */
import { getProfile, upsertProfile, type DbError } from '../../db';
import { type Profile, type Result } from '@cviper/core-types';

export interface ProfilePort {
  /** The saved profile, or `null` if there has never been one. */
  load(): Promise<Result<Profile | null, DbError>>;
  /** Save the whole profile. Always the one row. */
  save(profile: Profile): Promise<Result<void, DbError>>;
}

export function createDbProfilePort(): ProfilePort {
  return { load: getProfile, save: upsertProfile };
}
