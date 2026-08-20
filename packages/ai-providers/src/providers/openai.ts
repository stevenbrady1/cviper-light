/**
 * OpenAI — bring-your-own-key cloud provider, via chat completions.
 *
 * Structured output is `response_format: { type: 'json_schema', json_schema:
 * { name, schema, strict: true } }`. Note the nesting: the schema sits under
 * `json_schema.schema`, whereas Ollama takes the schema DIRECTLY in `format`.
 * The two are pinned by tests in both adapters because swapping them fails
 * loudly here and silently there.
 *
 * The base URL and the `Authorization: Bearer` header live in Rust. The key
 * never enters JavaScript.
 */
import { err, ok, type Result } from '@cviper/core-types';

import {
  providerError,
  type AiProvider,
  type ChatJsonRequest,
  type ChatTransport,
  type ModelInfo,
  type ProviderError,
} from '../types';
import {
  TRUNCATED_MESSAGE,
  decodeJsonBody,
  httpError,
  readArray,
  readObject,
  readString,
} from './shared';

const PROVIDER = 'openai' as const;

/**
 * Names the schema in the response format. Free-form, but must be present.
 *
 * The DEFAULT only. `ChatJsonRequest.schemaName` overrides it, because this
 * adapter now carries two different schemas — the CV analysis and the pasted-
 * advert extraction — and labelling one with the other's name on the wire is a
 * lie that only ever surfaces when somebody is already debugging.
 */
const DEFAULT_SCHEMA_NAME = 'cv_analysis';

/** `finish_reason` when the model stopped at the output cap. */
const FINISH_REASON_LENGTH = 'length';

/**
 * Model families that cannot answer a chat completion.
 *
 * `/v1/models` returns everything the key can reach — embeddings, speech,
 * images, moderation — in one undifferentiated list, and the API exposes no
 * capability field to filter on. Offering an embedding model in a chat picker
 * produces a 400 the user has no way to interpret, so the list is filtered by
 * the only signal there is: the id.
 */
const NON_CHAT_PREFIXES = [
  'text-embedding',
  'whisper',
  'tts',
  'dall-e',
  'omni-moderation',
  'text-moderation',
  'gpt-image',
  'sora',
  'codex-mini',
];

function isChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  return !NON_CHAT_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** Pull the provider's own explanation out of `{"error": {"message": …}}`. */
function errorDetail(body: Record<string, unknown>): string | null {
  const error = readObject(body, 'error');
  return error === null ? null : readString(error, 'message');
}

export function createOpenAiProvider(transport: ChatTransport): AiProvider {
  return {
    id: PROVIDER,

    async chatJson(request: ChatJsonRequest): Promise<Result<string, ProviderError>> {
      const body = JSON.stringify({
        model: request.model,
        // `max_tokens` is deprecated for this endpoint and rejected outright by
        // the newer reasoning models. `max_completion_tokens` is the only name
        // that works across the current range.
        max_completion_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: request.schemaName ?? DEFAULT_SCHEMA_NAME,
            schema: request.schema,
            strict: true,
          },
        },
      });

      const response = await transport.chat(PROVIDER, body);
      if (!response.ok) return response;

      const decoded = decodeJsonBody(PROVIDER, response.value.body);
      if (!decoded.ok) return decoded;

      if (response.value.status < 200 || response.value.status >= 300) {
        return err(httpError(PROVIDER, response.value.status, errorDetail(decoded.value)));
      }

      const choices = readArray(decoded.value, 'choices') ?? [];
      const first = choices[0];
      if (typeof first !== 'object' || first === null || Array.isArray(first)) {
        return err(
          providerError(
            PROVIDER,
            'bad-response',
            'The provider replied without any completion choices.',
          ),
        );
      }

      const choice = first as Record<string, unknown>;
      const message = readObject(choice, 'message');

      // A refusal is a deliberate decision by the model, not a malformed reply.
      // Reporting it as "no output" would send the user off to change model
      // when what they need is to know the request was declined.
      const refusal = message === null ? null : readString(message, 'refusal');
      if (refusal !== null && refusal.trim().length > 0) {
        return err(providerError(PROVIDER, 'bad-request', refusal));
      }

      const content = message === null ? null : readString(message, 'content');
      if (content === null) {
        return err(
          providerError(PROVIDER, 'bad-response', 'The provider replied without any content.'),
        );
      }

      if (readString(choice, 'finish_reason') === FINISH_REASON_LENGTH) {
        return err(providerError(PROVIDER, 'truncated', TRUNCATED_MESSAGE));
      }

      return ok(content);
    },

    async listModels(): Promise<Result<ModelInfo[], ProviderError>> {
      const response = await transport.listModels(PROVIDER);
      if (!response.ok) return response;

      const decoded = decodeJsonBody(PROVIDER, response.value.body);
      if (!decoded.ok) return decoded;

      if (response.value.status < 200 || response.value.status >= 300) {
        return err(httpError(PROVIDER, response.value.status, errorDetail(decoded.value)));
      }

      const data = readArray(decoded.value, 'data');
      if (data === null) {
        return err(
          providerError(PROVIDER, 'bad-response', 'The provider did not return a model list.'),
        );
      }

      const models: ModelInfo[] = [];
      for (const entry of data) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
        const id = readString(entry as Record<string, unknown>, 'id');
        if (id === null || id.length === 0 || !isChatModel(id)) continue;
        models.push({ id, label: id });
      }

      return ok(models);
    },
  };
}
