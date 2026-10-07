/**
 * The saved half of a job's progress (L-200): an analysis against the job,
 * and a tailored CV saved to one of its applications. The data layer is
 * mocked; what is under test is which rows count.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { err, ok, type Analysis, type Application, type Document } from '@cviper/core-types';

const db = vi.hoisted(() => ({
  listAnalyses: vi.fn(),
  listApplications: vi.fn(),
  listDocumentsForApplication: vi.fn(),
  listDocuments: vi.fn(),
}));

vi.mock('../../db', () => db);

const { createDbBoardProgressPort, createDbJobProgressPort } = await import('./progress');

function analysis(jobId: string | null): Analysis {
  return {
    id: `an-${jobId ?? 'none'}`,
    cv_id: 'cv-1',
    job_id: jobId,
    provider: 'keyword',
    model: 'keyword',
    match_score: 60,
    result_json: '{}',
    created_at: '2026-10-06T09:00:00.000Z',
  } as unknown as Analysis;
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
    updated_at: '2026-10-06T09:00:00.000Z',
  };
}

function document(applicationId: string, kind: Document['kind']): Document {
  return {
    id: `doc-${applicationId}-${kind}`,
    application_id: applicationId,
    kind,
    title: 'x',
    text: 'x',
    created_at: '2026-10-06T09:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.listAnalyses.mockResolvedValue(ok([]));
  db.listApplications.mockResolvedValue(ok([]));
  db.listDocumentsForApplication.mockResolvedValue(ok([]));
  db.listDocuments.mockResolvedValue(ok([]));
});

describe('createDbJobProgressPort', () => {
  it('happy: an analysis for the job and a saved CV on its application', async () => {
    db.listAnalyses.mockResolvedValue(ok([analysis('job-1')]));
    db.listApplications.mockResolvedValue(ok([application('app-1', 'job-1')]));
    db.listDocumentsForApplication.mockResolvedValue(ok([document('app-1', 'cv')]));

    expect(await createDbJobProgressPort().load('job-1')).toEqual({
      analysed: true,
      exported: true,
    });
  });

  it('negative: another job’s analysis and a pasted-advert analysis do not count', async () => {
    db.listAnalyses.mockResolvedValue(ok([analysis('job-2'), analysis(null)]));
    expect((await createDbJobProgressPort().load('job-1')).analysed).toBe(false);
  });

  it('negative: a saved letter or edited advert is not an exported CV', async () => {
    db.listApplications.mockResolvedValue(ok([application('app-1', 'job-1')]));
    db.listDocumentsForApplication.mockResolvedValue(
      ok([document('app-1', 'cover_letter'), document('app-1', 'advert')]),
    );
    expect((await createDbJobProgressPort().load('job-1')).exported).toBe(false);
  });

  it('only reads the documents of THIS job’s applications', async () => {
    db.listApplications.mockResolvedValue(
      ok([application('app-1', 'job-1'), application('app-2', 'job-2')]),
    );
    await createDbJobProgressPort().load('job-1');
    expect(db.listDocumentsForApplication.mock.calls).toEqual([['app-1']]);
  });

  it('boundary: a failed read is "not done" — a hint lost, never an error', async () => {
    const failure = { code: 'QUERY_FAILED', message: 'locked', table: null };
    db.listAnalyses.mockResolvedValue(err(failure));
    db.listApplications.mockResolvedValue(err(failure));
    expect(await createDbJobProgressPort().load('job-1')).toEqual({
      analysed: false,
      exported: false,
    });
  });
});

describe('createDbBoardProgressPort', () => {
  it('happy: one pass over the board, keyed by job', async () => {
    db.listAnalyses.mockResolvedValue(ok([analysis('job-1'), analysis('job-2')]));
    db.listApplications.mockResolvedValue(
      ok([application('app-1', 'job-1'), application('app-3', 'job-3')]),
    );
    db.listDocuments.mockResolvedValue(
      ok([document('app-3', 'cv'), document('app-1', 'cover_letter')]),
    );

    const all = await createDbBoardProgressPort().loadAll();

    expect(Object.fromEntries(all)).toEqual({
      'job-1': { analysed: true, exported: false },
      'job-2': { analysed: true, exported: false },
      'job-3': { analysed: false, exported: true },
    });
    // Three reads for the whole board, never one per application.
    expect(db.listDocumentsForApplication).not.toHaveBeenCalled();
  });

  it('negative: a pasted-advert analysis and an orphan document mark nobody', async () => {
    db.listAnalyses.mockResolvedValue(ok([analysis(null)]));
    db.listDocuments.mockResolvedValue(ok([document('app-gone', 'cv')]));
    expect((await createDbBoardProgressPort().loadAll()).size).toBe(0);
  });

  it('boundary: every read failing gives an empty board, not an error', async () => {
    const failure = { code: 'QUERY_FAILED', message: 'locked', table: null };
    db.listAnalyses.mockResolvedValue(err(failure));
    db.listApplications.mockResolvedValue(err(failure));
    db.listDocuments.mockResolvedValue(err(failure));
    expect((await createDbBoardProgressPort().loadAll()).size).toBe(0);
  });
});
