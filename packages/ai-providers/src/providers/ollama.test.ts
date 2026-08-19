/**
 * Ollama adapter — the DEFAULT path for CViper Light, so its envelopes get the
 * most attention.
 *
 * Recorded shapes come from a real local daemon (see the integration spec), not
 * from memory.
 */
import { CV_ANALYSIS_JSON_SCHEMA } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import { fakeTransport, sentBody } from '../test/fake-transport';
import { OLLAMA_DEFAULT_NUM_CTX, createOllamaProvider } from './ollama';

const REQUEST = {
  model: 'llama3.2:latest',
  system: 'You are a recruiter.',
  user: '=== CV ===\nJane\n=== END CV ===',
  schema: CV_ANALYSIS_JSON_SCHEMA,
  temperature: 0,
  maxOutputTokens: 2048,
} as const;

/** A real /api/chat reply, trimmed. */
const CHAT_OK = JSON.stringify({
  model: 'llama3.2:latest',
  created_at: '2026-08-19T13:00:00.000Z',
  message: { role: 'assistant', content: '{"match_score": 84}' },
  done: true,
  done_reason: 'stop',
  total_duration: 8_000_000_000,
});

/** A real /api/tags reply, including the embedding model that must be hidden. */
const TAGS_OK = JSON.stringify({
  models: [
    {
      name: 'nomic-embed-text:latest',
      model: 'nomic-embed-text:latest',
      details: { parameter_size: '137M' },
      capabilities: ['embedding'],
    },
    {
      name: 'qwen2.5-coder:7b',
      model: 'qwen2.5-coder:7b',
      details: { parameter_size: '7.6B' },
      capabilities: ['completion', 'tools', 'insert'],
    },
    {
      name: 'llama3.2:latest',
      model: 'llama3.2:latest',
      details: { parameter_size: '3.2B' },
      capabilities: ['completion', 'tools'],
    },
  ],
});

describe('ollama chatJson — the request it builds', () => {
  it('puts the JSON Schema DIRECTLY in format, not nested under a schema key', () => {
    // Ollama's native API takes the schema itself. Nesting it under `schema`
    // silently disables constrained decoding — the call still succeeds and the
    // output is unconstrained, which is the worst kind of bug to find later.
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createOllamaProvider(transport).chatJson(REQUEST);

    const body = sentBody(transport);
    expect(body['format']).toEqual(CV_ANALYSIS_JSON_SCHEMA);
    expect(body['format']).not.toHaveProperty('schema');
  });

  it('sends system and user as separate messages', () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createOllamaProvider(transport).chatJson(REQUEST);

    expect(sentBody(transport)['messages']).toEqual([
      { role: 'system', content: REQUEST.system },
      { role: 'user', content: REQUEST.user },
    ]);
  });

  it('sets temperature 0, disables streaming, and sets num_ctx explicitly', () => {
    // num_ctx defaults to 2048 in Ollama regardless of what the model supports,
    // so leaving it unset silently truncates the prompt.
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createOllamaProvider(transport).chatJson(REQUEST);

    const body = sentBody(transport);
    expect(body['stream']).toBe(false);
    expect(body['options']).toMatchObject({
      temperature: 0,
      num_ctx: OLLAMA_DEFAULT_NUM_CTX,
      num_predict: 2048,
    });
  });

  it('lets the caller raise num_ctx for a model with a bigger window', () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    void createOllamaProvider(transport, { numCtx: 16_384 }).chatJson(REQUEST);
    expect(sentBody(transport)['options']).toMatchObject({ num_ctx: 16_384 });
  });

  it('asks for a context window big enough to hold the answer it asked for', () => {
    expect(OLLAMA_DEFAULT_NUM_CTX).toBeGreaterThan(REQUEST.maxOutputTokens * 2);
  });
});

describe('ollama chatJson — the response envelope', () => {
  it('returns the raw assistant content', async () => {
    const transport = fakeTransport({ chat: { status: 200, body: CHAT_OK } });
    const result = await createOllamaProvider(transport).chatJson(REQUEST);
    expect(result).toEqual({ ok: true, value: '{"match_score": 84}' });
  });

  it('reports a length-capped reply as truncated, not as bad output', async () => {
    const capped = JSON.stringify({
      message: { role: 'assistant', content: '{"match_score": 84, "summary": "cut' },
      done: true,
      done_reason: 'length',
    });
    const transport = fakeTransport({ chat: { status: 200, body: capped } });
    const result = await createOllamaProvider(transport).chatJson(REQUEST);

    expect(result).toMatchObject({ ok: false, error: { kind: 'truncated' } });
    if (!result.ok) expect(result.error.message).toMatch(/cut off|cut short|ran out of room/i);
  });

  it('reports a 404 for an unpulled model as a bad request, quoting Ollama', async () => {
    const transport = fakeTransport({
      chat: { status: 404, body: '{"error":"model \\"llama9\\" not found, try pulling it first"}' },
    });
    const result = await createOllamaProvider(transport).chatJson(REQUEST);

    expect(result).toMatchObject({ ok: false, error: { kind: 'bad-request', status: 404 } });
    if (!result.ok) expect(result.error.message).toContain('not found');
  });

  it('reports a 500 as a server failure', async () => {
    const transport = fakeTransport({ chat: { status: 500, body: '{"error":"oom"}' } });
    const result = await createOllamaProvider(transport).chatJson(REQUEST);
    expect(result).toMatchObject({ ok: false, error: { kind: 'server', status: 500 } });
  });

  it('negative: a 200 with no message content is a bad response, not empty success', async () => {
    const transport = fakeTransport({ chat: { status: 200, body: '{"done":true}' } });
    const result = await createOllamaProvider(transport).chatJson(REQUEST);
    expect(result).toMatchObject({ ok: false, error: { kind: 'bad-response' } });
  });

  it('negative: a 200 that is not JSON at all is a bad response', async () => {
    const transport = fakeTransport({ chat: { status: 200, body: '<html>proxy</html>' } });
    const result = await createOllamaProvider(transport).chatJson(REQUEST);
    expect(result).toMatchObject({ ok: false, error: { kind: 'bad-response' } });
  });

  it('boundary: an empty-string content is returned, not treated as missing', async () => {
    // The repair ladder classifies an empty reply; the adapter must not guess.
    const empty = JSON.stringify({ message: { role: 'assistant', content: '' }, done: true });
    const transport = fakeTransport({ chat: { status: 200, body: empty } });
    const result = await createOllamaProvider(transport).chatJson(REQUEST);
    expect(result).toEqual({ ok: true, value: '' });
  });

  it('propagates a transport failure untouched', async () => {
    const fail = {
      provider: 'ollama' as const,
      kind: 'not-running' as const,
      message: 'Ollama is not running.',
    };
    const transport = fakeTransport({ chat: { fail } });
    const result = await createOllamaProvider(transport).chatJson(REQUEST);
    expect(result).toEqual({ ok: false, error: fail });
  });
});

describe('ollama listModels', () => {
  it('uses the fully-qualified name:tag from .model, not .name alone', async () => {
    const transport = fakeTransport({ models: { status: 200, body: TAGS_OK } });
    const result = await createOllamaProvider(transport).listModels();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((model) => model.id)).toEqual([
        'qwen2.5-coder:7b',
        'llama3.2:latest',
      ]);
    }
  });

  it('hides embedding models — they cannot chat', async () => {
    const transport = fakeTransport({ models: { status: 200, body: TAGS_OK } });
    const result = await createOllamaProvider(transport).listModels();
    if (result.ok) {
      expect(result.value.map((model) => model.id)).not.toContain('nomic-embed-text:latest');
    }
  });

  it('falls back to a name check when the daemon reports no capabilities', async () => {
    // Older Ollama builds omit `capabilities` entirely. Without a fallback,
    // every model including the embedder would appear in the picker.
    const legacy = JSON.stringify({
      models: [
        { name: 'nomic-embed-text:latest', model: 'nomic-embed-text:latest' },
        { name: 'llama3.2:latest', model: 'llama3.2:latest' },
      ],
    });
    const transport = fakeTransport({ models: { status: 200, body: legacy } });
    const result = await createOllamaProvider(transport).listModels();
    if (result.ok) expect(result.value.map((model) => model.id)).toEqual(['llama3.2:latest']);
  });

  it('hides an embedding model whose name does not contain "embed"', async () => {
    // THE REAL PRODUCTION PATH. `/api/tags` does NOT carry `capabilities` — that
    // field only appears on `/api/show` — so on every live daemon the fallback
    // below is the ONLY filter that runs. A name check alone lets `all-minilm`
    // and `bge-m3` into a chat picker, where choosing one returns a vector and
    // the analysis fails with something nobody can act on.
    //
    // The architecture is the honest signal, and `/api/tags` does report it:
    // every embedding model in Ollama's library is a BERT variant, and no chat
    // model is.
    const tags = JSON.stringify({
      models: [
        { name: 'all-minilm:latest', model: 'all-minilm:latest', details: { family: 'bert' } },
        { name: 'bge-m3:latest', model: 'bge-m3:latest', details: { families: ['bert'] } },
        {
          name: 'nomic-embed-text:latest',
          model: 'nomic-embed-text:latest',
          details: { family: 'nomic-bert' },
        },
        { name: 'llama3.2:latest', model: 'llama3.2:latest', details: { family: 'llama' } },
      ],
    });
    const transport = fakeTransport({ models: { status: 200, body: tags } });
    const result = await createOllamaProvider(transport).listModels();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((model) => model.id)).toEqual(['llama3.2:latest']);
  });

  it('hides a known embedding model even when the daemon reports no details at all', async () => {
    const tags = JSON.stringify({
      models: [
        { name: 'all-minilm:l6-v2', model: 'all-minilm:l6-v2' },
        { name: 'paraphrase-multilingual:latest', model: 'paraphrase-multilingual:latest' },
        { name: 'llama3.2:latest', model: 'llama3.2:latest' },
      ],
    });
    const transport = fakeTransport({ models: { status: 200, body: tags } });
    const result = await createOllamaProvider(transport).listModels();

    if (result.ok) expect(result.value.map((model) => model.id)).toEqual(['llama3.2:latest']);
  });

  it('does not mistake a chat model for an embedder because of its name', async () => {
    // The other half of the guard. A filter that is too eager is worse than no
    // filter: it empties the picker on a machine that is correctly set up, and
    // there is nothing on screen to explain why.
    const tags = JSON.stringify({
      models: [
        { name: 'gemma3:4b', model: 'gemma3:4b', details: { family: 'gemma3' } },
        { name: 'qwen2.5-coder:7b', model: 'qwen2.5-coder:7b', details: { family: 'qwen2' } },
        { name: 'phi4-mini:latest', model: 'phi4-mini:latest', details: { family: 'phi3' } },
        {
          name: 'mistral-small:latest',
          model: 'mistral-small:latest',
          details: { family: 'llama' },
        },
      ],
    });
    const transport = fakeTransport({ models: { status: 200, body: tags } });
    const result = await createOllamaProvider(transport).listModels();

    if (result.ok) {
      expect(result.value.map((model) => model.id)).toEqual([
        'gemma3:4b',
        'qwen2.5-coder:7b',
        'phi4-mini:latest',
        'mistral-small:latest',
      ]);
    }
  });

  it('trusts a reported completion capability over the architecture', async () => {
    // `capabilities` is the daemon's own answer and outranks our guessing. If a
    // BERT-family model ever gains a completion head, the daemon says so and we
    // must not overrule it with a heuristic written in 2026.
    const tags = JSON.stringify({
      models: [
        {
          name: 'oddity:latest',
          model: 'oddity:latest',
          details: { family: 'bert' },
          capabilities: ['completion'],
        },
      ],
    });
    const transport = fakeTransport({ models: { status: 200, body: tags } });
    const result = await createOllamaProvider(transport).listModels();

    if (result.ok) expect(result.value.map((model) => model.id)).toEqual(['oddity:latest']);
  });

  it('labels a model with its parameter size when the daemon offers one', async () => {
    const transport = fakeTransport({ models: { status: 200, body: TAGS_OK } });
    const result = await createOllamaProvider(transport).listModels();
    if (result.ok) expect(result.value[0]?.label).toContain('7.6B');
  });

  it('boundary: an empty model list is success with no models, not an error', async () => {
    const transport = fakeTransport({ models: { status: 200, body: '{"models":[]}' } });
    const result = await createOllamaProvider(transport).listModels();
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('negative: a body without a models array is a bad response', async () => {
    const transport = fakeTransport({ models: { status: 200, body: '{"ok":true}' } });
    const result = await createOllamaProvider(transport).listModels();
    expect(result).toMatchObject({ ok: false, error: { kind: 'bad-response' } });
  });

  it('negative: entries without a model id are skipped rather than crashing', async () => {
    const messy = JSON.stringify({ models: [{}, { model: 'llama3.2:latest' }, null] });
    const transport = fakeTransport({ models: { status: 200, body: messy } });
    const result = await createOllamaProvider(transport).listModels();
    if (result.ok) expect(result.value.map((model) => model.id)).toEqual(['llama3.2:latest']);
  });
});

describe('ollama identity', () => {
  it('reports its id', () => {
    expect(createOllamaProvider(fakeTransport({})).id).toBe('ollama');
  });
});
