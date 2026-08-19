/**
 * OpenAI adapter — chat completions with a strict json_schema response format.
 */
import { CV_ANALYSIS_JSON_SCHEMA } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import { fakeTransport, sentBody } from '../test/fake-transport';
import { createOpenAiProvider } from './openai';

const REQUEST = {
  model: 'gpt-5',
  system: 'You are a recruiter.',
  user: '=== CV ===\nJane\n=== END CV ===',
  schema: CV_ANALYSIS_JSON_SCHEMA,
  temperature: 0,
  maxOutputTokens: 2048,
} as const;

const CHAT_OK = JSON.stringify({
  id: 'chatcmpl-1',
  object: 'chat.completion',
  model: 'gpt-5',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: '{"match_score": 84}', refusal: null },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 1200, completion_tokens: 300 },
});

const MODELS_OK = JSON.stringify({
  object: 'list',
  data: [
    { id: 'gpt-5', object: 'model', owned_by: 'openai' },
    { id: 'gpt-5-mini', object: 'model', owned_by: 'openai' },
  ],
});

describe('openai chatJson — the request it builds', () => {
  it('uses response_format json_schema with strict: true', () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createOpenAiProvider(transport).chatJson(REQUEST);

    const format = sentBody(transport)['response_format'] as {
      type: string;
      json_schema: Record<string, unknown>;
    };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema['strict']).toBe(true);
    expect(format.json_schema['schema']).toEqual(CV_ANALYSIS_JSON_SCHEMA);
    expect(typeof format.json_schema['name']).toBe('string');
  });

  it('nests the schema under json_schema.schema — unlike Ollama', () => {
    // The two providers take the same schema in two different shapes. Getting
    // them the wrong way round fails silently on Ollama and loudly here, so
    // both are pinned.
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createOpenAiProvider(transport).chatJson(REQUEST);
    expect(sentBody(transport)['response_format']).not.toHaveProperty('schema');
  });

  it('sends system and user as messages', () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createOpenAiProvider(transport).chatJson(REQUEST);

    expect(sentBody(transport)['messages']).toEqual([
      { role: 'system', content: REQUEST.system },
      { role: 'user', content: REQUEST.user },
    ]);
  });

  it('sends temperature 0 and max_completion_tokens', () => {
    // `max_tokens` is deprecated for chat completions and rejected outright by
    // the newer reasoning models, so the modern name is the only safe one.
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createOpenAiProvider(transport).chatJson(REQUEST);

    const body = sentBody(transport);
    expect(body).toMatchObject({ temperature: 0, max_completion_tokens: 2048 });
    expect(body).not.toHaveProperty('max_tokens');
  });
});

describe('openai chatJson — the response envelope', () => {
  it('returns the first choice message content', async () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    const result = await createOpenAiProvider(transport).chatJson(REQUEST);
    expect(result).toEqual({ ok: true, value: '{"match_score": 84}' });
  });

  it('reports finish_reason length as truncated', async () => {
    const capped = JSON.stringify({
      choices: [
        {
          message: { role: 'assistant', content: '{"match_score": 84, "summary": "cut' },
          finish_reason: 'length',
        },
      ],
    });
    const transport = fakeTransport({ chat: { status: 200, body: capped } });
    const result = await createOpenAiProvider(transport).chatJson(REQUEST);
    expect(result).toMatchObject({ ok: false, error: { kind: 'truncated' } });
  });

  it('surfaces a refusal as a bad request rather than as empty output', async () => {
    const refused = JSON.stringify({
      choices: [
        {
          message: { role: 'assistant', content: null, refusal: 'I cannot help with that.' },
          finish_reason: 'stop',
        },
      ],
    });
    const transport = fakeTransport({ chat: { status: 200, body: refused } });
    const result = await createOpenAiProvider(transport).chatJson(REQUEST);

    expect(result).toMatchObject({ ok: false, error: { kind: 'bad-request' } });
    if (!result.ok) expect(result.error.message).toContain('I cannot help with that.');
  });

  it('maps a 401 to auth and quotes the provider message', async () => {
    const transport = fakeTransport({
      chat: {
        status: 401,
        body: '{"error":{"message":"Incorrect API key provided","type":"invalid_request_error","code":"invalid_api_key"}}',
      },
    });
    const result = await createOpenAiProvider(transport).chatJson(REQUEST);

    expect(result).toMatchObject({ ok: false, error: { kind: 'auth', status: 401 } });
    if (!result.ok) expect(result.error.message).toContain('Incorrect API key provided');
  });

  it('maps a 429 to rate-limit and a 503 to server', async () => {
    const limited = await createOpenAiProvider(
      fakeTransport({ chat: { status: 429, body: '{"error":{"message":"Rate limit reached"}}' } }),
    ).chatJson(REQUEST);
    expect(limited).toMatchObject({ ok: false, error: { kind: 'rate-limit' } });

    const down = await createOpenAiProvider(
      fakeTransport({ chat: { status: 503, body: '{"error":{"message":"overloaded"}}' } }),
    ).chatJson(REQUEST);
    expect(down).toMatchObject({ ok: false, error: { kind: 'server' } });
  });

  it('negative: a 200 with no choices is a bad response', async () => {
    const transport = fakeTransport({ chat: { status: 200, body: '{"choices":[]}' } });
    const result = await createOpenAiProvider(transport).chatJson(REQUEST);
    expect(result).toMatchObject({ ok: false, error: { kind: 'bad-response' } });
  });

  it('negative: an HTML error page is a bad response', async () => {
    const transport = fakeTransport({ chat: { status: 200, body: '<html>gateway</html>' } });
    const result = await createOpenAiProvider(transport).chatJson(REQUEST);
    expect(result).toMatchObject({ ok: false, error: { kind: 'bad-response' } });
  });

  it('propagates a no-key transport failure untouched', async () => {
    const fail = {
      provider: 'openai' as const,
      kind: 'no-key' as const,
      message: 'No OpenAI key is saved.',
    };
    const result = await createOpenAiProvider(fakeTransport({ chat: { fail } })).chatJson(REQUEST);
    expect(result).toEqual({ ok: false, error: fail });
  });
});

describe('openai listModels', () => {
  it('reads ids from the data array', async () => {
    const transport = fakeTransport({ models: { status: 200, body: MODELS_OK } });
    const result = await createOpenAiProvider(transport).listModels();

    expect(result).toEqual({
      ok: true,
      value: [
        { id: 'gpt-5', label: 'gpt-5' },
        { id: 'gpt-5-mini', label: 'gpt-5-mini' },
      ],
    });
  });

  it('hides models that cannot chat', async () => {
    // /v1/models returns embeddings, audio and image models in the same list.
    const mixed = JSON.stringify({
      data: [
        { id: 'text-embedding-3-small' },
        { id: 'gpt-5' },
        { id: 'whisper-1' },
        { id: 'dall-e-3' },
        { id: 'tts-1' },
      ],
    });
    const transport = fakeTransport({ models: { status: 200, body: mixed } });
    const result = await createOpenAiProvider(transport).listModels();
    if (result.ok) expect(result.value.map((model) => model.id)).toEqual(['gpt-5']);
  });

  it('maps a 401 to auth', async () => {
    const transport = fakeTransport({
      models: { status: 401, body: '{"error":{"message":"Incorrect API key"}}' },
    });
    expect(await createOpenAiProvider(transport).listModels()).toMatchObject({
      ok: false,
      error: { kind: 'auth' },
    });
  });

  it('boundary: an empty list is success', async () => {
    const transport = fakeTransport({ models: { status: 200, body: '{"data":[]}' } });
    expect(await createOpenAiProvider(transport).listModels()).toEqual({ ok: true, value: [] });
  });

  it('negative: a body with no data array is a bad response', async () => {
    const transport = fakeTransport({ models: { status: 200, body: '{"object":"list"}' } });
    expect(await createOpenAiProvider(transport).listModels()).toMatchObject({
      ok: false,
      error: { kind: 'bad-response' },
    });
  });
});

describe('openai identity', () => {
  it('reports its id', () => {
    expect(createOpenAiProvider(fakeTransport({})).id).toBe('openai');
  });
});
