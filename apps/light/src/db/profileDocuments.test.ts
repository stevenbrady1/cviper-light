/**
 * Tests for the profile and documents query modules (L-154, L-155).
 *
 * Same shape as `queries.test.ts`: the RENDERED SQL and the bound parameters
 * are asserted, never the source that produced them. No real database is
 * involved; `@tauri-apps/plugin-sql` is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PROFILE_ID,
  emptyProfile,
  isErr,
  isOk,
  type Document,
  type Profile,
} from '@cviper/core-types';

import { TABLE_COLUMNS } from './rows';

const sql = vi.hoisted(() => {
  const execute = vi.fn<(query: string, values?: unknown[]) => Promise<{ rowsAffected: number }>>();
  const select = vi.fn<(query: string, values?: unknown[]) => Promise<unknown[]>>();
  const load = vi.fn<(url: string) => Promise<unknown>>();
  return { execute, select, load, db: { execute, select } };
});

vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: sql.load } }));

const PRAGMA = /^PRAGMA/i;

function writes(): { query: string; values: unknown[] | undefined }[] {
  return sql.execute.mock.calls
    .filter((call) => !PRAGMA.test(call[0]))
    .map((call) => ({ query: call[0], values: call[1] }));
}

function reads(): { query: string; values: unknown[] | undefined }[] {
  return sql.select.mock.calls.map((call) => ({ query: call[0], values: call[1] }));
}

beforeEach(() => {
  vi.resetModules();
  sql.execute.mockReset();
  sql.select.mockReset();
  sql.load.mockReset();

  sql.execute.mockResolvedValue({ rowsAffected: 1 });
  sql.select.mockResolvedValue([]);
  sql.load.mockResolvedValue(sql.db);
});

// --- Fixtures ---------------------------------------------------------------

const PROFILE: Profile = {
  ...emptyProfile('2026-09-14T09:00:00.000Z'),
  headline: 'Credit risk analyst',
  languages: [{ name: 'French', level: 'B2' }],
  deal_breakers: ['Fully on-site'],
};

const DOCUMENT: Document = {
  id: 'doc-0001',
  application_id: 'app-0001',
  kind: 'cover_letter',
  title: 'Cover letter',
  text: 'Dear hiring manager,',
  created_at: '2026-09-14T09:05:00.000Z',
};

// --- statements -------------------------------------------------------------

describe('statement builders for the new tables', () => {
  it('renders the profile SELECT with every column named, never SELECT *', async () => {
    const { selectFrom } = await import('./statements');

    expect(selectFrom('profile')).toBe(
      'SELECT id, headline, languages_json, work_rights, deal_breakers_json, ' +
        'target_sectors_json, career_goals_json, energising_json, draining_json, ' +
        'writing_style, star_examples_json, updated_at FROM profile',
    );
  });

  it('renders the documents upsert exactly', async () => {
    const { upsertInto } = await import('./statements');

    expect(upsertInto('documents')).toBe(
      'INSERT INTO documents (id, application_id, kind, title, text, created_at) ' +
        'VALUES ($1, $2, $3, $4, $5, $6) ' +
        'ON CONFLICT (id) DO UPDATE SET application_id = excluded.application_id, ' +
        'kind = excluded.kind, title = excluded.title, text = excluded.text, ' +
        'created_at = excluded.created_at',
    );
  });
});

// --- profile ----------------------------------------------------------------

describe('profile', () => {
  it('reads the one row by the fixed id, bound as a parameter', async () => {
    const { getProfile } = await import('./profile');

    await getProfile();

    expect(reads()[0]?.query).toBe(
      'SELECT id, headline, languages_json, work_rights, deal_breakers_json, ' +
        'target_sectors_json, career_goals_json, energising_json, draining_json, ' +
        'writing_style, star_examples_json, updated_at FROM profile WHERE id = $1',
    );
    expect(reads()[0]?.values).toEqual([PROFILE_ID]);
  });

  it('boundary: no row is null, not an error and not an empty profile', async () => {
    // The view decides what "no profile yet" looks like; the data layer must
    // not invent one, or "has the user ever filled this in" becomes unanswerable.
    const { getProfile } = await import('./profile');

    const result = await getProfile();

    expect(isOk(result) && result.value).toBeNull();
  });

  it('reads the row back as a profile with real arrays', async () => {
    const { profileToValues, PROFILE_COLUMNS } = await import('./rows');
    const values = profileToValues(PROFILE);
    if (!isOk(values)) throw new Error('fixture failed to serialise');
    sql.select.mockResolvedValue([
      Object.fromEntries(PROFILE_COLUMNS.map((column, index) => [column, values.value[index]])),
    ]);

    const { getProfile } = await import('./profile');
    const result = await getProfile();

    expect(isOk(result) && result.value).toEqual(PROFILE);
  });

  it('negative: a row whose list column is not JSON is a MALFORMED_ROW, not a crash', async () => {
    const { profileToValues, PROFILE_COLUMNS } = await import('./rows');
    const values = profileToValues(PROFILE);
    if (!isOk(values)) throw new Error('fixture failed to serialise');
    const row = Object.fromEntries(
      PROFILE_COLUMNS.map((column, index) => [column, values.value[index]]),
    );
    sql.select.mockResolvedValue([{ ...row, languages_json: '{broken' }]);

    const { getProfile } = await import('./profile');
    const result = await getProfile();

    expect(isErr(result) && result.error.code).toBe('MALFORMED_ROW');
    expect(isErr(result) && result.error.table).toBe('profile');
  });

  it('upserts every column value in column order, with the lists as JSON strings', async () => {
    const { profileToValues } = await import('./rows');
    const { upsertProfile } = await import('./profile');

    const result = await upsertProfile(PROFILE);

    expect(isOk(result)).toBe(true);
    const expected = profileToValues(PROFILE);
    expect(isOk(expected) && writes()[0]?.values).toEqual(isOk(expected) && expected.value);
    expect(writes()[0]?.query).toMatch(/^INSERT INTO profile \(/);
    expect(writes()[0]?.query).toContain('ON CONFLICT (id) DO UPDATE SET');
    const index = TABLE_COLUMNS.profile.indexOf('languages_json');
    expect(typeof writes()[0]?.values?.[index]).toBe('string');
  });

  it('negative: refuses to write a profile it cannot serialise, without touching the database', async () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    const { upsertProfile } = await import('./profile');
    const result = await upsertProfile({
      ...PROFILE,
      star_examples: [circular as unknown as Profile['star_examples'][number]],
    });

    expect(isErr(result) && result.error.code).toBe('SERIALISE_FAILED');
    expect(writes()).toHaveLength(0);
  });

  it('negative: reports a failed write rather than pretending it stuck', async () => {
    // Only the write refuses; the connection-time PRAGMA still succeeds, so
    // this is a QUERY failure and not a CONNECTION one.
    sql.execute.mockImplementation(async (query: string) => {
      if (PRAGMA.test(query)) return { rowsAffected: 0 };
      throw new Error('database is locked');
    });

    const { upsertProfile } = await import('./profile');
    const result = await upsertProfile(PROFILE);

    expect(isErr(result) && result.error.code).toBe('QUERY_FAILED');
    expect(isErr(result) && result.error.message).toContain('database is locked');
  });
});

// --- documents --------------------------------------------------------------

describe('documents', () => {
  it('binds every column value in column order on upsert', async () => {
    const { documentToValues } = await import('./rows');
    const { upsertDocument } = await import('./documents');

    await upsertDocument(DOCUMENT);

    expect(writes()[0]?.values).toEqual(documentToValues(DOCUMENT));
  });

  it('lists newest first', async () => {
    const { listDocuments } = await import('./documents');

    await listDocuments();

    expect(reads()[0]?.query).toMatch(/FROM documents ORDER BY created_at DESC, id$/);
  });

  it('lists the documents for one application through a bound parameter', async () => {
    const { listDocumentsForApplication } = await import('./documents');

    await listDocumentsForApplication('app-0001');

    expect(reads()[0]?.query).toMatch(/WHERE application_id = \$1 ORDER BY created_at DESC, id$/);
    expect(reads()[0]?.values).toEqual(['app-0001']);
  });

  it('boundary: an application with no documents is an empty list, not a failure', async () => {
    const { listDocumentsForApplication } = await import('./documents');

    const result = await listDocumentsForApplication('app-0001');

    expect(isOk(result) && result.value).toEqual([]);
  });

  it('negative: refuses the whole list when one row has a kind outside the set', async () => {
    const { documentToValues, DOCUMENT_COLUMNS } = await import('./rows');
    const values = documentToValues(DOCUMENT);
    const row = Object.fromEntries(
      DOCUMENT_COLUMNS.map((column, index) => [column, values[index]]),
    );
    sql.select.mockResolvedValue([row, { ...row, id: 'doc-0002', kind: 'thank_you' }]);

    const { listDocuments } = await import('./documents');
    const result = await listDocuments();

    expect(isErr(result) && result.error.code).toBe('MALFORMED_ROW');
    expect(isErr(result) && result.error.table).toBe('documents');
  });

  it('deletes by id', async () => {
    const { deleteDocument } = await import('./documents');

    await deleteDocument('doc-0001');

    expect(writes()[0]?.query).toBe('DELETE FROM documents WHERE id = $1');
    expect(writes()[0]?.values).toEqual(['doc-0001']);
  });

  it('negative: classifies a foreign-key refusal as a constraint violation', async () => {
    // A document for an application that does not exist. The message is
    // SQLite's own and is carried through verbatim.
    sql.execute.mockImplementation(async (query: string) => {
      if (PRAGMA.test(query)) return { rowsAffected: 0 };
      throw new Error('FOREIGN KEY constraint failed');
    });

    const { upsertDocument } = await import('./documents');
    const result = await upsertDocument({ ...DOCUMENT, application_id: 'nope' });

    expect(isErr(result) && result.error.code).toBe('CONSTRAINT_VIOLATION');
  });
});
