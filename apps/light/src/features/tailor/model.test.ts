import { describe, expect, it } from 'vitest';

import { type Cv, type Profile } from '@cviper/core-types';

import { type ProviderOption } from '../analysis/providers';

import {
  LETTER_WORD_LIMIT,
  MIN_TEXT_CHARS,
  NO_AI_REASON,
  documentTitle,
  exportFileName,
  newDocument,
  profileNotes,
  runDisabledReason,
  tailorOptions,
} from './model';

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.docx',
  file_path: null,
  extracted_text: 'Credit risk analyst, eight years in London banking. SQL, Python, IFRS 9.',
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

const KEYWORD: ProviderOption = {
  key: 'keyword',
  kind: 'keyword',
  label: 'Basic match — no key needed',
  note: '',
  model: null,
  local: true,
  needsKey: false,
};

const OLLAMA: ProviderOption = {
  key: 'ollama:llama3.2',
  kind: 'ollama',
  label: 'Ollama · llama3.2',
  note: '',
  model: 'llama3.2',
  local: true,
  needsKey: false,
};

const ADVERT = 'Credit Risk Analyst. SQL models, IFRS 9 impairment, Python essential.';

describe('tailorOptions', () => {
  it('drops the basic match and keeps everything else, in order', () => {
    expect(tailorOptions([KEYWORD, OLLAMA])).toEqual([OLLAMA]);
  });

  it('boundary: a picker with only the basic match yields nothing to offer', () => {
    expect(tailorOptions([KEYWORD])).toEqual([]);
  });
});

describe('runDisabledReason', () => {
  const ready = { cv: CV, jobText: ADVERT, option: OLLAMA, aiAvailable: true, running: false };

  it('is null when everything is in place', () => {
    expect(runDisabledReason(ready)).toBeNull();
  });

  it('says a model or a key is needed, generically, before anything else', () => {
    // No CV, no advert, no option — and the FIRST thing to fix is still the
    // model, because everything else is work towards a button that will not press.
    expect(
      runDisabledReason({ ...ready, cv: null, jobText: '', option: null, aiAvailable: false }),
    ).toBe(NO_AI_REASON);
    expect(NO_AI_REASON).toBe('Needs a local model or your own key. Set one up in Settings.');
    // Generic: no provider is named on this surface (L-148).
    for (const brand of ['OpenAI', 'Anthropic', 'Ollama']) {
      expect(NO_AI_REASON).not.toContain(brand);
    }
  });

  it('outranks everything with "already running"', () => {
    expect(runDisabledReason({ ...ready, aiAvailable: false, running: true })).toContain(
      'Already running',
    );
  });

  it('asks for a CV, and points at where one is uploaded', () => {
    expect(runDisabledReason({ ...ready, cv: null })).toContain('Choose a CV first');
    expect(runDisabledReason({ ...ready, cv: null })).toContain('Analysis');
  });

  it('negative: a CV with no readable text cannot be rewritten from', () => {
    const reason = runDisabledReason({ ...ready, cv: { ...CV, extracted_text: '  ' } });
    expect(reason).toContain('no readable text');
  });

  it('boundary: a CV one character short of the minimum is refused with the count', () => {
    const short = 'x'.repeat(MIN_TEXT_CHARS - 1);
    const reason = runDisabledReason({ ...ready, cv: { ...CV, extracted_text: short } });
    expect(reason).toContain(`${MIN_TEXT_CHARS - 1} characters`);
    const enough = 'x'.repeat(MIN_TEXT_CHARS);
    expect(runDisabledReason({ ...ready, cv: { ...CV, extracted_text: enough } })).toBeNull();
  });

  it('asks for the advert, then for more of it', () => {
    expect(runDisabledReason({ ...ready, jobText: '' })).toContain('Paste the job advert');
    expect(runDisabledReason({ ...ready, jobText: 'short' })).toContain('Paste more of the advert');
  });

  it('explains a vanished option', () => {
    expect(runDisabledReason({ ...ready, option: null })).toContain('no longer available');
  });
});

describe('profileNotes', () => {
  const profile: Profile = {
    id: 'profile',
    headline: 'Credit risk analyst who builds the models',
    languages: [],
    work_rights: 'UK citizen',
    deal_breakers: ['No fully on-site'],
    target_sectors: [],
    career_goals: [],
    energising: [],
    draining: [],
    writing_style: 'Short sentences. No jargon.',
    star_examples: [],
    updated_at: '2026-08-01T09:00:00.000Z',
  };

  it('carries the headline and the writing style, and nothing that is a fact about the search', () => {
    const notes = profileNotes(profile) ?? '';
    expect(notes).toContain('Credit risk analyst who builds the models');
    expect(notes).toContain('Short sentences. No jargon.');
    expect(notes).not.toContain('UK citizen');
    expect(notes).not.toContain('on-site');
  });

  it('boundary: no profile, or a profile with neither field, is null', () => {
    expect(profileNotes(null)).toBeNull();
    expect(profileNotes({ ...profile, headline: null, writing_style: '  ' })).toBeNull();
  });
});

describe('titles and file names', () => {
  it('names the document by what it is and which job', () => {
    expect(documentTitle('cv', 'Credit Risk Analyst')).toBe('Tailored CV — Credit Risk Analyst');
    expect(documentTitle('cover_letter', 'Credit Risk Analyst')).toBe(
      'Cover letter — Credit Risk Analyst',
    );
  });

  it('boundary: no job title means no dangling dash', () => {
    expect(documentTitle('cv', '  ')).toBe('Tailored CV');
    expect(exportFileName('cv', '')).toBe('Tailored CV.txt');
  });

  it('suggests a .txt file name', () => {
    expect(exportFileName('cover_letter', 'Analyst')).toBe('Cover letter — Analyst.txt');
  });
});

describe('newDocument', () => {
  it('builds the row exactly from its inputs', () => {
    expect(
      newDocument({
        id: 'doc-1',
        applicationId: 'app-1',
        kind: 'cv',
        title: 'Tailored CV — Analyst',
        text: 'PROFESSIONAL SUMMARY',
        now: '2026-08-19T09:00:00.000Z',
      }),
    ).toEqual({
      id: 'doc-1',
      application_id: 'app-1',
      kind: 'cv',
      title: 'Tailored CV — Analyst',
      text: 'PROFESSIONAL SUMMARY',
      created_at: '2026-08-19T09:00:00.000Z',
    });
  });
});

describe('the letter limit', () => {
  it('is the 400 words the prompt asks for', () => {
    expect(LETTER_WORD_LIMIT).toBe(400);
  });
});
