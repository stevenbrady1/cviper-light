/**
 * L-325 — the pure half of "Save this job to the tracker": which tracked job a
 * pasted advert already is, whether the offer is made at all, and the two rows
 * a save writes. Plus the port method that writes them, and the SQL it needs
 * already being on the approved list.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { err, ok, type Job } from '@cviper/core-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REPO_ROOT } from '../../lib/repo-scan';

// The analysis port's own five, which it reads when it is built, plus the two
// the tracker port writes with.
const db = vi.hoisted(() => ({
  listCvs: vi.fn(),
  listJobs: vi.fn(),
  upsertCv: vi.fn(),
  listAnalysesForCv: vi.fn(),
  upsertAnalysis: vi.fn(),
  upsertJob: vi.fn(),
  upsertApplication: vi.fn(),
}));

vi.mock('../../db', () => db);

const { createDbAnalysisPort } = await import('./port');
const { MAX_FIELD_LENGTH, MAX_DESCRIPTION_LENGTH } = await import('../tracker/model');
const { jobAdvertText } = await import('./model');
const { canOfferSave, trackedJobForAdvert, trackerEntryForAdvert } =
  await import('./saveToTracker');

const NOW = '2026-11-09T09:00:00.000Z';
const IDS = { jobId: 'job-new', applicationId: 'app-new' };
const ADVERT = 'Credit Risk Analyst. You will build SQL models and report on IFRS 9.';

const JOB: Job = {
  id: 'job-1',
  source: 'reed',
  external_id: '1',
  title: 'Credit Risk Analyst',
  company: 'Barclays',
  agency: null,
  location: 'London',
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  description: ADVERT,
  url: null,
  posted_date: null,
  created_at: '2026-09-01T09:00:00.000Z',
};

beforeEach(() => {
  db.upsertJob.mockReset();
  db.upsertApplication.mockReset();
  db.upsertJob.mockResolvedValue(ok(undefined));
  db.upsertApplication.mockResolvedValue(ok(undefined));
});

describe('canOfferSave', () => {
  it('happy: a checked paste with no tracked job is offered', () => {
    expect(canOfferSave(ADVERT, null)).toBe(true);
  });

  it('boundary: an empty or whitespace advert is never offered', () => {
    expect(canOfferSave('', null)).toBe(false);
    expect(canOfferSave('  \n\t ', null)).toBe(false);
    expect(canOfferSave(null, null)).toBe(false);
  });

  it('edge: an advert that is already a tracked job is not offered', () => {
    expect(canOfferSave(ADVERT, 'job-1')).toBe(false);
  });
});

describe('trackedJobForAdvert', () => {
  it('finds a job whose description is exactly the advert, trimmed', () => {
    expect(trackedJobForAdvert(`\n  ${ADVERT}  \n`, [JOB])?.id).toBe('job-1');
  });

  it('finds a job whose whole advert text is exactly the paste', () => {
    expect(trackedJobForAdvert(jobAdvertText(JOB), [JOB])?.id).toBe('job-1');
  });

  it('negative: never fuzzy-matches — one character different is a different advert', () => {
    expect(trackedJobForAdvert(`${ADVERT}!`, [JOB])).toBeNull();
    expect(trackedJobForAdvert(ADVERT.toLowerCase(), [JOB])).toBeNull();
    expect(trackedJobForAdvert('Credit Risk Analyst', [JOB])).toBeNull();
  });

  it('boundary: a blank paste matches nothing, not even a job with no description', () => {
    const bare: Job = { ...JOB, description: null, title: '', company: '', location: null };
    expect(trackedJobForAdvert('   ', [bare])).toBeNull();
    expect(trackedJobForAdvert('', [bare])).toBeNull();
  });
});

describe('trackerEntryForAdvert', () => {
  it('happy: builds a manual job holding the advert and a Saved application', () => {
    const built = trackerEntryForAdvert(
      { title: '  Credit Risk Analyst ', company: 'Lloyds' },
      `  ${ADVERT}\n`,
      IDS,
      NOW,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.entry.job).toMatchObject({
      id: 'job-new',
      source: 'manual',
      external_id: null,
      title: 'Credit Risk Analyst',
      company: 'Lloyds',
      location: null,
      description: ADVERT,
      salary_min: null,
      salary_max: null,
      salary_period: null,
      created_at: NOW,
    });
    expect(built.entry.application).toMatchObject({
      id: 'app-new',
      job_id: 'job-new',
      status: 'saved',
      applied_date: null,
      updated_at: NOW,
    });
  });

  it('negative: a blank title or company is refused with the tracker’s own messages', () => {
    const built = trackerEntryForAdvert({ title: '  ', company: '' }, ADVERT, IDS, NOW);
    expect(built).toEqual({
      ok: false,
      errors: {
        title: 'Add a job title so you can tell this card from the others.',
        company: 'Add the company so you know who you applied to.',
      },
    });
  });

  it(`boundary: a ${MAX_FIELD_LENGTH}-character title is accepted and ${MAX_FIELD_LENGTH + 1} refused`, () => {
    expect(MAX_FIELD_LENGTH).toBe(200);
    const atLimit = trackerEntryForAdvert(
      { title: 'a'.repeat(MAX_FIELD_LENGTH), company: 'Lloyds' },
      ADVERT,
      IDS,
      NOW,
    );
    expect(atLimit.ok).toBe(true);

    const over = trackerEntryForAdvert(
      { title: 'a'.repeat(MAX_FIELD_LENGTH + 1), company: 'Lloyds' },
      ADVERT,
      IDS,
      NOW,
    );
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.errors.title).toBe('Job title is too long. Keep it to 200 characters or fewer.');
  });

  it('boundary: an advert over the description cap is refused, not cut', () => {
    const over = trackerEntryForAdvert(
      { title: 'Analyst', company: 'Lloyds' },
      'x'.repeat(MAX_DESCRIPTION_LENGTH + 1),
      IDS,
      NOW,
    );
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.errors.description).toContain('longer than 50,000 characters');

    const atCap = trackerEntryForAdvert(
      { title: 'Analyst', company: 'Lloyds' },
      'x'.repeat(MAX_DESCRIPTION_LENGTH),
      IDS,
      NOW,
    );
    expect(atCap.ok).toBe(true);
  });
});

describe('AnalysisPort.addToTracker', () => {
  it('writes the job first, then the application', async () => {
    const built = trackerEntryForAdvert({ title: 'Analyst', company: 'Lloyds' }, ADVERT, IDS, NOW);
    if (!built.ok) throw new Error('entry did not build');
    const order: string[] = [];
    db.upsertJob.mockImplementation(async () => (order.push('job'), ok(undefined)));
    db.upsertApplication.mockImplementation(async () => (order.push('application'), ok(undefined)));

    await expect(createDbAnalysisPort().addToTracker?.(built.entry)).resolves.toEqual(
      ok(undefined),
    );
    expect(db.upsertJob).toHaveBeenCalledWith(built.entry.job);
    expect(db.upsertApplication).toHaveBeenCalledWith(built.entry.application);
    expect(order).toEqual(['job', 'application']);
  });

  it('negative: a refused job write is reported, and no application is written', async () => {
    const failure = { code: 'QUERY_FAILED' as const, message: 'disk full', table: 'jobs' };
    db.upsertJob.mockResolvedValue(err(failure));
    const built = trackerEntryForAdvert({ title: 'Analyst', company: 'Lloyds' }, ADVERT, IDS, NOW);
    if (!built.ok) throw new Error('entry did not build');

    await expect(createDbAnalysisPort().addToTracker?.(built.entry)).resolves.toEqual(err(failure));
    expect(db.upsertApplication).not.toHaveBeenCalled();
  });
});

describe('regression: saving needs no new SQL', () => {
  const rust = readFileSync(
    join(REPO_ROOT, 'apps', 'light', 'src-tauri', 'src', 'approved_sql.rs'),
    'utf8',
  );

  it('the job and application INSERTs are already on the approved list', () => {
    expect(rust).toContain('r##"INSERT INTO jobs (id, source, external_id, title, company,');
    expect(rust).toContain('r##"INSERT INTO applications (id, job_id, status,');
  });

  it('re-saving an analysis with its job is an upsert on id, already approved', () => {
    expect(rust).toMatch(
      /INSERT INTO analyses \(id, cv_id, job_id[^"]*ON CONFLICT \(id\) DO UPDATE SET[^"]*job_id = excluded\.job_id/u,
    );
  });
});
