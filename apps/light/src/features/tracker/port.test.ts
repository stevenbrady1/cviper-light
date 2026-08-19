/**
 * `src/db` is mocked, because it talks to `tauri-plugin-sql` and there is no
 * Tauri runtime here. What is asserted is the CONTRACT with the data layer:
 * which functions are called, in which ORDER, and what happens when one of them
 * says no.
 */
import { err, ok } from '@cviper/core-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  listJobs: vi.fn(),
  listApplications: vi.fn(),
  upsertJob: vi.fn(),
  upsertApplication: vi.fn(),
  deleteJob: vi.fn(),
}));

vi.mock('../../db', () => db);

const { createDbTrackerPort } = await import('./port');
const { createEntry } = await import('./model');

const NOW = '2026-08-19T09:00:00.000Z';
const entry = createEntry(
  { title: 'Quant Developer', company: 'Jane Street', location: 'London', status: 'saved' },
  { jobId: 'job-1', applicationId: 'app-1' },
  NOW,
);

const failure = { code: 'QUERY_FAILED' as const, message: 'no such table', table: 'jobs' };

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.listJobs.mockResolvedValue(ok([]));
  db.listApplications.mockResolvedValue(ok([]));
  db.upsertJob.mockResolvedValue(ok(undefined));
  db.upsertApplication.mockResolvedValue(ok(undefined));
  db.deleteJob.mockResolvedValue(ok(undefined));
});

describe('load', () => {
  it('pairs the jobs with their applications', async () => {
    db.listJobs.mockResolvedValue(ok([entry.job]));
    db.listApplications.mockResolvedValue(ok([entry.application]));

    const loaded = await createDbTrackerPort().load();

    expect(loaded).toEqual(ok([{ application: entry.application, job: entry.job }]));
  });

  it('boundary: an empty database is an empty board, not a failure', async () => {
    await expect(createDbTrackerPort().load()).resolves.toEqual(ok([]));
  });

  it('negative: passes a jobs failure straight through', async () => {
    db.listJobs.mockResolvedValue(err(failure));

    await expect(createDbTrackerPort().load()).resolves.toEqual(err(failure));
  });

  it('negative: passes an applications failure straight through', async () => {
    db.listApplications.mockResolvedValue(err(failure));

    await expect(createDbTrackerPort().load()).resolves.toEqual(err(failure));
  });

  it('negative: does not go looking for applications once the jobs read has failed', async () => {
    db.listJobs.mockResolvedValue(err(failure));

    await createDbTrackerPort().load();

    expect(db.listApplications).not.toHaveBeenCalled();
  });
});

describe('create', () => {
  it('writes the job BEFORE the application', async () => {
    // `applications.job_id` has an enforced foreign key onto `jobs.id`. The
    // other order is not a race — it is a guaranteed constraint violation.
    await createDbTrackerPort().create(entry);

    expect(db.upsertJob).toHaveBeenCalledWith(entry.job);
    expect(db.upsertApplication).toHaveBeenCalledWith(entry.application);

    const jobOrder = db.upsertJob.mock.invocationCallOrder[0] ?? Infinity;
    const applicationOrder = db.upsertApplication.mock.invocationCallOrder[0] ?? -Infinity;
    expect(jobOrder).toBeLessThan(applicationOrder);
  });

  it('negative: does not write an application whose job failed to save', async () => {
    // Otherwise the write fails on the foreign key anyway, and the user gets a
    // constraint error instead of the real reason.
    db.upsertJob.mockResolvedValue(err(failure));

    const created = await createDbTrackerPort().create(entry);

    expect(created).toEqual(err(failure));
    expect(db.upsertApplication).not.toHaveBeenCalled();
  });

  it('negative: reports an application failure rather than reporting success', async () => {
    db.upsertApplication.mockResolvedValue(err(failure));

    await expect(createDbTrackerPort().create(entry)).resolves.toEqual(err(failure));
  });
});

describe('saveApplication', () => {
  it('upserts the application it was given', async () => {
    await createDbTrackerPort().saveApplication(entry.application);

    expect(db.upsertApplication).toHaveBeenCalledWith(entry.application);
  });

  it('negative: surfaces the failure instead of pretending the edit stuck', async () => {
    db.upsertApplication.mockResolvedValue(err(failure));

    await expect(createDbTrackerPort().saveApplication(entry.application)).resolves.toEqual(
      err(failure),
    );
  });
});

describe('remove', () => {
  it('deletes the JOB, so the cascade takes the application with it', async () => {
    // Deleting the application alone would leave a job row nothing points at,
    // invisible to every view and impossible to clean up from inside the app.
    await createDbTrackerPort().remove(entry);

    expect(db.deleteJob).toHaveBeenCalledWith('job-1');
  });

  it('negative: surfaces a delete failure', async () => {
    db.deleteJob.mockResolvedValue(err(failure));

    await expect(createDbTrackerPort().remove(entry)).resolves.toEqual(err(failure));
  });
});
