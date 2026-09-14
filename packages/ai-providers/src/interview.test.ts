/**
 * The interview orchestrator. Its job is to turn one model reply into either a
 * valid `InterviewPack` or an honest failure, spending AT MOST one retry — and
 * to refuse, before any provider is touched, when there is nothing real to
 * build answers from.
 */
import { INTERVIEW_PACK_JSON_SCHEMA, err, ok, type Result } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import { NO_MATERIAL_MESSAGE, prepareInterview, type PrepareInterviewOptions } from './interview';
import type { AiProvider, ChatJsonRequest, ModelInfo, ProviderError } from './types';

const STAR = {
  title: 'Moved the risk book to Postgres',
  situation: 'The desk ran on a spreadsheet that broke monthly.',
  task: 'Replace it without a trading outage.',
  action: 'Built the schema, migrated in parallel, cut over at quarter end.',
  result: 'Zero outages and month-end closed two days faster.',
};

/** A reply that satisfies the schema. */
function goodReply(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    likely_questions: [
      {
        question: 'Tell me about a migration you led.',
        suggested_answer: 'The desk ran on a spreadsheet (situation)…',
      },
    ],
    talking_points: ['Zero-outage cutover at quarter end'],
    questions_to_ask: ['How is IFRS 9 model ownership split between risk and finance?'],
    gaps_to_bridge: ['SAS'],
    ...overrides,
  });
}

interface FakeProvider extends AiProvider {
  readonly requests: ChatJsonRequest[];
}

/** A provider that answers from a queue and throws if asked once too often. */
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

function options(
  provider: AiProvider,
  overrides: Partial<Omit<PrepareInterviewOptions, 'provider'>> = {},
): PrepareInterviewOptions {
  return {
    provider,
    model: 'llama3.2:latest',
    jobTitle: 'Credit Risk Analyst',
    company: 'Lloyds Banking Group',
    advert: 'Second-line credit risk. SQL, Python, IFRS 9 models.',
    cvText: 'Jane Doe. 6 years credit risk. SQL, Python.',
    coverLetter: null,
    profile: { headline: 'Credit risk analyst', starExamples: [STAR], careerGoals: [] },
    ...overrides,
  };
}

const NOT_RUNNING: ProviderError = {
  provider: 'ollama',
  kind: 'not-running',
  message: 'Ollama is not running. Start it and try again.',
};

describe('prepareInterview — the happy path', () => {
  it('returns a validated pack with no retry', async () => {
    const provider = fakeProvider([ok(goodReply())]);
    const result = await prepareInterview(options(provider));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pack.likely_questions[0]?.question).toContain('migration');
      expect(result.value.pack.gaps_to_bridge).toEqual(['SAS']);
      expect(result.value.meta.retryCount).toBe(0);
      expect(result.value.meta.repairStrategy).toBe('clean');
    }
    expect(provider.requests).toHaveLength(1);
  });

  it('sends the schema, the materials and temperature 0, with a 2048-token budget', async () => {
    const provider = fakeProvider([ok(goodReply())]);
    await prepareInterview(options(provider));

    const request = provider.requests[0];
    expect(request).toBeDefined();
    expect(request?.temperature).toBe(0);
    expect(request?.maxOutputTokens).toBe(2048);
    expect(request?.schema).toBe(INTERVIEW_PACK_JSON_SCHEMA);
    expect(request?.schemaName).toBe('interview_pack');
    expect(request?.user).toContain('Jane Doe');
    expect(request?.user).toContain('Second-line credit risk');
    expect(request?.user).toContain('Moved the risk book to Postgres');
    expect(request?.system).toContain('never invent experience');
  });

  it('honours a caller-supplied output budget', async () => {
    const provider = fakeProvider([ok(goodReply())]);
    await prepareInterview({ ...options(provider), maxOutputTokens: 512 });
    expect(provider.requests[0]?.maxOutputTokens).toBe(512);
  });

  it('accepts a reply wrapped in a code fence without spending the retry', async () => {
    const provider = fakeProvider([ok('```json\n' + goodReply() + '\n```')]);
    const result = await prepareInterview(options(provider));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.meta.retryCount).toBe(0);
    expect(provider.requests).toHaveLength(1);
  });
});

describe('prepareInterview — nothing to prepare from', () => {
  it('negative: refuses with no CV, no letter, no headline and no examples — and never calls the provider', async () => {
    const provider = fakeProvider([ok(goodReply())]);
    const result = await prepareInterview(
      options(provider, {
        cvText: null,
        coverLetter: null,
        profile: { headline: null, starExamples: [], careerGoals: ['Lead a team'] },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('no-material');
      expect(result.error.message).toBe(NO_MATERIAL_MESSAGE);
      expect(result.error.retryCount).toBe(0);
    }
    expect(provider.requests).toHaveLength(0);
  });

  it('boundary: a whitespace-only CV counts as no CV', async () => {
    const provider = fakeProvider([ok(goodReply())]);
    const result = await prepareInterview(
      options(provider, {
        cvText: '   \n ',
        profile: { headline: '  ', starExamples: [], careerGoals: [] },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('no-material');
    expect(provider.requests).toHaveLength(0);
  });

  it('boundary: one worked example alone is enough material', async () => {
    const provider = fakeProvider([ok(goodReply())]);
    const result = await prepareInterview(
      options(provider, {
        cvText: null,
        profile: { headline: null, starExamples: [STAR], careerGoals: [] },
      }),
    );

    expect(result.ok).toBe(true);
    expect(provider.requests).toHaveLength(1);
  });
});

describe('prepareInterview — the one repair turn', () => {
  it('repairs a reply that was not JSON at all', async () => {
    const provider = fakeProvider([ok('Here are your questions: 1. Tell me…'), ok(goodReply())]);
    const result = await prepareInterview(options(provider));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.meta.retryCount).toBe(1);
    expect(provider.requests).toHaveLength(2);

    // The repair turn quotes the rejected reply, names the problem, and goes
    // out under the SAME system message.
    const repair = provider.requests[1];
    expect(repair?.user).toContain('=== YOUR PREVIOUS REPLY ===');
    expect(repair?.user).toContain('Here are your questions');
    expect(repair?.system).toBe(provider.requests[0]?.system);
  });

  it('repairs a reply that parsed but failed the schema, naming the path', async () => {
    const provider = fakeProvider([
      ok(goodReply({ talking_points: 'Zero-outage cutover' })),
      ok(goodReply()),
    ]);
    const result = await prepareInterview(options(provider));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.meta.retryCount).toBe(1);
    expect(provider.requests[1]?.user).toContain('talking_points');
  });

  it('repairs a likely question that lost its answer', async () => {
    const provider = fakeProvider([
      ok(goodReply({ likely_questions: [{ question: 'Why us?' }] })),
      ok(goodReply()),
    ]);
    const result = await prepareInterview(options(provider));

    expect(result.ok).toBe(true);
    expect(provider.requests[1]?.user).toContain('likely_questions.0.suggested_answer');
  });

  it('negative: gives up after the second bad reply — no third attempt', async () => {
    const provider = fakeProvider([ok('nonsense'), ok('still nonsense')]);
    const result = await prepareInterview(options(provider));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.retryCount).toBe(1);
      expect(result.error.kind).not.toBe('no-material');
    }
    expect(provider.requests).toHaveLength(2);
  });
});

describe('prepareInterview — provider failures are never retried', () => {
  it('negative: a provider error on the first attempt ends it', async () => {
    const provider = fakeProvider([err(NOT_RUNNING)]);
    const result = await prepareInterview(options(provider));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not-running');
      expect(result.error.message).toBe(NOT_RUNNING.message);
      expect(result.error.retryCount).toBe(0);
    }
    expect(provider.requests).toHaveLength(1);
  });

  it('negative: a provider error on the repair turn ends it with retryCount 1', async () => {
    const provider = fakeProvider([ok('nonsense'), err(NOT_RUNNING)]);
    const result = await prepareInterview(options(provider));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not-running');
      expect(result.error.retryCount).toBe(1);
    }
    expect(provider.requests).toHaveLength(2);
  });
});
