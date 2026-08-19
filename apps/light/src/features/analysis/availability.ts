/**
 * What this machine can actually offer, read once when the analysis view opens.
 *
 * ============================================================================
 * THE OLLAMA MODEL LIST COMES OUT OF THE PROBE, NOT OUT OF A SECOND REQUEST.
 * ============================================================================
 * `ollama_probe` already fetches `/api/tags` — that IS the model list — and it
 * is deliberately not counted as a provider request, because asking a daemon on
 * loopback whether it is switched on costs the user nothing and is not
 * something they asked for.
 *
 * So the body it returns is parsed by handing it to the SAME adapter the chat
 * path uses, through a one-shot transport that answers with the text already in
 * hand. No second round trip, no second parser to keep in step, and the
 * embedding-model filter that would otherwise have to be duplicated here comes
 * along for free.
 *
 * ============================================================================
 * UNREADABLE IS NOT AVAILABLE
 * ============================================================================
 * A credential store that will not answer — a locked keychain, no Secret
 * Service — reports `false` here, so the provider is not offered. The status
 * strip in the rail draws that distinction properly (see `status/environment.ts`)
 * because its job is to explain the machine. This file's job is to decide what
 * to put in a picker, and an option that is going to fail is worse than an
 * option that is not there.
 */
import { createOllamaProvider, type ChatTransport, type ModelInfo } from '@cviper/ai-providers';
import { err, ok } from '@cviper/core-types';
import { invoke } from '@tauri-apps/api/core';

import { probeOllama } from '../../ai/transport';

import { type Availability } from './providers';

/** The two credentials this view cares about, spelled as `SecretKey` serialises. */
const ANTHROPIC_KEY = 'anthropic_api_key';
const OPENAI_KEY = 'openai_api_key';

/**
 * A transport that answers `listModels` from text already fetched and refuses
 * everything else.
 *
 * The refusal is not defensive noise: it is what makes it impossible for this
 * file to accidentally acquire the ability to run an analysis.
 */
function replayTransport(body: string): ChatTransport {
  return {
    chat: () =>
      Promise.resolve(
        err({
          provider: 'ollama' as const,
          kind: 'not-running' as const,
          message: 'This transport only replays a probe.',
        }),
      ),
    listModels: () => Promise.resolve(ok({ status: 200, body })),
  };
}

/** The chat-capable models Ollama reported, or none. */
async function ollamaModels(): Promise<readonly ModelInfo[]> {
  const tags = await probeOllama();
  // `null` is the normal answer on most machines. Not an error, and not
  // something to tell the user about here.
  if (tags === null) return [];

  const listed = await createOllamaProvider(replayTransport(tags)).listModels();
  return listed.ok ? listed.value : [];
}

/** Is this key saved? Anything other than a plain `true` counts as no. */
async function hasKey(key: string): Promise<boolean> {
  try {
    return (await invoke('secret_status', { key })) === true;
  } catch {
    // The store could not answer. See the header: not available.
    return false;
  }
}

/**
 * Read the whole picture in one pass.
 *
 * Every probe runs concurrently and independently, so a locked credential store
 * cannot stop the app finding out that Ollama is running. Nothing here rejects.
 */
export async function readAvailability(): Promise<Availability> {
  const [models, anthropicKey, openaiKey] = await Promise.all([
    ollamaModels(),
    hasKey(ANTHROPIC_KEY),
    hasKey(OPENAI_KEY),
  ]);

  return { ollamaModels: models, anthropicKey, openaiKey };
}
