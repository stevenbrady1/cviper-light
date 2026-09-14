/**
 * `src/db` is mocked, because it talks to `tauri-plugin-sql` and there is no
 * Tauri runtime here. What is asserted is the CONTRACT with the data layer:
 * the newest CV's text, only the jobs an application points at, and that a
 * refusal from any of the three reads comes back as one.
 */
import { err, ok, type Application, type Cv, type Job } from '@cviper/core-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  listApplications: vi.fn(),
  listCvs: vi.fn(),
  listJobs: vi.fn(),
}));

vi.mock('../../db', () => db);

const { createDbGapsPort } = await import('./gapsPort');

const NOW = '2026-09-14T09:00:00.000Z';
const failure = { code: 'QUERY_FAILED' as const, message: 'no such table', table: 'jobs' };

function job(id: string): Job {
  return {
    id,
    source: 'manual',
    external_id: null,
    title: `Job ${id}`,
    company: 'Acme',
    location: null,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: `Advert ${id}`,
    url: null,
    posted_date: null,
    created_at: NOW,
  };
}

function application(id: string, jobId: string): Application {
  return {
    id,
    job_id: jobId,
    status: 'saved',
    applied_date: null,
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: NOW,
  };
}

function cv(id: string, text: string | null): Cv {
  return {
    id,
    name: `${id}.pdf`,
    file_path: null,
    extracted_text: text,
    created_at: NOW,
    json_resume: null,
  };
}

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.listCvs.mockResolvedValue(ok([]));
  db.listJobs.mockResolvedValue(ok([]));
  db.listApplications.mockResolvedValue(ok([]));
});

describe('load', () => {
  it('pairs the newest CV text with the jobs that have an application', async () => {
    // `listCvs` is newest first; the port trusts that order.
    db.listCvs.mockResolvedValue(ok([cv('new', 'Newest text'), cv('old', 'Older text')]));
    db.listJobs.mockResolvedValue(ok([job('board'), job('stray'), job('also-board')]));
    db.listApplications.mockResolvedValue(
      ok([application('1', 'board'), application('2', 'also-board')]),
    );

    const loaded = await createDbGapsPort().load();

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.cvText).toBe('Newest text');
    // A search result never saved to the tracker is not an application.
    expect(loaded.value.jobs.map((each) => each.id)).toEqual(['board', 'also-board']);
  });

  it('boundary: a newer CV with no extracted text yet does not hide an older one that has', async () => {
    db.listCvs.mockResolvedValue(ok([cv('new', null), cv('old', 'Older text')]));

    const loaded = await createDbGapsPort().load();

    expect(loaded).toEqual(ok({ cvText: 'Older text', jobs: [] }));
  });

  it('boundary: nothing saved yet is an empty source, not a failure', async () => {
    await expect(createDbGapsPort().load()).resolves.toEqual(ok({ cvText: null, jobs: [] }));
  });

  it('negative: an application whose job is missing is dropped, not rendered blank', async () => {
    db.listApplications.mockResolvedValue(ok([application('1', 'gone')]));

    const loaded = await createDbGapsPort().load();

    expect(loaded).toEqual(ok({ cvText: null, jobs: [] }));
  });

  it.each(['listCvs', 'listJobs', 'listApplications'] as const)(
    'negative: passes a %s failure straight through',
    async (reader) => {
      db[reader].mockResolvedValue(err(failure));
      await expect(createDbGapsPort().load()).resolves.toEqual(err(failure));
    },
  );
});
