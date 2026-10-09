import { CV_ANALYSIS_JSON_SCHEMA } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import { fakeTransport, sentBody } from '../test/fake-transport';
import {
  GOOGLE_DEFAULT_MODEL,
  GROK_DEFAULT_MODEL,
  MISTRAL_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_MODEL,
  createChatCompletionsProvider,
  type ChatCompletionsProviderId,
} from './chat-completions';
import { wireOutputCap } from './shared';

/**
 * The four providers L-177 added, driven through the one adapter they share.
 *
 * OpenAI's own behaviour is pinned in `openai.test.ts`; this file proves the
 * other four get the same request shape, the same auth redaction and the same
 * truncation rule, and that the ONE documented difference — the name of the
 * output cap — lands the right way round.
 */
const NEW_PROVIDERS = [
  'google',
  'mistral',
  'grok',
  'openrouter',
] as const satisfies readonly ChatCompletionsProviderId[];

const REQUEST = {
  model: 'any-model',
  system: 'You are a recruiter.',
  user: '=== CV ===\nJane\n=== END CV ===',
  schema: CV_ANALYSIS_JSON_SCHEMA,
  temperature: 0,
  maxOutputTokens: 2048,
} as const;

const CHAT_OK = JSON.stringify({
  id: 'chatcmpl-1',
  object: 'chat.completion',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: '{"match_score": 84}' },
      finish_reason: 'stop',
    },
  ],
});

describe.each(NEW_PROVIDERS.map((id) => [id] as const))('%s — the request it builds', (id) => {
  it('routes the call to its own provider id, so Rust picks the right host', () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createChatCompletionsProvider(id, transport).chatJson(REQUEST);
    expect(transport.chatCalls).toEqual([id]);
    expect(createChatCompletionsProvider(id, transport).id).toBe(id);
  });

  it('uses response_format json_schema with strict: true, nested under json_schema.schema', () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createChatCompletionsProvider(id, transport).chatJson(REQUEST);

    const format = sentBody(transport)['response_format'] as {
      type: string;
      json_schema: Record<string, unknown>;
    };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema['strict']).toBe(true);
    expect(format.json_schema['schema']).toEqual(CV_ANALYSIS_JSON_SCHEMA);
    expect(typeof format.json_schema['name']).toBe('string');
  });

  it('sends the output cap as max_tokens — these APIs are not documented to take the OpenAI-only name', () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createChatCompletionsProvider(id, transport).chatJson(REQUEST);

    const body = sentBody(transport);
    expect(body).toMatchObject({ temperature: 0, max_tokens: wireOutputCap(2048) });
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  it('sends system and user as messages', () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createChatCompletionsProvider(id, transport).chatJson(REQUEST);

    expect(sentBody(transport)['messages']).toEqual([
      { role: 'system', content: REQUEST.system },
      { role: 'user', content: REQUEST.user },
    ]);
  });
});

describe.each(NEW_PROVIDERS.map((id) => [id] as const))('%s — the response envelope', (id) => {
  it('returns the first choice message content', async () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    const result = await createChatCompletionsProvider(id, transport).chatJson(REQUEST);
    expect(result).toEqual({ ok: true, value: '{"match_score": 84}' });
  });

  it('reports finish_reason length as truncated', async () => {
    const capped = JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '{"match_' }, finish_reason: 'length' }],
    });
    const transport = fakeTransport({ chat: { status: 200, body: capped } });
    const result = await createChatCompletionsProvider(id, transport).chatJson(REQUEST);
    expect(result).toMatchObject({ ok: false, error: { kind: 'truncated', provider: id } });
  });

  it('negative: maps a 401 to auth WITHOUT quoting the provider message', async () => {
    // The rule from `shared.ts` is about the SHAPE of an auth response, not
    // about OpenAI: a provider that echoes the key it rejected must never have
    // that echo rendered on screen. Pinned per provider so it cannot be lost
    // by one of them growing its own adapter later.
    const transport = fakeTransport({
      chat: {
        status: 401,
        body: '{"error":{"message":"Invalid API key: sk-live-****abcd","type":"auth_error"}}',
      },
    });
    const result = await createChatCompletionsProvider(id, transport).chatJson(REQUEST);

    expect(result).toMatchObject({ ok: false, error: { kind: 'auth', status: 401, provider: id } });
    if (!result.ok) {
      expect(result.error.message).not.toContain('Invalid API key');
      expect(result.error.message).not.toContain('sk-live');
      expect(result.error.message).toContain('Check it in Settings');
    }
  });

  it('negative: a 403 is redacted the same way a 401 is', async () => {
    const transport = fakeTransport({
      chat: { status: 403, body: '{"error":{"message":"key sk-live-****abcd lacks access"}}' },
    });
    const result = await createChatCompletionsProvider(id, transport).chatJson(REQUEST);
    expect(result).toMatchObject({ ok: false, error: { kind: 'auth' } });
    if (!result.ok) expect(result.error.message).not.toContain('sk-live');
  });

  it('keeps the provider’s own prose on a 400, from either error shape', async () => {
    // OpenAI-style `{"error":{"message"}}` and Mistral's bare `{"message"}`
    // both carry the one sentence that says WHICH field was objected to.
    for (const body of [
      '{"error":{"message":"Unsupported value: temperature"}}',
      '{"message":"Unsupported value: temperature"}',
    ]) {
      const transport = fakeTransport({ chat: { status: 400, body } });
      const result = await createChatCompletionsProvider(id, transport).chatJson(REQUEST);
      expect(result).toMatchObject({ ok: false, error: { kind: 'bad-request' } });
      if (!result.ok) expect(result.error.message).toContain('Unsupported value: temperature');
    }
  });

  it('maps a 429 to rate-limit and a 503 to server', async () => {
    const limited = await createChatCompletionsProvider(
      id,
      fakeTransport({ chat: { status: 429, body: '{"error":{"message":"slow down"}}' } }),
    ).chatJson(REQUEST);
    expect(limited).toMatchObject({ ok: false, error: { kind: 'rate-limit' } });

    const down = await createChatCompletionsProvider(
      id,
      fakeTransport({ chat: { status: 503, body: '{"error":{"message":"overloaded"}}' } }),
    ).chatJson(REQUEST);
    expect(down).toMatchObject({ ok: false, error: { kind: 'server' } });
  });

  it('negative: a 200 with no choices, and an HTML error page, are bad responses', async () => {
    const empty = await createChatCompletionsProvider(
      id,
      fakeTransport({ chat: { status: 200, body: '{"choices":[]}' } }),
    ).chatJson(REQUEST);
    expect(empty).toMatchObject({ ok: false, error: { kind: 'bad-response' } });

    const html = await createChatCompletionsProvider(
      id,
      fakeTransport({ chat: { status: 200, body: '<html><body>Sign in</body></html>' } }),
    ).chatJson(REQUEST);
    expect(html).toMatchObject({ ok: false, error: { kind: 'bad-response' } });
  });

  it('propagates a no-key transport failure untouched', async () => {
    const transport = fakeTransport({
      chat: { fail: { provider: id, kind: 'no-key', message: 'No key is saved.' } },
    });
    const result = await createChatCompletionsProvider(id, transport).chatJson(REQUEST);
    expect(result).toEqual({
      ok: false,
      error: { provider: id, kind: 'no-key', message: 'No key is saved.' },
    });
  });
});

describe('custom — the typed-address service (L-150)', () => {
  it('routes the call to the custom id, so Rust sends it to the saved address', async () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    const provider = createChatCompletionsProvider('custom', transport);

    const result = await provider.chatJson(REQUEST);

    expect(provider.id).toBe('custom');
    expect(transport.chatCalls).toEqual(['custom']);
    expect(result.ok).toBe(true);
  });

  it('sends the output cap as max_tokens, the name every compatible server takes', () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createChatCompletionsProvider('custom', transport).chatJson(REQUEST);
    const body = sentBody(transport);
    expect(body['max_tokens']).toBe(wireOutputCap(REQUEST.maxOutputTokens));
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  it('negative: a 401 from the service is auth, without quoting what it said', async () => {
    const transport = fakeTransport({
      chat: { status: 401, body: '{"error":{"message":"bad key sk-abc…xyz"}}' },
    });
    const result = await createChatCompletionsProvider('custom', transport).chatJson(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('auth');
      expect(result.error.message).not.toContain('sk-abc');
    }
  });
});

describe('listModels across the four', () => {
  it('reads ids and, where the API offers one, a display name', async () => {
    const transport = fakeTransport({
      models: {
        status: 200,
        body: JSON.stringify({
          data: [
            { id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o-mini' },
            { id: 'mistral-small-latest' },
          ],
        }),
      },
    });
    const result = await createChatCompletionsProvider('openrouter', transport).listModels();
    expect(result).toEqual({
      ok: true,
      value: [
        { id: 'openai/gpt-4o-mini', label: 'OpenAI: GPT-4o-mini' },
        { id: 'mistral-small-latest', label: 'mistral-small-latest' },
      ],
    });
    expect(transport.listModelsCalls).toEqual(['openrouter']);
  });

  it('hides embedders, by each provider’s own ids', async () => {
    const transport = fakeTransport({
      models: {
        status: 200,
        body: JSON.stringify({
          data: [
            { id: 'mistral-embed' },
            { id: 'codestral-embed-2505' },
            { id: 'models/embedding-001' },
            { id: 'models/text-embedding-004' },
            { id: 'models/gemini-3.5-flash' },
            { id: 'grok-4.3' },
          ],
        }),
      },
    });
    const result = await createChatCompletionsProvider('google', transport).listModels();
    expect(result.ok && result.value.map((m) => m.id)).toEqual([
      'models/gemini-3.5-flash',
      'grok-4.3',
    ]);
  });

  it('negative: a 401 on the list is auth, and a body with no data array is a bad response', async () => {
    const refused = await createChatCompletionsProvider(
      'mistral',
      fakeTransport({ models: { status: 401, body: '{"message":"Unauthorized"}' } }),
    ).listModels();
    expect(refused).toMatchObject({ ok: false, error: { kind: 'auth' } });

    const shapeless = await createChatCompletionsProvider(
      'grok',
      fakeTransport({ models: { status: 200, body: '{"models":[]}' } }),
    ).listModels();
    expect(shapeless).toMatchObject({ ok: false, error: { kind: 'bad-response' } });
  });

  it('boundary: an empty list is success', async () => {
    const result = await createChatCompletionsProvider(
      'google',
      fakeTransport({ models: { status: 200, body: '{"data":[]}' } }),
    ).listModels();
    expect(result).toEqual({ ok: true, value: [] });
  });
});

describe('the default models', () => {
  it('are non-empty slugs with no whitespace, one per provider', () => {
    for (const model of [
      GOOGLE_DEFAULT_MODEL,
      MISTRAL_DEFAULT_MODEL,
      GROK_DEFAULT_MODEL,
      OPENROUTER_DEFAULT_MODEL,
    ]) {
      expect(model.length).toBeGreaterThan(0);
      expect(model).not.toMatch(/\s/);
    }
  });
});
