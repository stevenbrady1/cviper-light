/**
 * The real port calls the right data-layer functions. The data layer itself
 * is mocked: what is under test is the wiring, not SQLite.
 */
import { describe, expect, it, vi } from 'vitest';

import { ok, type Application } from '@cviper/core-types';

const db = vi.hoisted(() => ({
  listCvs: vi.fn(),
  listJobs: vi.fn(),
  listApplications: vi.fn(),
  getProfile: vi.fn(),
  upsertDocument: vi.fn(),
  listDocumentsForApplication: vi.fn(),
}));

vi.mock('../../db', () => db);

const { createDbTailorPort } = await import('./port');

function application(id: string, jobId: string): Application {
  return {
    id,
    job_id: jobId,
    status: 'applied',
    applied_date: null,
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: '2026-08-01T09:00:00.000Z',
  };
}

describe('createDbTailorPort', () => {
  it('reads CVs, jobs, the profile and documents straight from the data layer', () => {
    const port = createDbTailorPort();
    expect(port.loadCvs).toBe(db.listCvs);
    expect(port.loadJobs).toBe(db.listJobs);
    expect(port.profile).toBe(db.getProfile);
    expect(port.saveDocument).toBe(db.upsertDocument);
    expect(port.loadDocumentsFor).toBe(db.listDocumentsForApplication);
  });

  it('narrows the board to the applications chasing ONE job', async () => {
    db.listApplications.mockResolvedValue(
      ok([application('a-1', 'job-1'), application('a-2', 'job-2'), application('a-3', 'job-1')]),
    );

    const loaded = await createDbTailorPort().loadApplicationsFor('job-1');

    expect(loaded.ok && loaded.value.map((a) => a.id)).toEqual(['a-1', 'a-3']);
  });

  it('boundary: a job nobody is chasing yields an empty list, not an error', async () => {
    db.listApplications.mockResolvedValue(ok([application('a-1', 'job-1')]));

    const loaded = await createDbTailorPort().loadApplicationsFor('job-9');

    expect(loaded).toEqual({ ok: true, value: [] });
  });

  it('negative: a failed board read is passed through as the failure it was', async () => {
    const failure = {
      ok: false as const,
      error: { code: 'QUERY_FAILED', message: 'locked', table: 'applications' },
    };
    db.listApplications.mockResolvedValue(failure);

    expect(await createDbTailorPort().loadApplicationsFor('job-1')).toBe(failure);
  });
});
