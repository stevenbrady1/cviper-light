/**
 * `src/db` is mocked, because it talks to `tauri-plugin-sql` and there is no
 * Tauri runtime here. What is asserted is the CONTRACT with the data layer:
 * which function is called with what, and that a refusal comes back as one.
 */
import { err, ok, emptyProfile } from '@cviper/core-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  getProfile: vi.fn(),
  upsertProfile: vi.fn(),
}));

vi.mock('../../db', () => db);

const { createDbProfilePort } = await import('./port');

const PROFILE = { ...emptyProfile('2026-09-14T09:00:00.000Z'), headline: 'Risk analyst' };
const failure = { code: 'QUERY_FAILED' as const, message: 'no such table', table: 'profile' };

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.getProfile.mockResolvedValue(ok(null));
  db.upsertProfile.mockResolvedValue(ok(undefined));
});

describe('load', () => {
  it('returns the saved profile', async () => {
    db.getProfile.mockResolvedValue(ok(PROFILE));
    await expect(createDbProfilePort().load()).resolves.toEqual(ok(PROFILE));
  });

  it('boundary: no profile yet is null, not a failure', async () => {
    await expect(createDbProfilePort().load()).resolves.toEqual(ok(null));
  });

  it('negative: passes a read failure straight through', async () => {
    db.getProfile.mockResolvedValue(err(failure));
    await expect(createDbProfilePort().load()).resolves.toEqual(err(failure));
  });
});

describe('save', () => {
  it('upserts the profile it was given', async () => {
    await createDbProfilePort().save(PROFILE);
    expect(db.upsertProfile).toHaveBeenCalledExactlyOnceWith(PROFILE);
  });

  it('negative: surfaces the failure instead of pretending the edit stuck', async () => {
    db.upsertProfile.mockResolvedValue(err(failure));
    await expect(createDbProfilePort().save(PROFILE)).resolves.toEqual(err(failure));
  });
});
