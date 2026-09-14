import { describe, expect, it } from 'vitest';

import { FOLLOW_UP_JSON_SCHEMA, err } from '@cviper/core-types';

import {
  DEFAULT_MAX_FOLLOW_UP_TOKENS,
  draftFollowUp,
  type DraftFollowUpOptions,
} from './follow-up';
import { createOllamaProvider } from './providers/ollama';
import { fakeTransport, sentBody, type FakeOutcome } from './test/fake-transport';
import { type AiProvider, type ProviderError } from './types';

const MODEL = 'llama3.2:latest';

const DRAFT = {
  subject: 'Following up on my Credit Risk Analyst application',
  body: 'Hello Dana,\n\nI wanted to check in on my application.\n\nKind regards,\nJane Doe',
};

const ollamaReply = (json: unknown): FakeOutcome => ({
  status: 200,
  body: JSON.stringify({ message: { content: JSON.stringify(json) }, done_reason: 'stop' }),
});

const ollamaProse = (text: string): FakeOutcome => ({
  status: 200,
  body: JSON.stringify({ message: { content: text }, done_reason: 'stop' }),
});

function ollamaWith(chat: FakeOutcome | FakeOutcome[]) {
  const transport = fakeTransport({ chat });
  return { transport, provider: createOllamaProvider(transport) };
}

function options(provider: AiProvider, overrides: Partial<DraftFollowUpOptions> = {}) {
  return {
    provider,
    model: MODEL,
    kind: 'follow_up' as const,
    jobTitle: 'Credit Risk Analyst',
    company: 'Lloyds Banking Group',
    daysQuiet: 12,
    materials: {
      advert: 'Credit Risk Analyst. Contact Dana Whitfield.',
      cv: 'Jane Doe. 8 years credit risk.',
      coverLetter: null,
    },
    writingStyle: null,
    ...overrides,
  };
}

describe('draftFollowUp — the happy path', () => {
  it('returns a validated draft the panel can put in two boxes', async () => {
    const { provider } = ollamaWith(ollamaReply(DRAFT));

    const result = await draftFollowUp(options(provider));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.draft).toEqual(DRAFT);
      expect(result.value.meta.retryCount).toBe(0);
      expect(result.value.meta.repairStrategy).toBe('clean');
    }
  });

  it('asks the model exactly once when the first answer is good', async () => {
    const { transport, provider } = ollamaWith(ollamaReply(DRAFT));
    await draftFollowUp(options(provider));
    expect(transport.chatCalls).toHaveLength(1);
  });

  it('sends temperature 0, the flat two-string schema and the 512-token budget', async () => {
    const { transport, provider } = ollamaWith(ollamaReply(DRAFT));
    await draftFollowUp(options(provider));

    const body = sentBody(transport);
    const opts = body['options'] as Record<string, unknown>;
    expect(opts['temperature']).toBe(0);
    expect(opts['num_predict']).toBe(DEFAULT_MAX_FOLLOW_UP_TOKENS);
    expect(DEFAULT_MAX_FOLLOW_UP_TOKENS).toBe(512);
    expect(body['format']).toEqual(FOLLOW_UP_JSON_SCHEMA);
  });

  it('puts the materials in the user turn and the boundary in the system turn', async () => {
    const { transport, provider } = ollamaWith(ollamaReply(DRAFT));
    await draftFollowUp(options(provider));

    const messages = sentBody(transport)['messages'] as Array<Record<string, string>>;
    expect(messages[0]?.['content']).toContain('TRUST BOUNDARY');
    expect(messages[1]?.['content']).toContain('Jane Doe. 8 years credit risk.');
  });

  it('a thank-you goes through the same pipeline', async () => {
    const { transport, provider } = ollamaWith(ollamaReply(DRAFT));
    const result = await draftFollowUp(options(provider, { kind: 'thank_you', daysQuiet: null }));

    expect(result.ok).toBe(true);
    const messages = sentBody(transport)['messages'] as Array<Record<string, string>>;
    expect(messages[1]?.['content']).toContain('Type: thank_you');
  });

  it('boundary: whitespace around the fields is trimmed, not rejected', async () => {
    const { provider } = ollamaWith(
      ollamaReply({ subject: `  ${DRAFT.subject}  `, body: `\n${DRAFT.body}\n\n` }),
    );
    const result = await draftFollowUp(options(provider));
    expect(result.ok && result.value.draft).toEqual(DRAFT);
  });
});

describe('draftFollowUp — the one repair turn', () => {
  it('recovers from prose on the first turn and reports retryCount 1', async () => {
    const { transport, provider } = ollamaWith([
      ollamaProse('Sure! Here is a draft for you.'),
      ollamaReply(DRAFT),
    ]);

    const result = await draftFollowUp(options(provider));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.meta.retryCount).toBe(1);
    expect(transport.chatCalls).toHaveLength(2);
  });

  it('negative: an empty body is the wrong shape, and the repair turn says which field', async () => {
    const { transport, provider } = ollamaWith([
      ollamaReply({ subject: DRAFT.subject, body: '' }),
      ollamaReply(DRAFT),
    ]);

    const result = await draftFollowUp(options(provider));

    expect(result.ok).toBe(true);
    const repair = (sentBody(transport, 1)['messages'] as Array<Record<string, string>>)[1];
    expect(repair?.['content']).toContain('body');
  });

  it('negative: the wrong shape twice is an error with a sentence for the user, not a throw', async () => {
    const { transport, provider } = ollamaWith([ollamaProse('nope'), ollamaProse('still nope')]);

    const result = await draftFollowUp(options(provider));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.retryCount).toBe(1);
      expect(result.error.message).toContain('write it by hand');
    }
    // Exactly two: the attempt and the one repair. Never a third.
    expect(transport.chatCalls).toHaveLength(2);
  });
});

describe('draftFollowUp — provider failures', () => {
  it('negative: a provider failure is passed through with its own message and is not retried', async () => {
    const failure: ProviderError = {
      provider: 'ollama',
      kind: 'not-running',
      message: 'Ollama is not running.',
    };
    const { transport, provider } = ollamaWith({ fail: failure });

    const result = await draftFollowUp(options(provider));

    expect(result).toEqual(err({ kind: 'not-running', message: failure.message, retryCount: 0 }));
    expect(transport.chatCalls).toHaveLength(1);
  });

  it('negative: a provider that THROWS becomes an error whose message never quotes the throw', async () => {
    const provider: AiProvider = {
      id: 'ollama',
      chatJson: () => Promise.reject(new Error('https://secret.internal/token=abc')),
      listModels: () => Promise.reject(new Error('unused')),
    };

    const result = await draftFollowUp(options(provider));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('unclassified');
      expect(result.error.message).not.toContain('secret.internal');
    }
  });
});
