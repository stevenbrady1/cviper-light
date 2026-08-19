/**
 * `src/db` is mocked, because it talks to `tauri-plugin-sql` and there is no
 * Tauri runtime here. What is asserted is the CONTRACT with the data layer:
 * which functions are called, in which ORDER, and what happens when one of them
 * says no.
 *
 * ============================================================================
 * THE FILE IS MOSTLY ABOUT SAVING THE SAME ADVERT TWICE
 * ============================================================================
 * A search builds a fresh UUID for every advert it normalises, so the same
 * advert saved on Monday and again on Thursday is two rows with two ids and one
 * `(source, external_id)` — which trips the partial unique index and comes back
 * as `CONSTRAINT_VIOLATION`. Correct, and completely useless in front of a
 * person. Every path through that is exercised here.
 */
import { err, ok, type Application, type Job } from '@cviper/core-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  listJobs: vi.fn(),
  listApplications: vi.fn(),
  findJobByExternalId: vi.fn(),
  upsertJob: vi.fn(),
  upsertApplication: vi.fn(),
}));

vi.mock('../../db', () => db);

const { createDbSearchPort } = await import('./port');

const NOW = '2026-08-19T09:00:00.000Z';

const JOB: Job = {
  id: 'job-fresh',
  source: 'reed',
  external_id: '55512345',
  title: 'Credit Risk Analyst',
  company: 'Barclays',
  location: 'London',
  salary_min: 457,
  salary_max: 550,
  salary_currency: 'GBP',
  salary_period: 'day',
  description: 'A contract role inside IR35.',
  url: 'https://www.reed.co.uk/jobs/55512345',
  posted_date: '2026-08-14',
  created_at: NOW,
};

/** The same advert as it was saved last week: same identity, different id. */
const ALREADY_SAVED: Job = { ...JOB, id: 'job-from-monday' };

const APPLICATION: Application = {
  id: 'app-1',
  job_id: 'job-from-monday',
  status: 'saved',
  applied_date: null,
  notes: null,
  next_action: null,
  next_action_date: null,
  updated_at: NOW,
};

const failure = { code: 'QUERY_FAILED' as const, message: 'no such table', table: 'jobs' };
const duplicate = {
  code: 'CONSTRAINT_VIOLATION' as const,
  message: 'UNIQUE constraint failed: jobs.source, jobs.external_id',
  table: 'jobs',
};

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.listJobs.mockResolvedValue(ok([]));
  db.listApplications.mockResolvedValue(ok([]));
  db.findJobByExternalId.mockResolvedValue(ok(null));
  db.upsertJob.mockResolvedValue(ok(undefined));
  db.upsertApplication.mockResolvedValue(ok(undefined));
});

describe('what is already being chased', () => {
  it('keys every tracked advert by its board and the board’s own id', async () => {
    db.listJobs.mockResolvedValue(ok([ALREADY_SAVED]));
    db.listApplications.mockResolvedValue(ok([APPLICATION]));

    const tracked = await createDbSearchPort().loadTracked();

    expect(tracked.ok && [...tracked.value]).toEqual(['reed:55512345']);
  });

  it('ignores a job nothing is chasing', async () => {
    // A job row with no application is not on the board. It can only come from
    // an import, and the card should still offer to save it.
    db.listJobs.mockResolvedValue(ok([ALREADY_SAVED]));
    db.listApplications.mockResolvedValue(ok([]));

    const tracked = await createDbSearchPort().loadTracked();

    expect(tracked.ok && tracked.value.size).toBe(0);
  });

  it('ignores a hand-typed job, which has no provider identity at all', async () => {
    db.listJobs.mockResolvedValue(ok([{ ...ALREADY_SAVED, source: 'manual', external_id: null }]));
    db.listApplications.mockResolvedValue(ok([APPLICATION]));

    const tracked = await createDbSearchPort().loadTracked();

    expect(tracked.ok && tracked.value.size).toBe(0);
  });

  it('negative: passes a database failure straight through', async () => {
    db.listJobs.mockResolvedValue(err(failure));

    await expect(createDbSearchPort().loadTracked()).resolves.toEqual(err(failure));
  });
});

describe('saving an advert that is new', () => {
  it('writes the job FIRST, then the application', async () => {
    const saved = await createDbSearchPort().saveToTracker(JOB, { applicationId: 'app-new' }, NOW);

    expect(saved).toEqual(ok('saved'));
    // `applications.job_id` has a foreign key onto `jobs.id` and foreign keys
    // are enforced, so the other order is a guaranteed constraint violation.
    expect(db.upsertJob.mock.invocationCallOrder[0]).toBeLessThan(
      db.upsertApplication.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('creates the application at "saved", pointing at the advert’s own id', async () => {
    await createDbSearchPort().saveToTracker(JOB, { applicationId: 'app-new' }, NOW);

    expect(db.upsertApplication).toHaveBeenCalledWith({
      id: 'app-new',
      job_id: 'job-fresh',
      status: 'saved',
      // Not applied to. Recording a date here would put a false fact on the
      // card the moment it appeared.
      applied_date: null,
      notes: null,
      next_action: null,
      next_action_date: null,
      updated_at: NOW,
    });
  });

  it('looks for the advert before writing it', async () => {
    await createDbSearchPort().saveToTracker(JOB, { applicationId: 'app-new' }, NOW);

    expect(db.findJobByExternalId).toHaveBeenCalledWith('reed', '55512345');
    expect(db.findJobByExternalId.mock.invocationCallOrder[0]).toBeLessThan(
      db.upsertJob.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('negative: a failure writing the job stops before the application', async () => {
    db.upsertJob.mockResolvedValue(err(failure));

    const saved = await createDbSearchPort().saveToTracker(JOB, { applicationId: 'a' }, NOW);

    expect(saved).toEqual(err(failure));
    expect(db.upsertApplication).not.toHaveBeenCalled();
  });
});

describe('saving the same advert twice', () => {
  it('reports it as already saved, and writes nothing', async () => {
    db.findJobByExternalId.mockResolvedValue(ok(ALREADY_SAVED));
    db.listApplications.mockResolvedValue(ok([APPLICATION]));

    const saved = await createDbSearchPort().saveToTracker(JOB, { applicationId: 'a' }, NOW);

    // Not an error. Not a duplicate row. Not a raw SQLite message on screen.
    expect(saved).toEqual(ok('already-saved'));
    expect(db.upsertJob).not.toHaveBeenCalled();
    expect(db.upsertApplication).not.toHaveBeenCalled();
  });

  it('starts chasing an advert that is in the database but on nobody’s board', async () => {
    // Comes from an import: the job row exists, the application does not.
    db.findJobByExternalId.mockResolvedValue(ok(ALREADY_SAVED));
    db.listApplications.mockResolvedValue(ok([]));

    const saved = await createDbSearchPort().saveToTracker(JOB, { applicationId: 'a' }, NOW);

    expect(saved).toEqual(ok('saved'));
    // The EXISTING job's id, not the fresh one from this search — writing the
    // fresh one is exactly what trips the unique index.
    expect(db.upsertJob).not.toHaveBeenCalled();
    expect(db.upsertApplication).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: 'job-from-monday' }),
    );
  });

  it('negative: a constraint violation is still handled, for the race the lookup cannot close', async () => {
    // Two windows saving the same advert between the SELECT and the INSERT.
    // The index is the backstop, and the user must never see its message.
    db.upsertJob.mockResolvedValue(err(duplicate));

    const saved = await createDbSearchPort().saveToTracker(JOB, { applicationId: 'a' }, NOW);

    expect(saved).toEqual(ok('already-saved'));
    expect(db.upsertApplication).not.toHaveBeenCalled();
  });

  it('negative: any OTHER database failure is still reported, not swallowed as a duplicate', async () => {
    // The dangerous over-correction: treating every write failure as "already
    // saved" would tell the user their advert is on the board when the database
    // would not open at all.
    db.upsertJob.mockResolvedValue(err(failure));

    const saved = await createDbSearchPort().saveToTracker(JOB, { applicationId: 'a' }, NOW);

    expect(saved).toEqual(err(failure));
  });

  it('negative: a failed lookup is reported rather than assumed to be "new"', async () => {
    db.findJobByExternalId.mockResolvedValue(err(failure));

    const saved = await createDbSearchPort().saveToTracker(JOB, { applicationId: 'a' }, NOW);

    expect(saved).toEqual(err(failure));
    expect(db.upsertJob).not.toHaveBeenCalled();
  });
});

describe('an advert with no provider identity', () => {
  it('boundary: is written without a lookup, because there is nothing to look up', async () => {
    // Cannot arrive from a search — both parsers read an id — but the type
    // allows it and the partial unique index deliberately excludes NULLs.
    const anonymous: Job = { ...JOB, external_id: null };

    const saved = await createDbSearchPort().saveToTracker(anonymous, { applicationId: 'a' }, NOW);

    expect(saved).toEqual(ok('saved'));
    expect(db.findJobByExternalId).not.toHaveBeenCalled();
    expect(db.upsertJob).toHaveBeenCalledWith(anonymous);
  });
});
