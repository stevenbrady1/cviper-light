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
import {
  ANTHROPIC_SECRET_KEY,
  GOOGLE_SECRET_KEY,
  GROK_SECRET_KEY,
  MISTRAL_SECRET_KEY,
  OPENAI_SECRET_KEY,
  OPENROUTER_SECRET_KEY,
} from '../../status/secretKeyNames';

import { type Availability, type CustomServiceSummary } from './providers';

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

/** Whether the daemon answered, and the chat-capable models it reported. */
async function ollamaState(): Promise<{
  readonly running: boolean;
  readonly models: readonly ModelInfo[];
}> {
  const tags = await probeOllama();
  // `null` is the normal answer on most machines. Not an error, and not
  // something to tell the user about here.
  if (tags === null) return { running: false, models: [] };

  // Anything at all came back on the port, so the daemon IS running. Whether
  // its answer parsed is a separate question, and the empty list already says
  // "nothing usable" — conflating the two would make a proxy's login page look
  // like an uninstalled Ollama and lose the one hint worth showing.
  const listed = await createOllamaProvider(replayTransport(tags)).listModels();
  return { running: true, models: listed.ok ? listed.value : [] };
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
/**
 * The typed-address service (L-150), if one is saved.
 *
 * Rust's status command answers with the address, the tick and whether a key
 * is saved — never the key. Only the tick travels on from here. Anything that
 * is not that exact shape, and any failure at all, is "none": the same
 * fail-closed reading as `hasKey`.
 */
async function customService(): Promise<CustomServiceSummary | null> {
  try {
    const status: unknown = await invoke('custom_provider_status');
    if (typeof status !== 'object' || status === null || Array.isArray(status)) return null;
    const record = status as Record<string, unknown>;
    const ownNetwork = record['own_network'];
    return typeof record['address'] === 'string' && typeof ownNetwork === 'boolean'
      ? { ownNetwork }
      : null;
  } catch {
    return null;
  }
}

export async function readAvailability(): Promise<Availability> {
  const [ollama, anthropicKey, openaiKey, googleKey, mistralKey, grokKey, openrouterKey, custom] =
    await Promise.all([
      ollamaState(),
      hasKey(ANTHROPIC_SECRET_KEY),
      hasKey(OPENAI_SECRET_KEY),
      hasKey(GOOGLE_SECRET_KEY),
      hasKey(MISTRAL_SECRET_KEY),
      hasKey(GROK_SECRET_KEY),
      hasKey(OPENROUTER_SECRET_KEY),
      customService(),
    ]);

  return {
    ollamaRunning: ollama.running,
    ollamaModels: ollama.models,
    anthropicKey,
    openaiKey,
    googleKey,
    mistralKey,
    grokKey,
    openrouterKey,
    // Present only when saved, so "none" reads exactly as it did before L-150.
    ...(custom === null ? {} : { customService: custom }),
  };
}
