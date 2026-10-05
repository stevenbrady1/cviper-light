/**
 * The tracker port's two interview sub-stage methods (L-205): which data-layer
 * calls they make, and that a failure is passed on rather than swallowed.
 */
import { err, ok } from '@cviper/core-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  listInterviewSubstages: vi.fn(),
  replaceInterviewSubstages: vi.fn(),
}));

vi.mock('../../db', () => db);

const { createDbTrackerPort } = await import('./port');

const STAGES = [
  { id: 'a', name: 'HR Screen', position: 0 },
  { id: 'b', name: 'Final', position: 1 },
];
const failure = { code: 'QUERY_FAILED' as const, message: 'no such table', table: 'x' };

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
});

describe('substages', () => {
  it('reads them from the data layer', async () => {
    db.listInterviewSubstages.mockResolvedValue(ok(STAGES));
    await expect(createDbTrackerPort().substages()).resolves.toEqual(ok(STAGES));
  });

  it('negative: passes a failure straight through', async () => {
    db.listInterviewSubstages.mockResolvedValue(err(failure));
    await expect(createDbTrackerPort().substages()).resolves.toEqual(err(failure));
  });
});

describe('saveSubstages', () => {
  it('replaces the whole list in one data-layer call', async () => {
    db.replaceInterviewSubstages.mockResolvedValue(ok(undefined));
    await expect(createDbTrackerPort().saveSubstages(STAGES)).resolves.toEqual(ok(undefined));
    expect(db.replaceInterviewSubstages).toHaveBeenCalledExactlyOnceWith(STAGES);
  });

  it('boundary: an empty list is passed on as empty, not skipped', async () => {
    db.replaceInterviewSubstages.mockResolvedValue(ok(undefined));
    await createDbTrackerPort().saveSubstages([]);
    expect(db.replaceInterviewSubstages).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('negative: passes a failure straight through', async () => {
    db.replaceInterviewSubstages.mockResolvedValue(err(failure));
    await expect(createDbTrackerPort().saveSubstages(STAGES)).resolves.toEqual(err(failure));
  });
});
