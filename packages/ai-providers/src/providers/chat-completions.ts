/**
 * The OpenAI chat-completions dialect, shared by every provider that speaks it.
 *
 * ============================================================================
 * ONE ADAPTER, FIVE PROVIDERS (L-177)
 * ============================================================================
 * OpenAI defined `POST /chat/completions`, and Google (through its OpenAI
 * compatibility layer), Mistral, xAI and OpenRouter all implement the same
 * request and response envelope: `messages`, `response_format.json_schema`,
 * `choices[0].message.content`, `finish_reason`. Writing five copies of the
 * OpenAI adapter would be five places for the auth-redaction rule in
 * `shared.ts` to drift, so there is one, parameterised by the provider id the
 * transport routes on.
 *
 * The one real difference is the name of the output cap. OpenAI deprecated
 * `max_tokens` in favour of `max_completion_tokens`, and its newer reasoning
 * models reject the old name outright. The others accept `max_tokens` and are
 * not documented to accept the new one, so each provider names its field here
 * rather than every request carrying both and hoping neither side objects.
 *
 * The base URL, path and `Authorization: Bearer` header live in Rust
 * (`providers.rs`). The key never enters JavaScript, so it cannot enter this
 * file.
 */
import { err, ok, type Result } from '@cviper/core-types';

import {
  providerError,
  type AiProvider,
  type ChatJsonRequest,
  type ChatTransport,
  type ModelInfo,
  type ProviderError,
  type ProviderId,
} from '../types';
import {
  REASONING_TRUNCATED_MESSAGE,
  TRUNCATED_MESSAGE,
  decodeJsonBody,
  detailUnlessAuth,
  httpError,
  readArray,
  readObject,
  readString,
  wireOutputCap,
} from './shared';

/** The providers this adapter serves. Anthropic and Ollama have their own. */
export type ChatCompletionsProviderId = Exclude<ProviderId, 'anthropic' | 'ollama'>;

/**
 * Fixed defaults, one per provider, chosen for longevity over ambition — the
 * same reasoning `OPENAI_DEFAULT_MODEL` gives in `analysis/providers.ts`. Each
 * is the standard-tier slug the hosted product defaults to, refreshed there
 * against the provider's published model list.
 *
 * OpenAI's own default stays in the app (`analysis/providers.ts`) where it
 * always was; moving it would turn one import into two for no gain.
 */
export const GOOGLE_DEFAULT_MODEL = 'gemini-3.5-flash';
export const MISTRAL_DEFAULT_MODEL = 'mistral-small-latest';
export const GROK_DEFAULT_MODEL = 'grok-4.3';
export const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o-mini';

/**
 * Names the schema in the response format. Free-form, but must be present.
 *
 * The DEFAULT only. `ChatJsonRequest.schemaName` overrides it, because this
 * adapter carries several schemas — the CV analysis, the pasted-advert
 * extraction, the tailoring — and labelling one with another's name on the
 * wire is a lie that only surfaces when somebody is already debugging.
 */
const DEFAULT_SCHEMA_NAME = 'cv_analysis';

/** `finish_reason` when the model stopped at the output cap. */
const FINISH_REASON_LENGTH = 'length';

/**
 * Model families that cannot answer a chat completion.
 *
 * `/models` returns everything the key can reach — embeddings, speech, images,
 * moderation — in one undifferentiated list, and none of these APIs expose a
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
  // Mistral's and Google's embedders, by their own ids.
  'mistral-embed',
  'codestral-embed',
  'models/embedding',
  'models/text-embedding',
];

function isChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  return !NON_CHAT_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** Which name the output cap travels under, per provider. */
function maxTokensField(
  provider: ChatCompletionsProviderId,
): 'max_completion_tokens' | 'max_tokens' {
  return provider === 'openai' ? 'max_completion_tokens' : 'max_tokens';
}

/**
 * `usage.completion_tokens_details.reasoning_tokens`, or 0 when not reported.
 *
 * OpenAI, xAI and OpenRouter report it; a provider that does not is simply
 * treated as not having thought, which only chooses the plainer message.
 */
function reasoningTokens(body: Record<string, unknown>): number {
  const usage = readObject(body, 'usage');
  const details = usage === null ? null : readObject(usage, 'completion_tokens_details');
  const count = details === null ? undefined : details['reasoning_tokens'];
  return typeof count === 'number' ? count : 0;
}

/** Pull the provider's own explanation out of `{"error": {"message": …}}`. */
function errorDetail(body: Record<string, unknown>): string | null {
  const error = readObject(body, 'error');
  if (error === null) {
    // Mistral answers some 4xx with a bare `{"message": "…"}`; the shape is
    // still the provider's own prose and still subject to `detailUnlessAuth`.
    return readString(body, 'message');
  }
  return readString(error, 'message');
}

export function createChatCompletionsProvider(
  provider: ChatCompletionsProviderId,
  transport: ChatTransport,
): AiProvider {
  return {
    id: provider,

    async chatJson(request: ChatJsonRequest): Promise<Result<string, ProviderError>> {
      const body = JSON.stringify({
        model: request.model,
        // Budget plus room to think (L-185); see `wireOutputCap`.
        [maxTokensField(provider)]: wireOutputCap(request.maxOutputTokens),
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

      const response = await transport.chat(provider, body);
      if (!response.ok) return response;

      const decoded = decodeJsonBody(provider, response.value.body);
      if (!decoded.ok) return decoded;

      if (response.value.status < 200 || response.value.status >= 300) {
        // `detailUnlessAuth`, not the raw detail: OpenAI's 401 body quotes the
        // rejected key back, masked, and this message is rendered verbatim in
        // the analysis error banner. The rule is about the SHAPE of an auth
        // response, so it applies to every provider here. See `shared.ts`.
        const status = response.value.status;
        return err(
          httpError(provider, status, detailUnlessAuth(status, errorDetail(decoded.value))),
        );
      }

      const choices = readArray(decoded.value, 'choices') ?? [];
      const first = choices[0];
      if (typeof first !== 'object' || first === null || Array.isArray(first)) {
        return err(
          providerError(
            provider,
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
        return err(providerError(provider, 'bad-request', refusal));
      }

      const content = message === null ? null : readString(message, 'content');

      // Checked BEFORE the missing-content case (L-185): a model that thought
      // until the cap and wrote nothing replies with no content at all, and
      // "replied without any content" would hide the one useful fact.
      if (readString(choice, 'finish_reason') === FINISH_REASON_LENGTH) {
        const thought =
          content === null || content.trim().length === 0 || reasoningTokens(decoded.value) > 0;
        return err(
          providerError(
            provider,
            'truncated',
            thought ? REASONING_TRUNCATED_MESSAGE : TRUNCATED_MESSAGE,
          ),
        );
      }

      if (content === null) {
        return err(
          providerError(provider, 'bad-response', 'The provider replied without any content.'),
        );
      }

      return ok(content);
    },

    async listModels(): Promise<Result<ModelInfo[], ProviderError>> {
      const response = await transport.listModels(provider);
      if (!response.ok) return response;

      const decoded = decodeJsonBody(provider, response.value.body);
      if (!decoded.ok) return decoded;

      if (response.value.status < 200 || response.value.status >= 300) {
        // Same rule on the model list: a 401 here carries the same body.
        const status = response.value.status;
        return err(
          httpError(provider, status, detailUnlessAuth(status, errorDetail(decoded.value))),
        );
      }

      const data = readArray(decoded.value, 'data');
      if (data === null) {
        return err(
          providerError(provider, 'bad-response', 'The provider did not return a model list.'),
        );
      }

      const models: ModelInfo[] = [];
      for (const entry of data) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
        const record = entry as Record<string, unknown>;
        const id = readString(record, 'id');
        if (id === null || id.length === 0 || !isChatModel(id)) continue;
        // OpenRouter and Google carry a display name; OpenAI, Mistral and xAI
        // do not, and the id is the only honest label there is.
        models.push({ id, label: readString(record, 'name') ?? id });
      }

      return ok(models);
    },
  };
}
