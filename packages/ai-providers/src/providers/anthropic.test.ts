/**
 * Anthropic adapter.
 *
 * The structured-output mechanism here is the one most likely to be got wrong
 * from memory, so the request-shape tests are deliberately specific about what
 * must and must NOT be sent.
 */
import { CV_ANALYSIS_JSON_SCHEMA } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import { fakeTransport, sentBody } from '../test/fake-transport';
import { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from './anthropic';

const REQUEST = {
  model: ANTHROPIC_DEFAULT_MODEL,
  system: 'You are a recruiter.',
  user: '=== CV ===\nJane\n=== END CV ===',
  schema: CV_ANALYSIS_JSON_SCHEMA,
  temperature: 0,
  maxOutputTokens: 2048,
} as const;

const CHAT_OK = JSON.stringify({
  id: 'msg_01',
  type: 'message',
  role: 'assistant',
  model: ANTHROPIC_DEFAULT_MODEL,
  content: [{ type: 'text', text: '{"match_score": 84}' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1200, output_tokens: 300 },
});

const MODELS_OK = JSON.stringify({
  data: [
    { type: 'model', id: 'claude-opus-5', display_name: 'Claude Opus 5' },
    { type: 'model', id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' },
  ],
  has_more: false,
});

describe('anthropic chatJson — the request it builds', () => {
  it('asks for JSON through output_config.format', () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createAnthropicProvider(transport).chatJson(REQUEST);

    const format = sentBody(transport)['output_config'] as { format: Record<string, unknown> };
    expect(format.format['type']).toBe('json_schema');
    expect(format.format['schema']).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: CV_ANALYSIS_JSON_SCHEMA.required,
    });
  });

  it('strips the schema keywords Anthropic 400s on, and nothing else', () => {
    // minimum/maximum/minLength/maxLength are unsupported by Anthropic's
    // structured outputs — sending them fails the whole call. They stay in the
    // shared schema (Ollama's grammar builder honours them and they genuinely
    // hold a 3B model inside 0-100) and are removed only on this wire.
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createAnthropicProvider(transport).chatJson(REQUEST);

    const wire = JSON.stringify(sentBody(transport)['output_config']);
    for (const banned of ['minimum', 'maximum', 'minLength', 'maxLength']) {
      expect(wire).not.toContain(`"${banned}"`);
    }
    // The parts that carry meaning survive.
    expect(wire).toContain('"additionalProperties":false');
    expect(wire).toContain('"match_score"');
    expect(wire).toContain('"enum":["high","medium","low"]');
  });

  it('closes every object in the schema it sends — an open one is rejected', () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createAnthropicProvider(transport).chatJson(REQUEST);

    const schema = (sentBody(transport)['output_config'] as { format: { schema: unknown } }).format
      .schema;

    const objects: Array<Record<string, unknown>> = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node !== 'object' || node === null) return;
      const record = node as Record<string, unknown>;
      if (record['type'] === 'object') objects.push(record);
      Object.values(record).forEach(walk);
    };
    walk(schema);

    expect(objects.length).toBeGreaterThan(1);
    for (const node of objects) expect(node['additionalProperties']).toBe(false);
  });

  it('leaves the shared schema object unmutated', () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createAnthropicProvider(transport).chatJson(REQUEST);
    expect(CV_ANALYSIS_JSON_SCHEMA.properties.match_score.minimum).toBe(0);
  });

  it('does NOT force a tool and does NOT prefill the assistant turn', () => {
    // Tool-use forcing is the old way round this. Assistant prefill is worse
    // than old — it now returns a hard 400 on current models, so a prefilled
    // '{' would break every call rather than degrade one.
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createAnthropicProvider(transport).chatJson(REQUEST);

    const body = sentBody(transport);
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
    expect(body['messages']).toEqual([{ role: 'user', content: REQUEST.user }]);
  });

  it('sends the system prompt as a top-level field, not a message', () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createAnthropicProvider(transport).chatJson(REQUEST);

    const body = sentBody(transport);
    expect(body['system']).toBe(REQUEST.system);
    expect(JSON.stringify(body['messages'])).not.toContain('system');
  });

  it('sends temperature 0 and max_tokens', () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createAnthropicProvider(transport).chatJson(REQUEST);

    expect(sentBody(transport)).toMatchObject({ temperature: 0, max_tokens: 2048 });
  });

  it('defaults to claude-opus-5', () => {
    expect(ANTHROPIC_DEFAULT_MODEL).toBe('claude-opus-5');
  });
});

describe('anthropic chatJson — the response envelope', () => {
  it('returns the first text block', async () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    const result = await createAnthropicProvider(transport).chatJson(REQUEST);
    expect(result).toEqual({ ok: true, value: '{"match_score": 84}' });
  });

  it('skips non-text content blocks to find the text', async () => {
    const withThinking = JSON.stringify({
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: '{"match_score": 70}' },
      ],
      stop_reason: 'end_turn',
    });
    const transport = fakeTransport({ chat: { status: 200, body: withThinking } });
    const result = await createAnthropicProvider(transport).chatJson(REQUEST);
    expect(result).toEqual({ ok: true, value: '{"match_score": 70}' });
  });

  it('reports stop_reason max_tokens as truncated', async () => {
    const capped = JSON.stringify({
      content: [{ type: 'text', text: '{"match_score": 84, "summary": "cut' }],
      stop_reason: 'max_tokens',
    });
    const transport = fakeTransport({ chat: { status: 200, body: capped } });
    const result = await createAnthropicProvider(transport).chatJson(REQUEST);
    expect(result).toMatchObject({ ok: false, error: { kind: 'truncated' } });
  });

  it('maps a 401 to auth and quotes the provider message', async () => {
    const transport = fakeTransport({
      chat: {
        status: 401,
        body: '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      },
    });
    const result = await createAnthropicProvider(transport).chatJson(REQUEST);

    expect(result).toMatchObject({ ok: false, error: { kind: 'auth', status: 401 } });
    if (!result.ok) expect(result.error.message).toContain('invalid x-api-key');
  });

  it('maps a 400 schema rejection to bad-request', async () => {
    // The schema constraints Anthropic refuses (minimum/maximum/minLength) come
    // back this way, so this envelope is the one that tells us we sent
    // something the API will not take.
    const transport = fakeTransport({
      chat: {
        status: 400,
        body: '{"type":"error","error":{"type":"invalid_request_error","message":"output_config.format.schema: minimum is not supported"}}',
      },
    });
    const result = await createAnthropicProvider(transport).chatJson(REQUEST);

    expect(result).toMatchObject({ ok: false, error: { kind: 'bad-request', status: 400 } });
    if (!result.ok) expect(result.error.message).toContain('minimum is not supported');
  });

  it('maps a 429 to rate-limit and a 529 to server', async () => {
    const limited = await createAnthropicProvider(
      fakeTransport({ chat: { status: 429, body: '{"error":{"message":"rate limited"}}' } }),
    ).chatJson(REQUEST);
    expect(limited).toMatchObject({ ok: false, error: { kind: 'rate-limit' } });

    const overloaded = await createAnthropicProvider(
      fakeTransport({ chat: { status: 529, body: '{"error":{"message":"overloaded"}}' } }),
    ).chatJson(REQUEST);
    expect(overloaded).toMatchObject({ ok: false, error: { kind: 'server' } });
  });

  it('negative: a 200 with no text block is a bad response', async () => {
    const transport = fakeTransport({
      chat: { status: 200, body: '{"content":[{"type":"thinking","thinking":"…"}]}' },
    });
    const result = await createAnthropicProvider(transport).chatJson(REQUEST);
    expect(result).toMatchObject({ ok: false, error: { kind: 'bad-response' } });
  });

  it('negative: an HTML error page is a bad response, not empty output', async () => {
    const transport = fakeTransport({ chat: { status: 200, body: '<html>proxy</html>' } });
    const result = await createAnthropicProvider(transport).chatJson(REQUEST);
    expect(result).toMatchObject({ ok: false, error: { kind: 'bad-response' } });
  });

  it('propagates a no-key transport failure untouched', async () => {
    const fail = {
      provider: 'anthropic' as const,
      kind: 'no-key' as const,
      message: 'No Anthropic key is saved.',
    };
    const result = await createAnthropicProvider(fakeTransport({ chat: { fail } })).chatJson(
      REQUEST,
    );
    expect(result).toEqual({ ok: false, error: fail });
  });
});

describe('anthropic listModels', () => {
  it('reads id and display_name from the data array', async () => {
    const transport = fakeTransport({ models: { status: 200, body: MODELS_OK } });
    const result = await createAnthropicProvider(transport).listModels();

    expect(result).toEqual({
      ok: true,
      value: [
        { id: 'claude-opus-5', label: 'Claude Opus 5' },
        { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      ],
    });
  });

  it('falls back to the id when there is no display name', async () => {
    const transport = fakeTransport({
      models: { status: 200, body: '{"data":[{"id":"claude-x"}]}' },
    });
    const result = await createAnthropicProvider(transport).listModels();
    if (result.ok) expect(result.value[0]).toEqual({ id: 'claude-x', label: 'claude-x' });
  });

  it('maps a 401 to auth', async () => {
    const transport = fakeTransport({
      models: { status: 401, body: '{"error":{"message":"invalid key"}}' },
    });
    expect(await createAnthropicProvider(transport).listModels()).toMatchObject({
      ok: false,
      error: { kind: 'auth' },
    });
  });

  it('boundary: an empty list is success', async () => {
    const transport = fakeTransport({ models: { status: 200, body: '{"data":[]}' } });
    expect(await createAnthropicProvider(transport).listModels()).toEqual({ ok: true, value: [] });
  });

  it('negative: a body with no data array is a bad response', async () => {
    const transport = fakeTransport({ models: { status: 200, body: '{"models":[]}' } });
    expect(await createAnthropicProvider(transport).listModels()).toMatchObject({
      ok: false,
      error: { kind: 'bad-response' },
    });
  });
});

describe('anthropic identity', () => {
  it('reports its id', () => {
    expect(createAnthropicProvider(fakeTransport({})).id).toBe('anthropic');
  });
});
