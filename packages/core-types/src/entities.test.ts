import { describe, expect, it } from 'vitest';

import {
  DocumentSchema,
  PROFILE_ID,
  ProfileSchema,
  emptyProfile,
  type Document,
  type Profile,
} from './entities';

/**
 * The two entities added for the writing loop: the candidate profile (L-154)
 * and the documents archived against an application (L-155).
 *
 * The profile is a SINGLE ROW with a fixed id. There is one user of this app
 * and one profile, so `id` is a constant rather than a UUID — an upsert always
 * hits the same row and there is nothing to list.
 */

const NOW = '2026-09-14T09:00:00.000Z';

const FULL_PROFILE: Profile = {
  id: PROFILE_ID,
  headline: 'Credit risk analyst moving into quant development',
  languages: [
    { name: 'English', level: 'Native' },
    { name: 'French', level: 'Conversational' },
  ],
  work_rights: 'UK citizen',
  deal_breakers: ['Fully on-site', 'Below GBP 70k'],
  target_sectors: ['Banking', 'Hedge funds'],
  career_goals: ['Lead a small modelling team'],
  energising: ['Hard technical problems'],
  draining: ['Status meetings'],
  writing_style: 'Plain, short sentences.',
  star_examples: [
    {
      title: 'IFRS 9 staging rebuild',
      situation: 'The staging logic failed audit.',
      task: 'Rebuild it in a quarter.',
      action: 'Rewrote the rules engine in Python with a test per rule.',
      result: 'Passed the re-audit with no findings.',
    },
  ],
  updated_at: NOW,
};

const DOCUMENT: Document = {
  id: 'doc-0001',
  application_id: 'app-0001',
  kind: 'cover_letter',
  title: 'Cover letter — Barclays',
  text: 'Dear hiring manager,',
  created_at: NOW,
};

describe('emptyProfile', () => {
  it('is the fixed id, every list empty, every text null, and the timestamp it was given', () => {
    expect(emptyProfile(NOW)).toEqual({
      id: 'me',
      headline: null,
      languages: [],
      work_rights: null,
      deal_breakers: [],
      target_sectors: [],
      career_goals: [],
      energising: [],
      draining: [],
      writing_style: null,
      star_examples: [],
      updated_at: NOW,
    });
    expect(PROFILE_ID).toBe('me');
  });

  it('is valid against its own schema, so a fresh profile can always be saved', () => {
    expect(ProfileSchema.safeParse(emptyProfile(NOW)).success).toBe(true);
  });

  it('returns a fresh object each time, so one caller editing it cannot change another', () => {
    const first = emptyProfile(NOW);
    const second = emptyProfile(NOW);
    expect(first).not.toBe(second);
    expect(first.languages).not.toBe(second.languages);
  });
});

describe('ProfileSchema', () => {
  it('accepts a fully populated profile unchanged', () => {
    const parsed = ProfileSchema.safeParse(FULL_PROFILE);
    expect(parsed.success && parsed.data).toEqual(FULL_PROFILE);
  });

  it('negative: refuses languages that are not an array', () => {
    const parsed = ProfileSchema.safeParse({ ...FULL_PROFILE, languages: 'English' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['languages']);
  });

  it('negative: refuses a language row missing its level', () => {
    const parsed = ProfileSchema.safeParse({ ...FULL_PROFILE, languages: [{ name: 'English' }] });
    expect(parsed.success).toBe(false);
  });

  it('negative: refuses a STAR example missing one of its five parts', () => {
    const [example] = FULL_PROFILE.star_examples;
    if (example === undefined) throw new Error('fixture has no example');
    const { result: _dropped, ...withoutResult } = example;
    const parsed = ProfileSchema.safeParse({ ...FULL_PROFILE, star_examples: [withoutResult] });
    expect(parsed.success).toBe(false);
  });

  it('negative: refuses an updated_at carrying a local offset', () => {
    const parsed = ProfileSchema.safeParse({
      ...FULL_PROFILE,
      updated_at: '2026-09-14T09:00:00+01:00',
    });
    expect(parsed.success).toBe(false);
  });

  it('boundary: a list holding one empty string is still a list of strings', () => {
    // Trimming and dropping blanks is the view's job (`profile/model.ts`); the
    // schema is only about shape, so the data layer never edits what it stores.
    const parsed = ProfileSchema.safeParse({ ...FULL_PROFILE, deal_breakers: [''] });
    expect(parsed.success).toBe(true);
  });
});

describe('DocumentSchema', () => {
  it('accepts every document kind', () => {
    for (const kind of ['advert', 'cv', 'cover_letter', 'follow_up', 'interview_pack']) {
      expect(DocumentSchema.safeParse({ ...DOCUMENT, kind }).success, kind).toBe(true);
    }
  });

  it('negative: refuses a kind outside the closed set', () => {
    const parsed = DocumentSchema.safeParse({ ...DOCUMENT, kind: 'thank_you' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['kind']);
  });

  it('negative: refuses a document with no application to belong to', () => {
    expect(DocumentSchema.safeParse({ ...DOCUMENT, application_id: null }).success).toBe(false);
  });

  it('boundary: an empty text is a document, not a missing one', () => {
    const parsed = DocumentSchema.safeParse({ ...DOCUMENT, text: '' });
    expect(parsed.success && parsed.data.text).toBe('');
  });
});
