/**
 * The four port members the interview panel added (L-163): documents, the
 * profile and the latest CV text. Same arrangement as `port.test.ts` — `src/db`
 * is mocked, and what is asserted is the CONTRACT with the data layer — in a
 * separate file so that file's hoisted mock is left exactly as it was.
 */
import { err, ok, type Cv, type Document, type Profile } from '@cviper/core-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  listJobs: vi.fn(),
  listApplications: vi.fn(),
  upsertJob: vi.fn(),
  upsertApplication: vi.fn(),
  deleteJob: vi.fn(),
  listDocumentsForApplication: vi.fn(),
  upsertDocument: vi.fn(),
  getProfile: vi.fn(),
  listCvs: vi.fn(),
}));

vi.mock('../../db', () => db);

const { createDbTrackerPort } = await import('./port');

const failure = { code: 'QUERY_FAILED' as const, message: 'no such table', table: 'documents' };

function document(id: string, createdAt: string, kind: Document['kind'] = 'advert'): Document {
  return {
    id,
    application_id: 'app-1',
    kind,
    title: `Document ${id}`,
    text: 'text',
    created_at: createdAt,
  };
}

function cv(id: string, extracted: string | null): Cv {
  return {
    id,
    name: `${id}.pdf`,
    file_path: `/cvs/${id}.pdf`,
    extracted_text: extracted,
    created_at: '2026-08-19T09:00:00.000Z',
  } as Cv;
}

const PROFILE: Profile = {
  id: 'me',
  headline: 'Credit risk analyst',
  languages: [],
  work_rights: null,
  deal_breakers: [],
  target_sectors: [],
  career_goals: [],
  energising: [],
  draining: [],
  writing_style: null,
  star_examples: [],
  updated_at: '2026-08-19T09:00:00.000Z',
};

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.listDocumentsForApplication.mockResolvedValue(ok([]));
  db.upsertDocument.mockResolvedValue(ok(undefined));
  db.getProfile.mockResolvedValue(ok(null));
  db.listCvs.mockResolvedValue(ok([]));
});

describe('documentsFor', () => {
  it('asks the data layer for exactly this application, and answers OLDEST first', async () => {
    // The data layer lists newest first.
    db.listDocumentsForApplication.mockResolvedValue(
      ok([
        document('d3', '2026-08-21T09:00:00.000Z'),
        document('d2', '2026-08-20T09:00:00.000Z'),
        document('d1', '2026-08-19T09:00:00.000Z'),
      ]),
    );

    const listed = await createDbTrackerPort().documentsFor('app-1');

    expect(db.listDocumentsForApplication).toHaveBeenCalledWith('app-1');
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.value.map((entry) => entry.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('boundary: no documents is an empty list, not a failure', async () => {
    await expect(createDbTrackerPort().documentsFor('app-1')).resolves.toEqual(ok([]));
  });

  it('negative: passes a read failure straight through', async () => {
    db.listDocumentsForApplication.mockResolvedValue(err(failure));
    await expect(createDbTrackerPort().documentsFor('app-1')).resolves.toEqual(err(failure));
  });
});

describe('saveDocument', () => {
  it('hands the document to the data layer unchanged', async () => {
    const pack = document('pack-1', '2026-08-22T09:00:00.000Z', 'interview_pack');
    await expect(createDbTrackerPort().saveDocument(pack)).resolves.toEqual(ok(undefined));
    expect(db.upsertDocument).toHaveBeenCalledWith(pack);
  });

  it('negative: passes a write failure straight through', async () => {
    db.upsertDocument.mockResolvedValue(err(failure));
    const pack = document('pack-1', '2026-08-22T09:00:00.000Z', 'interview_pack');
    await expect(createDbTrackerPort().saveDocument(pack)).resolves.toEqual(err(failure));
  });
});

describe('profile', () => {
  it('returns the stored profile', async () => {
    db.getProfile.mockResolvedValue(ok(PROFILE));
    await expect(createDbTrackerPort().profile()).resolves.toEqual(ok(PROFILE));
  });

  it('boundary: no profile yet is null, not a failure', async () => {
    await expect(createDbTrackerPort().profile()).resolves.toEqual(ok(null));
  });

  it('negative: passes a read failure straight through', async () => {
    db.getProfile.mockResolvedValue(err(failure));
    await expect(createDbTrackerPort().profile()).resolves.toEqual(err(failure));
  });
});

describe('latestCvText', () => {
  it("answers with the newest CV's extracted text", async () => {
    // `listCvs` is newest first.
    db.listCvs.mockResolvedValue(ok([cv('new', 'Newest CV text'), cv('old', 'Older CV text')]));
    await expect(createDbTrackerPort().latestCvText()).resolves.toEqual(ok('Newest CV text'));
  });

  it('boundary: no CV at all is null', async () => {
    await expect(createDbTrackerPort().latestCvText()).resolves.toEqual(ok(null));
  });

  it('boundary: an unparsed newest CV is null — an older one does not stand in for it', async () => {
    db.listCvs.mockResolvedValue(ok([cv('new', null), cv('old', 'Older CV text')]));
    await expect(createDbTrackerPort().latestCvText()).resolves.toEqual(ok(null));
  });

  it('negative: passes a read failure straight through', async () => {
    db.listCvs.mockResolvedValue(err(failure));
    await expect(createDbTrackerPort().latestCvText()).resolves.toEqual(err(failure));
  });
});
