/**
 * Profile's CV port (L-408). `src/db` is mocked, as in `port.test.ts`: what is
 * asserted is which data-layer function each call reaches, with what, and
 * that a refusal comes back as one. A delete wired to the wrong function is a
 * delete of the wrong thing.
 */
import { err, ok } from '@cviper/core-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  listCvs: vi.fn(),
  upsertCv: vi.fn(),
  deleteCv: vi.fn(),
  listAnalysesForCv: vi.fn(),
}));

vi.mock('../../db', () => db);

const { createDbProfileCvPort } = await import('./port');

const failure = { code: 'QUERY_FAILED' as const, message: 'database is locked', table: 'cvs' };

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.deleteCv.mockResolvedValue(ok(undefined));
  db.listAnalysesForCv.mockResolvedValue(ok([]));
});

describe('deleteCv', () => {
  it('deletes the one CV it was given, and touches nothing else', async () => {
    await expect(createDbProfileCvPort().deleteCv('cv-1')).resolves.toEqual(ok(undefined));

    expect(db.deleteCv).toHaveBeenCalledExactlyOnceWith('cv-1');
    expect(db.upsertCv).not.toHaveBeenCalled();
  });

  it('negative: surfaces a refusal instead of pretending the CV went', async () => {
    db.deleteCv.mockResolvedValue(err(failure));
    await expect(createDbProfileCvPort().deleteCv('cv-1')).resolves.toEqual(err(failure));
  });
});

describe('loadHistory', () => {
  it('reads the saved checks of that CV only, and deletes nothing', async () => {
    const checks = [{ id: 'an-1' }, { id: 'an-2' }];
    db.listAnalysesForCv.mockResolvedValue(ok(checks));

    await expect(createDbProfileCvPort().loadHistory('cv-1')).resolves.toEqual(ok(checks));

    expect(db.listAnalysesForCv).toHaveBeenCalledExactlyOnceWith('cv-1');
    expect(db.deleteCv).not.toHaveBeenCalled();
  });

  it('boundary: no checks is an empty list, not a failure', async () => {
    await expect(createDbProfileCvPort().loadHistory('cv-1')).resolves.toEqual(ok([]));
  });

  it('negative: passes a read failure straight through', async () => {
    db.listAnalysesForCv.mockResolvedValue(err(failure));
    await expect(createDbProfileCvPort().loadHistory('cv-1')).resolves.toEqual(err(failure));
  });
});
