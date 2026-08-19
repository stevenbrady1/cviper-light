/**
 * Ollama — the local, keyless, default provider.
 *
 * ============================================================================
 * NATIVE /api/chat, NOT THE OPENAI-COMPATIBLE ENDPOINT.
 * ============================================================================
 * Ollama also exposes /v1/chat/completions. It is a translation layer that
 * silently drops parameters it cannot map, and it buys us nothing here: we are
 * not reusing an OpenAI SDK, the native endpoint takes a JSON Schema directly,
 * and `options` (num_ctx, num_predict) has no equivalent in the compat shim.
 * Going native means every knob we set actually reaches llama.cpp.
 *
 * The base URL lives in Rust. This adapter only ever produces a request body.
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

const PROVIDER = 'ollama' as const;

/**
 * The context window we ask for, in tokens.
 *
 * ============================================================================
 * SET EXPLICITLY, ALWAYS.
 * ============================================================================
 * Ollama defaults `num_ctx` to 2048 no matter what the model card says it
 * supports. Our prompt — 6000 characters of CV, 4000 of advert, plus the
 * calibration anchors — is comfortably past that, so leaving it unset means the
 * daemon quietly drops the front of the prompt and the model answers about a CV
 * it never saw. Nothing errors. The score is just wrong.
 *
 * 8192 holds roughly 3900 tokens of prompt plus a 2048-token answer with room
 * to spare. It is deliberately NOT set to the model's maximum: llama3.2 claims
 * 131072, and a 3.2B model does not comprehend 131k tokens — it just allocates
 * the KV cache for them, costing memory and speed for nothing.
 */
export const OLLAMA_DEFAULT_NUM_CTX = 8192;

export interface OllamaOptions {
  /** Raise for a larger model with a genuinely usable window. */
  readonly numCtx?: number;
}

/** Ollama reports `done_reason: "length"` when it stops at the output cap. */
const DONE_REASON_LENGTH = 'length';

/**
 * Model architectures that cannot chat.
 *
 * ============================================================================
 * THIS IS THE FILTER THAT ACTUALLY RUNS. `capabilities` USUALLY IS NOT THERE.
 * ============================================================================
 * `/api/tags` — the endpoint this adapter reads, and the one `ollama_probe`
 * already has in hand — does NOT carry `capabilities`. That field belongs to
 * `/api/show`, which is one request per installed model. So on a live daemon
 * the code below is not a legacy fallback: it is the whole filter.
 *
 * `details.family` and `details.families` ARE in every `/api/tags` reply, and
 * they are the honest signal. Every embedding model in Ollama's library is a
 * BERT derivative, and no chat model is one — a generative model is a llama,
 * qwen, gemma, phi or mistral. Matching on the architecture therefore catches
 * `all-minilm` and `bge-m3`, whose names say nothing at all.
 */
const EMBEDDING_FAMILIES = new Set([
  'bert',
  'nomic-bert',
  'jina-bert',
  'distilbert',
  'roberta',
  'xlm-roberta',
]);

/**
 * Names that mean "embedding" without containing the word.
 *
 * The second line of defence, for a daemon too old to report `details` at all.
 * Deliberately anchored to the START of the name: `bge-m3` is an embedder,
 * whereas a chat model that merely happens to contain `gte` somewhere in its
 * tag is not, and a filter that empties a correctly configured picker is worse
 * than one that lets a bad option through — at least the bad option produces an
 * error the user can read.
 */
const EMBEDDING_NAME_PATTERNS: readonly RegExp[] = [
  /embed/i,
  /^all-minilm/i,
  /^bge-/i,
  /^gte-/i,
  /^e5-/i,
  /^paraphrase-/i,
  /^mxbai-/i,
];

/** Every architecture string the daemon offered for one model. */
function familiesOf(entry: Record<string, unknown>): string[] {
  const details = readObject(entry, 'details');
  if (details === null) return [];

  const single = readString(details, 'family');
  const many = readArray(details, 'families') ?? [];

  return [...(single === null ? [] : [single]), ...many.filter((f) => typeof f === 'string')].map(
    (family) => family.toLowerCase(),
  );
}

function isChatCapable(entry: Record<string, unknown>): boolean {
  const capabilities = readArray(entry, 'capabilities');

  if (capabilities !== null) {
    // The daemon's own answer, and it outranks everything below. If a BERT
    // model ever grows a completion head, this is how we find out — rather than
    // overruling the daemon with a heuristic written in 2026.
    return capabilities.includes('completion');
  }

  if (familiesOf(entry).some((family) => EMBEDDING_FAMILIES.has(family))) return false;

  const id = readString(entry, 'model') ?? readString(entry, 'name') ?? '';
  return !EMBEDDING_NAME_PATTERNS.some((pattern) => pattern.test(id));
}

function toModelInfo(entry: Record<string, unknown>): ModelInfo | null {
  // `.model` is the fully-qualified `name:tag` that /api/chat accepts. `.name`
  // happens to match today but is a display field, and sending a bare family
  // name gets a 404 for a model the user can plainly see in the list.
  const id = readString(entry, 'model');
  if (id === null || id.length === 0) return null;

  const size = readString(readObject(entry, 'details') ?? {}, 'parameter_size');
  return { id, label: size === null ? id : `${id} (${size})` };
}

export function createOllamaProvider(
  transport: ChatTransport,
  options: OllamaOptions = {},
): AiProvider {
  const numCtx = options.numCtx ?? OLLAMA_DEFAULT_NUM_CTX;

  return {
    id: PROVIDER,

    async chatJson(request: ChatJsonRequest): Promise<Result<string, ProviderError>> {
      const body = JSON.stringify({
        model: request.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        // THE SCHEMA GOES HERE DIRECTLY. Ollama's `format` takes the JSON
        // Schema itself — it is NOT wrapped in `{ schema: ... }` the way
        // OpenAI's `json_schema` is. Wrapping it does not error; the daemon
        // just fails to build a grammar and the output goes unconstrained.
        format: request.schema,
        stream: false,
        options: {
          temperature: request.temperature,
          num_ctx: numCtx,
          num_predict: request.maxOutputTokens,
        },
      });

      const response = await transport.chat(PROVIDER, body);
      if (!response.ok) return response;

      const decoded = decodeJsonBody(PROVIDER, response.value.body);
      if (!decoded.ok) return decoded;

      if (response.value.status < 200 || response.value.status >= 300) {
        // Ollama's error envelope is a bare string: {"error":"model not found"}.
        return err(httpError(PROVIDER, response.value.status, readString(decoded.value, 'error')));
      }

      const message = readObject(decoded.value, 'message');
      const content = message === null ? null : readString(message, 'content');
      if (content === null) {
        return err(
          providerError(
            PROVIDER,
            'bad-response',
            'Ollama replied without any message content. The daemon may have ' +
              'been restarted mid-request.',
          ),
        );
      }

      // Checked AFTER the content is in hand: a capped reply still carries the
      // partial answer, and reporting it as truncated is what stops the repair
      // ladder mislabelling it as "the model wrote prose".
      if (readString(decoded.value, 'done_reason') === DONE_REASON_LENGTH) {
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
        return err(httpError(PROVIDER, response.value.status, readString(decoded.value, 'error')));
      }

      const models = readArray(decoded.value, 'models');
      if (models === null) {
        return err(
          providerError(
            PROVIDER,
            'bad-response',
            'Ollama did not return a list of models. Check the version of the ' +
              'daemon that is running.',
          ),
        );
      }

      const usable: ModelInfo[] = [];
      for (const entry of models) {
        // A malformed entry is skipped, not fatal: one odd row must not hide
        // every other model the user has pulled.
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
        const record = entry as Record<string, unknown>;
        if (!isChatCapable(record)) continue;
        const info = toModelInfo(record);
        if (info !== null) usable.push(info);
      }

      return ok(usable);
    },
  };
}
