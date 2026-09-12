/**
 * Anthropic — bring-your-own-key cloud provider.
 *
 * ============================================================================
 * STRUCTURED OUTPUT VIA `output_config.format`. NOT TOOLS. NOT PREFILL.
 * ============================================================================
 * There are three ways to make this API emit JSON and only one of them is
 * current:
 *
 *   1. `output_config.format` with `type: "json_schema"` — what we use.
 *   2. Forcing a tool call with `tool_choice` — the old workaround. It works,
 *      but it wraps the answer in a tool-input envelope for no benefit.
 *   3. Prefilling the assistant turn with "{" — this now returns a hard 400 on
 *      current models. It is not a degraded path; it is a broken one.
 *
 * SCHEMA CONSTRAINTS THIS API REJECTS: `minimum`, `maximum`, `minLength`,
 * `maxLength` and recursion all 400. `CV_ANALYSIS_JSON_SCHEMA` carries
 * `minimum`/`maximum` on `match_score`, so they are stripped here on the way
 * out — see `stripUnsupportedKeywords`. The bounds are still enforced, by Zod,
 * after the answer comes back, which is where they always mattered.
 *
 * The base URL, the `x-api-key` header and `anthropic-version: 2023-06-01` all
 * live in Rust. The key never enters JavaScript, so it cannot enter this file.
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
  detailUnlessAuth,
  httpError,
  readArray,
  readObject,
  readString,
} from './shared';

const PROVIDER = 'anthropic' as const;

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5';

/** Stop reason returned when the model hit `max_tokens` mid-answer. */
const STOP_REASON_MAX_TOKENS = 'max_tokens';

/**
 * JSON Schema keywords Anthropic's structured outputs reject with a 400.
 *
 * Removed on the way out rather than removed from the schema: the same schema
 * object goes to Ollama, whose grammar builder honours `minimum`/`maximum` and
 * genuinely keeps a small model inside 0-100. Weakening the shared schema to
 * suit the strictest consumer would cost that.
 */
const UNSUPPORTED_KEYWORDS = new Set(['minimum', 'maximum', 'minLength', 'maxLength']);

function stripUnsupportedKeywords(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupportedKeywords);
  if (typeof node !== 'object' || node === null) return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    out[key] = stripUnsupportedKeywords(value);
  }
  return out;
}

/** Pull the provider's own explanation out of `{"error": {"message": …}}`. */
function errorDetail(body: Record<string, unknown>): string | null {
  const error = readObject(body, 'error');
  return error === null ? null : readString(error, 'message');
}

export function createAnthropicProvider(transport: ChatTransport): AiProvider {
  return {
    id: PROVIDER,

    async chatJson(request: ChatJsonRequest): Promise<Result<string, ProviderError>> {
      const body = JSON.stringify({
        model: request.model,
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        // Top-level, not a message. Anthropic has no "system" message role.
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        output_config: {
          format: { type: 'json_schema', schema: stripUnsupportedKeywords(request.schema) },
        },
      });

      const response = await transport.chat(PROVIDER, body);
      if (!response.ok) return response;

      const decoded = decodeJsonBody(PROVIDER, response.value.body);
      if (!decoded.ok) return decoded;

      if (response.value.status < 200 || response.value.status >= 300) {
        // `detailUnlessAuth`, not the raw detail. An auth body is the one place
        // a provider is liable to quote the rejected credential back, and this
        // message is rendered verbatim in the analysis error banner. See the
        // note in `shared.ts`; OpenAI does exactly that.
        const status = response.value.status;
        return err(
          httpError(PROVIDER, status, detailUnlessAuth(status, errorDetail(decoded.value))),
        );
      }

      const content = readArray(decoded.value, 'content') ?? [];
      let text: string | null = null;
      for (const block of content) {
        // Extended thinking and tool blocks can precede the answer, so the
        // first block is not necessarily the text one.
        if (typeof block !== 'object' || block === null || Array.isArray(block)) continue;
        const record = block as Record<string, unknown>;
        if (readString(record, 'type') !== 'text') continue;
        const value = readString(record, 'text');
        if (value !== null) {
          text = value;
          break;
        }
      }

      if (text === null) {
        return err(
          providerError(PROVIDER, 'bad-response', 'The provider replied without any text content.'),
        );
      }

      if (readString(decoded.value, 'stop_reason') === STOP_REASON_MAX_TOKENS) {
        return err(providerError(PROVIDER, 'truncated', TRUNCATED_MESSAGE));
      }

      return ok(text);
    },

    async listModels(): Promise<Result<ModelInfo[], ProviderError>> {
      const response = await transport.listModels(PROVIDER);
      if (!response.ok) return response;

      const decoded = decodeJsonBody(PROVIDER, response.value.body);
      if (!decoded.ok) return decoded;

      if (response.value.status < 200 || response.value.status >= 300) {
        // Same rule on the model list: a 401 here carries the same body.
        const status = response.value.status;
        return err(
          httpError(PROVIDER, status, detailUnlessAuth(status, errorDetail(decoded.value))),
        );
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
        const record = entry as Record<string, unknown>;
        const id = readString(record, 'id');
        if (id === null || id.length === 0) continue;
        models.push({ id, label: readString(record, 'display_name') ?? id });
      }

      return ok(models);
    },
  };
}
