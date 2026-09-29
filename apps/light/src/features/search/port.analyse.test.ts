/**
 * The two things "Analyse this job" needs from the search port (L-190).
 *
 * 1. `saveToTracker` hands back the STORED job and its application, so the
 *    analysis, the tailored CV and the letter all attach to one record. The
 *    advert a search returns carries a fresh UUID every time; when it is
 *    already saved, the stored row has a DIFFERENT id, and attaching anything
 *    to the fresh one would point at a job that does not exist.
 *
 * 2. `readFullAdvert` brings in the full advert for a preview and writes it
 *    onto the stored job, so the tracker keeps the whole advert too.
 *
 * `src/db` is mocked, as in `port.test.ts`; the page transport is injected.
 */
import { err, ok, type Application, type Job } from '@cviper/core-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type PageFetchTransport } from '../tracker/pageFetch';

const db = vi.hoisted(() => ({
  listJobs: vi.fn(),
  listApplications: vi.fn(),
  findJobByExternalId: vi.fn(),
  upsertJob: vi.fn(),
  upsertApplication: vi.fn(),
  listCvs: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock('../../db', () => db);

const { createDbSearchPort } = await import('./port');
const { PREVIEW_ONLY_NOTE } = await import('../flow/advert');

const NOW = '2026-09-29T09:00:00.000Z';

const JOB: Job = {
  id: 'job-fresh',
  source: 'reed',
  external_id: '55512345',
  title: 'Credit Risk Analyst',
  company: 'Barclays',
  agency: null,
  location: 'London',
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  description: 'A preview of the advert, cut off after a few hundred characters…',
  url: 'https://www.reed.co.uk/jobs/55512345',
  posted_date: '2026-09-20',
  created_at: NOW,
};

/** The same advert, saved on an earlier day: same identity, different id. */
const STORED: Job = { ...JOB, id: 'job-from-monday' };

const APPLICATION: Application = {
  id: 'app-from-monday',
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

const FULL_TEXT =
  'You will sit in second-line credit risk for the wholesale book, reviewing limit ' +
  'applications from the corporate and institutional coverage teams and challenging the ' +
  'assumptions behind them. Experience of corporate credit analysis in a bank or a rating ' +
  'agency is essential, along with the confidence to say no to a relationship manager. ' +
  'Study support for ACCA or CFA is available, and the team sits three days a week in the ' +
  'City office with the rest of the week worked from home.';

function pageServing(body: string, status = 200): () => PageFetchTransport {
  return () => ({ fetchPage: () => Promise.resolve(ok({ status, body })) });
}

function forbidden(): PageFetchTransport {
  throw new Error('the network was reached on a path that must never reach it');
}

function port(createPageTransport: () => PageFetchTransport = forbidden) {
  return createDbSearchPort(undefined, undefined, createPageTransport);
}

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.listJobs.mockResolvedValue(ok([]));
  db.listApplications.mockResolvedValue(ok([]));
  db.findJobByExternalId.mockResolvedValue(ok(null));
  db.upsertJob.mockResolvedValue(ok(undefined));
  db.upsertApplication.mockResolvedValue(ok(undefined));
});

describe('saving hands back the stored job and application', () => {
  it('a new advert: the job as written, and the new application', async () => {
    const saved = await port().saveToTracker(JOB, { applicationId: 'app-new' }, NOW);

    expect(saved).toEqual(ok({ outcome: 'saved', job: JOB, applicationId: 'app-new' }));
  });

  it('an advert already saved: the EXISTING row and its application, and no duplicate', async () => {
    db.findJobByExternalId.mockResolvedValue(ok(STORED));
    db.listApplications.mockResolvedValue(ok([APPLICATION]));

    const saved = await port().saveToTracker(JOB, { applicationId: 'app-new' }, NOW);

    expect(saved).toEqual(
      ok({ outcome: 'already-saved', job: STORED, applicationId: 'app-from-monday' }),
    );
    expect(db.upsertJob).not.toHaveBeenCalled();
    expect(db.upsertApplication).not.toHaveBeenCalled();
  });

  it('a job row with no application: the existing row, and the application now chasing it', async () => {
    db.findJobByExternalId.mockResolvedValue(ok(STORED));
    db.listApplications.mockResolvedValue(ok([]));

    const saved = await port().saveToTracker(JOB, { applicationId: 'app-new' }, NOW);

    expect(saved).toEqual(ok({ outcome: 'saved', job: STORED, applicationId: 'app-new' }));
    expect(db.upsertJob).not.toHaveBeenCalled();
    expect(db.upsertApplication).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'app-new', job_id: 'job-from-monday' }),
    );
  });

  it('the race the lookup cannot close: the row the other window wrote is looked up and handed back', async () => {
    db.findJobByExternalId.mockResolvedValueOnce(ok(null)).mockResolvedValueOnce(ok(STORED));
    db.upsertJob.mockResolvedValue(err(duplicate));
    db.listApplications.mockResolvedValue(ok([APPLICATION]));

    const saved = await port().saveToTracker(JOB, { applicationId: 'app-new' }, NOW);

    expect(saved).toEqual(
      ok({ outcome: 'already-saved', job: STORED, applicationId: 'app-from-monday' }),
    );
    expect(db.upsertApplication).not.toHaveBeenCalled();
  });

  it('boundary: in that race, a row with no application yet comes back with none', async () => {
    db.findJobByExternalId.mockResolvedValueOnce(ok(null)).mockResolvedValueOnce(ok(STORED));
    db.upsertJob.mockResolvedValue(err(duplicate));

    const saved = await port().saveToTracker(JOB, { applicationId: 'app-new' }, NOW);

    expect(saved).toEqual(ok({ outcome: 'already-saved', job: STORED, applicationId: null }));
  });

  it('negative: in that race, a row that cannot be found is reported, never handed back as the fresh id', async () => {
    // The fresh UUID is not in the database. Handing it on would attach the
    // analysis history to a job that does not exist.
    db.upsertJob.mockResolvedValue(err(duplicate));

    const saved = await port().saveToTracker(JOB, { applicationId: 'app-new' }, NOW);

    expect(saved.ok).toBe(false);
  });

  it('negative: a failed application lookup for an existing row is reported', async () => {
    db.findJobByExternalId.mockResolvedValue(ok(STORED));
    db.listApplications.mockResolvedValue(err(failure));

    await expect(port().saveToTracker(JOB, { applicationId: 'a' }, NOW)).resolves.toEqual(
      err(failure),
    );
  });
});

describe('reading the full advert for a preview', () => {
  it('reads the page and writes the full advert onto the stored job', async () => {
    const page = `<html><body><main><p>${FULL_TEXT}</p></main></body></html>`;

    const read = await port(pageServing(page)).readFullAdvert(STORED);

    expect(read.note).toBeNull();
    expect(read.job.id).toBe('job-from-monday');
    expect(read.job.description).toContain('second-line credit risk');
    expect(db.upsertJob).toHaveBeenCalledWith({ ...STORED, description: read.job.description });
  });

  it('a page that cannot be read leaves the job untouched, and says so', async () => {
    const read = await port(pageServing('<html></html>', 404)).readFullAdvert(STORED);

    expect(read).toEqual({ job: STORED, note: PREVIEW_ONLY_NOTE });
    expect(db.upsertJob).not.toHaveBeenCalled();
  });

  it('a full advert is not read again: no request, no write', async () => {
    const full: Job = { ...STORED, source: 'arbeitnow', description: FULL_TEXT.repeat(3) };

    const read = await port(forbidden).readFullAdvert(full);

    expect(read).toEqual({ job: full, note: null });
    expect(db.upsertJob).not.toHaveBeenCalled();
  });

  it('negative: a failed write still hands on the full advert for this analysis', async () => {
    // The user pressed Analyse and the page was read; losing the text because
    // the tracker copy could not be updated would throw away the good half.
    db.upsertJob.mockResolvedValue(err(failure));
    const page = `<html><body><main><p>${FULL_TEXT}</p></main></body></html>`;

    const read = await port(pageServing(page)).readFullAdvert(STORED);

    expect(read.job.description).toContain('second-line credit risk');
    expect(read.note).toBeNull();
  });
});
