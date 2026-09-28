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
 *
 * Since L-177 the body of this adapter lives in `chat-completions.ts`, shared
 * with Google, Mistral, xAI and OpenRouter, which all implement the same
 * envelope. This file is the `openai` instance of it and keeps the notes
 * above because they are still the reasons the shared adapter is shaped the
 * way it is — `max_completion_tokens` is OpenAI's own quirk, and it is the
 * one place the shared adapter branches on the provider.
 */
import { type AiProvider, type ChatTransport } from '../types';
import { createChatCompletionsProvider } from './chat-completions';

export function createOpenAiProvider(transport: ChatTransport): AiProvider {
  return createChatCompletionsProvider('openai', transport);
}
