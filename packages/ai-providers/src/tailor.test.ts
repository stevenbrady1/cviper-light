/**
 * The three writing pipelines share one runner, so the retry contract is
 * proved once here through `tailorCv` and the other two are checked for the
 * things that differ: their schema, their budget and their context fields.
 */
import { describe, expect, it } from 'vitest';

import {
  COVER_LETTER_JSON_SCHEMA,
  DRAFT_REVIEW_JSON_SCHEMA,
  TAILORED_CV_JSON_SCHEMA,
  err,
  ok,
  type Result,
} from '@cviper/core-types';

import { writeCoverLetter } from './cover-letter';
import { reviewDraft } from './review';
import { tailorCv } from './tailor';
import type { AiProvider, ChatJsonRequest, ModelInfo, ProviderError } from './types';

const CV = 'Jane Doe. 8 years Python at Acme Ltd, 2016 – Present. Cut costs by 30%.';
const JOB = 'Senior Python Engineer, payments. Python, AWS, PostgreSQL, 5+ years.';

const GOOD_CV = {
  summary: 'Eight years of Python at Acme Ltd.',
  key_skills: ['Python'],
  experience: [
    {
      title: 'Engineer',
      company: 'Acme Ltd',
      location: '',
      dates: '2016 – Present',
      bullets: ['Cut costs by 30%.'],
    },
  ],
  education: [],
  certifications: [],
};

const GOOD_LETTER = {
  greeting: 'Dear Hiring Manager,',
  paragraphs: ['Eight years of Python.', 'I cut costs by 30%.'],
  sign_off: 'Yours sincerely,',
};

const GOOD_REVIEW = {
  issues: [{ section: 'Summary', problem: 'Generic.', suggestion: 'Name the payments work.' }],
  verdict: 'revise',
};

interface FakeProvider extends AiProvider {
  readonly requests: ChatJsonRequest[];
}

/** A provider that answers from a queue and refuses to be called past it. */
function fakeProvider(replies: Array<Result<string, ProviderError>>): FakeProvider {
  const requests: ChatJsonRequest[] = [];
  const queue = [...replies];
  return {
    id: 'ollama',
    requests,
    chatJson(request) {
      requests.push(request);
      const next = queue.shift();
      if (next === undefined) throw new Error('provider called more times than the test allows');
      return Promise.resolve(next);
    },
    listModels(): Promise<Result<ModelInfo[], ProviderError>> {
      return Promise.resolve(ok([]));
    },
  };
}

function tailor(provider: AiProvider) {
  return tailorCv({ provider, model: 'llama3.2', cvText: CV, jobText: JOB, profileNotes: null });
}

describe('tailorCv — the happy path', () => {
  it('returns a validated CV with no retry, at temperature 0, with the tailoring schema', async () => {
    const provider = fakeProvider([ok(JSON.stringify(GOOD_CV))]);
    const result = await tailor(provider);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cv.experience[0]?.company).toBe('Acme Ltd');
      expect(result.value.meta.retryCount).toBe(0);
      expect(result.value.meta.repairStrategy).toBe('clean');
    }
    const request = provider.requests[0];
    expect(request?.temperature).toBe(0);
    expect(request?.schema).toBe(TAILORED_CV_JSON_SCHEMA);
    expect(request?.schemaName).toBe('tailored_cv');
    expect(request?.maxOutputTokens).toBe(4096);
    expect(request?.user).toContain('Jane Doe');
    expect(request?.user).toContain('Senior Python Engineer');
  });

  it('keeps unknown fields a bigger model added', async () => {
    const provider = fakeProvider([ok(JSON.stringify({ ...GOOD_CV, extra: 'kept' }))]);
    const result = await tailor(provider);
    expect(result.ok && (result.value.cv as { extra?: string }).extra).toBe('kept');
  });
});

describe('tailorCv — the one repair turn', () => {
  it('recovers from a first reply with the wrong shape, and says so', async () => {
    const provider = fakeProvider([
      ok(JSON.stringify({ ...GOOD_CV, experience: 'one role' })),
      ok(JSON.stringify(GOOD_CV)),
    ]);
    const result = await tailor(provider);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.meta.retryCount).toBe(1);
    expect(provider.requests).toHaveLength(2);
    // The repair turn quotes the problem by key, and re-sends the original task.
    const repair = provider.requests[1]?.user ?? '';
    expect(repair).toContain('experience');
    expect(repair).toContain('Jane Doe');
    expect(provider.requests[1]?.system).toBe(provider.requests[0]?.system);
  });

  it('negative: gives up after the second bad reply — never a third call', async () => {
    const provider = fakeProvider([ok('not json'), ok('still not json')]);
    const result = await tailor(provider);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.retryCount).toBe(1);
    expect(provider.requests).toHaveLength(2);
  });

  it('negative: a provider failure is not retried at all', async () => {
    const failure: ProviderError = {
      provider: 'ollama',
      kind: 'not-running',
      message: 'Ollama is not running.',
    };
    const provider = fakeProvider([err(failure)]);
    const result = await tailor(provider);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not-running');
      expect(result.error.message).toBe('Ollama is not running.');
      expect(result.error.retryCount).toBe(0);
    }
    expect(provider.requests).toHaveLength(1);
  });

  it('boundary: an empty reply is reported as such, then repaired', async () => {
    const provider = fakeProvider([ok(''), ok(JSON.stringify(GOOD_CV))]);
    const result = await tailor(provider);
    expect(result.ok).toBe(true);
    expect(provider.requests[1]?.user).toContain('(the reply was empty)');
  });
});

describe('writeCoverLetter', () => {
  it('returns a validated letter with the letter schema and a 1024-token budget', async () => {
    const provider = fakeProvider([ok(JSON.stringify(GOOD_LETTER))]);
    const result = await writeCoverLetter({
      provider,
      model: 'llama3.2',
      cvText: CV,
      jobText: JOB,
      tailoredCvText: 'PROFESSIONAL SUMMARY\nEight years of Python.',
      profileNotes: 'Plain and direct.',
    });

    expect(result.ok && result.value.letter.paragraphs).toHaveLength(2);
    const request = provider.requests[0];
    expect(request?.schema).toBe(COVER_LETTER_JSON_SCHEMA);
    expect(request?.schemaName).toBe('cover_letter');
    expect(request?.maxOutputTokens).toBe(1024);
    expect(request?.temperature).toBe(0);
    expect(request?.user).toContain('TAILORED CV');
    expect(request?.user).toContain('Plain and direct.');
  });

  it('negative: refuses a letter whose paragraphs came back as one string', async () => {
    const provider = fakeProvider([
      ok(JSON.stringify({ ...GOOD_LETTER, paragraphs: 'one blob' })),
      ok(JSON.stringify({ ...GOOD_LETTER, paragraphs: 'still one blob' })),
    ]);
    const result = await writeCoverLetter({
      provider,
      model: 'llama3.2',
      cvText: CV,
      jobText: JOB,
      tailoredCvText: null,
      profileNotes: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('schema-invalid');
  });
});

describe('reviewDraft', () => {
  it('returns a verdict and issues with the review schema and a 1024-token budget', async () => {
    const provider = fakeProvider([ok(JSON.stringify(GOOD_REVIEW))]);
    const result = await reviewDraft({
      provider,
      model: 'llama3.2',
      draftText: 'PROFESSIONAL SUMMARY\nEight years of Python.',
      jobText: JOB,
      cvText: CV,
      kind: 'cv',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.review.verdict).toBe('revise');
      expect(result.value.review.issues[0]?.section).toBe('Summary');
    }
    const request = provider.requests[0];
    expect(request?.schema).toBe(DRAFT_REVIEW_JSON_SCHEMA);
    expect(request?.schemaName).toBe('draft_review');
    expect(request?.maxOutputTokens).toBe(1024);
    expect(request?.temperature).toBe(0);
  });

  it('negative: a verdict outside ready/revise is refused twice and reported', async () => {
    const provider = fakeProvider([
      ok(JSON.stringify({ ...GOOD_REVIEW, verdict: 'maybe' })),
      ok(JSON.stringify({ ...GOOD_REVIEW, verdict: 'perhaps' })),
    ]);
    const result = await reviewDraft({
      provider,
      model: 'llama3.2',
      draftText: 'Dear Hiring Manager,',
      jobText: JOB,
      cvText: CV,
      kind: 'cover_letter',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('verdict');
  });
});
