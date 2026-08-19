/**
 * The analysis view's rules, with no React in sight.
 *
 * ============================================================================
 * THE RUN BUTTON EXPLAINS ITSELF. THAT IS WHAT MOST OF THIS FILE IS ABOUT.
 * ============================================================================
 * This is a free, local app with no support inbox and no error dashboard. A
 * dead grey button is the single most common way a desktop app tells somebody
 * nothing at all — they click it, nothing happens, and there is nowhere to ask
 * why. So the disabled state is a VALUE with a sentence attached, produced by a
 * pure function, and every branch of it is asserted here.
 */
import { describe, expect, it } from 'vitest';

import { type Cv, type Job } from '@cviper/core-types';

import {
  MIN_ADVERT_CHARS,
  jobAdvertText,
  newAnalysisRecord,
  newCvRecord,
  providerLabel,
  runDisabledReason,
  type RunState,
} from './model';
import { KEYWORD_KEY, providerOptions } from './providers';

const NOW = '2026-08-19T09:00:00.000Z';

const [BASIC] = providerOptions({ ollamaModels: [], anthropicKey: false, openaiKey: false });

const CV: Cv = {
  id: 'cv-1',
  name: 'Steven Brady CV.pdf',
  file_path: 'C:\\Users\\steve\\Documents\\CV.pdf',
  extracted_text: 'Credit risk analyst with eight years in London banking. SQL, Python, Basel III.',
  created_at: NOW,
};

const ADVERT =
  'Credit Risk Analyst, Lloyds. You will build SQL models and report on Basel III exposures.';

function state(overrides: Partial<RunState> = {}): RunState {
  return {
    cv: CV,
    jobText: ADVERT,
    option: BASIC ?? null,
    running: false,
    ...overrides,
  };
}

describe('runDisabledReason — when the button works', () => {
  it('returns null when everything it needs is there', () => {
    expect(runDisabledReason(state())).toBeNull();
  });

  it('boundary: an advert of exactly the minimum length is enough', () => {
    const advert = 'x'.repeat(MIN_ADVERT_CHARS);
    expect(runDisabledReason(state({ jobText: advert }))).toBeNull();
  });
});

describe('runDisabledReason — and when it does not', () => {
  it('asks for a CV first, in those words', () => {
    expect(runDisabledReason(state({ cv: null }))).toBe('Choose a CV first.');
  });

  it('says a CV with no text at all cannot be compared', () => {
    const reason = runDisabledReason(state({ cv: { ...CV, extracted_text: null } }));

    expect(reason).toContain('no readable text');
    // The advice matters more than the diagnosis: a user holding a scan needs
    // to know what to upload instead.
    expect(reason).toContain('.docx');
  });

  it('treats a CV of nothing but whitespace as having no text', () => {
    expect(runDisabledReason(state({ cv: { ...CV, extracted_text: '   \n\t ' } }))).toContain(
      'no readable text',
    );
  });

  it('boundary: a CV one character under the minimum is refused, and says why', () => {
    const reason = runDisabledReason(
      state({ cv: { ...CV, extracted_text: 'x'.repeat(MIN_ADVERT_CHARS - 1) } }),
    );

    expect(reason).toContain('almost no text');
  });

  it('boundary: a CV of exactly the minimum is accepted', () => {
    expect(
      runDisabledReason(state({ cv: { ...CV, extracted_text: 'x'.repeat(MIN_ADVERT_CHARS) } })),
    ).toBeNull();
  });

  it('asks for the advert when the box is empty', () => {
    expect(runDisabledReason(state({ jobText: '' }))).toBe('Paste the job advert.');
    expect(runDisabledReason(state({ jobText: '    ' }))).toBe('Paste the job advert.');
  });

  it('boundary: an advert one character short says how much more is needed', () => {
    const reason = runDisabledReason(state({ jobText: 'x'.repeat(MIN_ADVERT_CHARS - 1) }));

    expect(reason).toContain(String(MIN_ADVERT_CHARS));
    expect(reason).toContain('more of the advert');
  });

  it('says so while a run is already going, rather than going quiet', () => {
    expect(runDisabledReason(state({ running: true }))).toContain('Already running');
  });

  it('reports a provider that has gone away since the view loaded', () => {
    // Ollama was running when the picker was built and has since been stopped.
    const reason = runDisabledReason(state({ option: null }));

    expect(reason).toContain('no longer available');
  });

  it('reports the most useful problem first when several are true at once', () => {
    // No CV and no advert: "choose a CV" is the first thing the user has to do,
    // and listing both would just be a wall.
    expect(runDisabledReason(state({ cv: null, jobText: '' }))).toBe('Choose a CV first.');
  });

  it('a run in progress outranks everything else', () => {
    expect(runDisabledReason(state({ running: true, cv: null }))).toContain('Already running');
  });
});

describe('newCvRecord', () => {
  it('builds a complete row from a parsed upload', () => {
    const cv = newCvRecord({
      id: 'cv-9',
      name: 'CV.docx',
      path: 'C:\\CV.docx',
      text: 'Some text',
      now: NOW,
    });

    expect(cv).toEqual({
      id: 'cv-9',
      name: 'CV.docx',
      file_path: 'C:\\CV.docx',
      extracted_text: 'Some text',
      created_at: NOW,
    });
  });

  it('records a pasted CV as having no file path, never an empty string', () => {
    // The data model spells absence as null throughout, and an empty string
    // would export as a value the cloud app has to special-case.
    expect(
      newCvRecord({ id: 'cv-9', name: 'Pasted', path: null, text: 'x', now: NOW }).file_path,
    ).toBeNull();
  });
});

describe('newAnalysisRecord', () => {
  const analysis = {
    match_score: 71,
    verdict: 'possible' as const,
    summary: 'A fair fit.',
    matched_skills: ['Sql'],
    missing_skills: [],
    keyword_gaps: [],
    matched_keywords: [],
    suggestions: [],
    ats_notes: [],
  };

  it('stores the score alongside the whole result', () => {
    const record = newAnalysisRecord({
      id: 'an-1',
      cvId: 'cv-1',
      jobId: null,
      provider: 'keyword',
      model: 'keyword-v3',
      analysis,
      now: NOW,
    });

    expect(record.match_score).toBe(71);
    expect(record.result_json).toEqual(analysis);
    expect(record.job_id).toBeNull();
    expect(record.created_at).toBe(NOW);
  });

  it('takes the score from the result, never from anywhere else', () => {
    // `match_score` is a column so the history list can be read without
    // deserialising every result. Two sources for one number is two numbers.
    const record = newAnalysisRecord({
      id: 'an-1',
      cvId: 'cv-1',
      jobId: 'job-1',
      provider: 'ollama',
      model: 'llama3.2:3b',
      analysis: { ...analysis, match_score: 12 },
      now: NOW,
    });

    expect(record.match_score).toBe(12);
  });
});

describe('jobAdvertText', () => {
  const job: Job = {
    id: 'job-1',
    source: 'manual',
    external_id: null,
    title: 'Credit Risk Analyst',
    company: 'Lloyds',
    location: 'London',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: 'You will build SQL models.',
    url: null,
    posted_date: null,
    created_at: NOW,
  };

  it('composes what is known about a tracked job into advert text', () => {
    expect(jobAdvertText(job)).toBe(
      'Credit Risk Analyst\nLloyds\nLondon\n\nYou will build SQL models.',
    );
  });

  it('leaves out what the job does not have, without leaving blank lines', () => {
    expect(jobAdvertText({ ...job, location: null, description: null })).toBe(
      'Credit Risk Analyst\nLloyds',
    );
  });

  it('boundary: a job with an empty-string description is treated as having none', () => {
    expect(jobAdvertText({ ...job, location: null, description: '' })).toBe(
      'Credit Risk Analyst\nLloyds',
    );
  });
});

describe('providerLabel', () => {
  it('names each stored provider in words a person recognises', () => {
    expect(providerLabel('keyword')).toBe('Basic match');
    expect(providerLabel('ollama')).toBe('Ollama');
    expect(providerLabel('anthropic')).toBe('Anthropic');
    expect(providerLabel('openai')).toBe('OpenAI');
  });

  it('falls back to whatever was stored, for a row written by a later version', () => {
    // Analyses survive in the database and in export files. A provider this
    // build has never heard of must render as itself, not as "Unknown".
    expect(providerLabel('mistral')).toBe('mistral');
  });
});

describe('the always-available option is what a bare picker starts on', () => {
  it('is the keyword option', () => {
    expect(BASIC?.key).toBe(KEYWORD_KEY);
  });
});
