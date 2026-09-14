import { describe, expect, it } from 'vitest';

import { BACKUP_SCHEMA_VERSION, exportBackup, importBackup, type BackupPayload } from './backup';
import {
  DocumentSchema,
  PROFILE_ID,
  ProfileSchema,
  emptyProfile,
  type Document,
  type Profile,
} from './entities';

/**
 * `profile` and `documents` (L-154, L-155) are the second and third additions
 * to the format after v1 shipped. Additive, so the version stays 1: a backup
 * written before either existed must still import — with no profile and no
 * documents — and one written after must carry both through untouched.
 *
 * `backup.compat.test.ts` is the sibling for `json_resume`, the first such
 * addition; this file follows the same shape for two whole top-level keys
 * rather than one field.
 */

const NOW = '2026-09-14T09:00:00.000Z';

const BASE: Omit<BackupPayload, 'profile' | 'documents'> = {
  schemaVersion: BACKUP_SCHEMA_VERSION,
  exportedAt: NOW,
  app: { name: 'cviper-light', version: '0.1.0' },
  jobs: [
    {
      id: 'job-1',
      source: 'manual',
      external_id: null,
      title: 'Quant Developer',
      company: 'Man Group',
      location: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      description: null,
      url: null,
      posted_date: null,
      created_at: NOW,
    },
  ],
  applications: [
    {
      id: 'app-1',
      job_id: 'job-1',
      status: 'applied',
      applied_date: '2026-09-10',
      notes: null,
      next_action: null,
      next_action_date: null,
      updated_at: NOW,
    },
  ],
  cvs: [],
  analyses: [],
};

const PROFILE: Profile = {
  ...emptyProfile(NOW),
  headline: 'Credit risk analyst',
  languages: [{ name: 'French', level: 'Conversational' }],
  deal_breakers: ['Fully on-site'],
  star_examples: [
    {
      title: 'IFRS 9 rebuild',
      situation: 'Failed audit.',
      task: 'Rebuild it.',
      action: 'Rewrote it.',
      result: 'Passed.',
    },
  ],
};

const COVER_LETTER: Document = {
  id: 'doc-b',
  application_id: 'app-1',
  kind: 'cover_letter',
  title: 'Cover letter',
  text: 'Dear hiring manager,',
  created_at: NOW,
};

const ADVERT: Document = {
  id: 'doc-a',
  application_id: 'app-1',
  kind: 'advert',
  title: 'The advert as posted',
  text: 'Quant Developer, London.',
  created_at: NOW,
};

function parse(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('an older backup without the keys', () => {
  it('imports with no profile and no documents, and nothing mistaken for an extra', () => {
    const imported = importBackup(JSON.stringify(BASE));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.profile).toBeNull();
    expect(imported.value.documents).toEqual([]);
    expect(imported.value.__extra).toBeUndefined();
  });

  it('boundary: an explicit null profile is the same as no profile', () => {
    const imported = importBackup(JSON.stringify({ ...BASE, profile: null }));
    expect(imported.ok && imported.value.profile).toBeNull();
  });
});

describe('a new export', () => {
  it('carries the profile and the documents, and both survive a round trip', () => {
    const exported = exportBackup({ ...BASE, profile: PROFILE, documents: [COVER_LETTER] });

    const back = importBackup(exported);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.profile).toEqual(PROFILE);
    expect(back.value.documents).toEqual([COVER_LETTER]);
  });

  it('writes the keys in the canonical order: profile after app, documents after applications', () => {
    const exported = parse(exportBackup({ ...BASE, profile: PROFILE, documents: [COVER_LETTER] }));

    expect(Object.keys(exported)).toEqual([
      'schemaVersion',
      'exportedAt',
      'app',
      'profile',
      'jobs',
      'applications',
      'documents',
      'cvs',
      'analyses',
    ]);
  });

  it('writes an empty profile as null and no documents as an empty array', () => {
    const exported = parse(exportBackup({ ...BASE, profile: null, documents: [] }));
    expect(exported['profile']).toBeNull();
    expect(exported['documents']).toEqual([]);
  });

  it('sorts documents by id like every other collection', () => {
    const exported = exportBackup({ ...BASE, profile: null, documents: [COVER_LETTER, ADVERT] });
    const documents = parse(exported)['documents'] as Array<{ id: string }>;
    expect(documents.map((document) => document.id)).toEqual(['doc-a', 'doc-b']);
  });

  it('emits every field of the profile and of a document, so a new column cannot be dropped', () => {
    const exported = parse(exportBackup({ ...BASE, profile: PROFILE, documents: [COVER_LETTER] }));

    const profile = exported['profile'] as Record<string, unknown>;
    expect(Object.keys(profile).sort()).toEqual(Object.keys(ProfileSchema.shape).sort());

    const [document] = exported['documents'] as Array<Record<string, unknown>>;
    expect(Object.keys(document ?? {}).sort()).toEqual(Object.keys(DocumentSchema.shape).sort());
  });

  it('writes the profile fields in declaration order', () => {
    const exported = parse(exportBackup({ ...BASE, profile: PROFILE, documents: [] }));
    expect(Object.keys(exported['profile'] as object)).toEqual(Object.keys(ProfileSchema.shape));
  });
});

describe('unknown fields', () => {
  it('are carried through the profile and a document exactly as for the other entities', () => {
    const document = parse(exportBackup({ ...BASE, profile: PROFILE, documents: [COVER_LETTER] }));
    (document['profile'] as Record<string, unknown>)['cloudAvatar'] = 'a.png';
    (document['documents'] as Array<Record<string, unknown>>)[0]!['wordCount'] = 212;

    const imported = importBackup(document);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.profile?.__extra).toEqual({ cloudAvatar: 'a.png' });
    expect(imported.value.documents[0]?.__extra).toEqual({ wordCount: 212 });

    const roundTripped = parse(exportBackup(imported.value));
    expect((roundTripped['profile'] as Record<string, unknown>)['cloudAvatar']).toBe('a.png');
    expect((roundTripped['documents'] as Array<Record<string, unknown>>)[0]?.['wordCount']).toBe(
      212,
    );
    expect(JSON.stringify(roundTripped)).not.toContain('__extra');
  });
});

describe('negative: records the format refuses', () => {
  it('a document kind outside the closed set, naming where', () => {
    const imported = importBackup(
      JSON.stringify({ ...BASE, documents: [{ ...COVER_LETTER, kind: 'thank_you' }] }),
    );
    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.error.code).toBe('INVALID_RECORD');
    expect(imported.error.path).toBe('documents[0].kind');
  });

  it('a profile whose languages is not an array, naming where', () => {
    const imported = importBackup(
      JSON.stringify({ ...BASE, profile: { ...PROFILE, languages: 'French' } }),
    );
    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.error.code).toBe('INVALID_RECORD');
    expect(imported.error.path).toBe('profile.languages');
  });

  it('a profile that is not an object at all', () => {
    const imported = importBackup(JSON.stringify({ ...BASE, profile: 'me' }));
    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.error.path).toBe('profile');
  });

  it('a documents value that is present but not an array', () => {
    const imported = importBackup(JSON.stringify({ ...BASE, documents: {} }));
    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.error.path).toBe('documents');
  });

  it('is atomic: a bad document imports no profile either', () => {
    const result = importBackup(
      JSON.stringify({
        ...BASE,
        profile: PROFILE,
        documents: [{ ...COVER_LETTER, created_at: 'yesterday' }],
      }),
    );
    expect(result.ok).toBe(false);
    expect('value' in result).toBe(false);
  });

  it('boundary: a profile with a different id is still refused nowhere — the id is data', () => {
    // The format does not police the id; the app writes `PROFILE_ID` and the
    // database keys on it. A cloud export using its own id must still import.
    const imported = importBackup(JSON.stringify({ ...BASE, profile: { ...PROFILE, id: 'u-1' } }));
    expect(imported.ok && imported.value.profile?.id).toBe('u-1');
    expect(PROFILE_ID).not.toBe('u-1');
  });
});
