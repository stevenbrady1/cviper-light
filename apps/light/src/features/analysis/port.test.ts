/**
 * `src/db` is mocked, because it talks to `tauri-plugin-sql` and there is no
 * Tauri runtime here. What is asserted is the CONTRACT with the data layer:
 * which function each port method reaches for, and that a refusal comes back
 * untouched rather than being swallowed into an empty list.
 */
import { err, ok } from '@cviper/core-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  listCvs: vi.fn(),
  listJobs: vi.fn(),
  upsertCv: vi.fn(),
  listAnalysesForCv: vi.fn(),
  upsertAnalysis: vi.fn(),
}));

vi.mock('../../db', () => db);

const { createDbAnalysisPort } = await import('./port');

const NOW = '2026-08-19T09:00:00.000Z';

const CV = {
  id: 'cv-1',
  name: 'CV.pdf',
  file_path: 'C:\\CV.pdf',
  extracted_text: 'text',
  json_resume: null,
  created_at: NOW,
};

const failure = { code: 'QUERY_FAILED' as const, message: 'no such table', table: 'cvs' };

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.listCvs.mockResolvedValue(ok([]));
  db.listJobs.mockResolvedValue(ok([]));
  db.upsertCv.mockResolvedValue(ok(undefined));
  db.listAnalysesForCv.mockResolvedValue(ok([]));
  db.upsertAnalysis.mockResolvedValue(ok(undefined));
});

describe('loadCvs', () => {
  it('returns what the data layer returned', async () => {
    db.listCvs.mockResolvedValue(ok([CV]));
    await expect(createDbAnalysisPort().loadCvs()).resolves.toEqual(ok([CV]));
  });

  it('boundary: no CVs yet is an empty list, not a failure', async () => {
    await expect(createDbAnalysisPort().loadCvs()).resolves.toEqual(ok([]));
  });

  it('negative: a database refusal passes straight through', async () => {
    db.listCvs.mockResolvedValue(err(failure));
    await expect(createDbAnalysisPort().loadCvs()).resolves.toEqual(err(failure));
  });
});

describe('loadHistory', () => {
  it('asks for the analyses of exactly the CV it was given', async () => {
    await createDbAnalysisPort().loadHistory('cv-7');
    expect(db.listAnalysesForCv).toHaveBeenCalledWith('cv-7');
  });

  it('negative: a refusal passes through', async () => {
    db.listAnalysesForCv.mockResolvedValue(err(failure));
    await expect(createDbAnalysisPort().loadHistory('cv-7')).resolves.toEqual(err(failure));
  });
});

describe('saveCv and saveAnalysis', () => {
  it('write through to the data layer', async () => {
    const port = createDbAnalysisPort();
    await port.saveCv(CV);

    expect(db.upsertCv).toHaveBeenCalledWith(CV);
  });

  it('negative: a rejected write is reported, never reported as success', async () => {
    db.upsertAnalysis.mockResolvedValue(err(failure));

    const written = await createDbAnalysisPort().saveAnalysis({
      id: 'an-1',
      cv_id: 'cv-1',
      job_id: null,
      provider: 'keyword',
      model: 'keyword-v3',
      match_score: 50,
      result_json: {
        match_score: 50,
        verdict: 'weak',
        summary: '',
        matched_skills: [],
        missing_skills: [],
        keyword_gaps: [],
        matched_keywords: [],
        suggestions: [],
        ats_notes: [],
      },
      created_at: NOW,
    });

    expect(written).toEqual(err(failure));
  });
});

describe('loadJobs', () => {
  it('is how a tracked advert reaches the analysis screen', async () => {
    await createDbAnalysisPort().loadJobs();
    expect(db.listJobs).toHaveBeenCalledTimes(1);
  });
});
