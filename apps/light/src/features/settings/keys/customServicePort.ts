/**
 * The Settings card's line to Rust for the AI service at a typed address
 * (L-150).
 *
 * ============================================================================
 * THE ADDRESS AND THE KEY GO IN TOGETHER, AND ONLY THE ADDRESS COMES BACK
 * ============================================================================
 * `custom_provider_save` tests the address and key together and saves them as
 * ONE credential-store entry, so the key can only ever be sent to the address
 * it was saved with. There is no way to change one without the other, and no
 * command that hands the key back: `status` answers with the address, the tick
 * and a bool. See `src-tauri/src/custom_provider.rs`.
 *
 * Removing is the ordinary `secret_delete`, which is idempotent.
 */
import { invoke } from '@tauri-apps/api/core';

import {
  createChatCompletionsProvider,
  providerError,
  type ChatTransport,
  type ModelInfo,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';
import { err, ok, type Result } from '@cviper/core-types';

import { listCustomModels } from '../../../ai/transport';
import { CUSTOM_PROVIDER_SECRET_KEY } from '../../../status/secretKeyNames';

const SAVE_COMMAND = 'custom_provider_save';
const STATUS_COMMAND = 'custom_provider_status';

/** What Settings may know about the saved service. Never the key. */
export interface CustomServiceStatus {
  readonly address: string;
  readonly ownNetwork: boolean;
  readonly hasKey: boolean;
}

export interface CustomServiceInput {
  readonly address: string;
  readonly ownNetwork: boolean;
  /** Empty when a service on the user's own network needs none. */
  readonly key: string;
}

export interface CustomServiceProblem {
  /** Legible enough to show a user as it is. */
  readonly message: string;
}

export interface CustomServicePort {
  /** The saved service, `null` when none is saved. */
  status(): Promise<Result<CustomServiceStatus | null, CustomServiceProblem>>;
  /** Test the address and key together and, only if they work, save them together. */
  save(input: CustomServiceInput): Promise<Result<void, CustomServiceProblem>>;
  remove(): Promise<Result<void, CustomServiceProblem>>;
  /** The saved service's own model list. */
  listModels(): Promise<Result<readonly ModelInfo[], CustomServiceProblem>>;
}

const UNREADABLE = 'CViper could not get an answer about that service. Try again in a moment.';

/** The sentence Rust chose (`{kind, message}`), or a fixed fallback. Never raw JSON. */
export function describeFailure(thrown: unknown): string {
  if (typeof thrown === 'string') {
    try {
      const parsed: unknown = JSON.parse(thrown);
      if (typeof parsed === 'object' && parsed !== null) {
        const message = (parsed as Record<string, unknown>)['message'];
        if (typeof message === 'string' && message.trim() !== '') return message;
      }
    } catch {
      // A plain sentence — `secret_delete` answers with one.
    }
    if (thrown.trim() !== '' && !thrown.trim().startsWith('{')) return thrown;
  }
  if (thrown instanceof Error && thrown.message.trim() !== '') return thrown.message;
  return UNREADABLE;
}

/** Rust's `{address, own_network, has_key}`, or `null` for anything else. */
export function readStatus(raw: unknown): CustomServiceStatus | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const address = record['address'];
  const ownNetwork = record['own_network'];
  const hasKey = record['has_key'];
  return typeof address === 'string' &&
    address !== '' &&
    typeof ownNetwork === 'boolean' &&
    typeof hasKey === 'boolean'
    ? { address, ownNetwork, hasKey }
    : null;
}

/** Asks the saved service for its raw model list. Injected by tests. */
export type ModelLister = () => Promise<Result<ProviderHttpResponse, ProviderError>>;

/**
 * A transport that can list models and NOTHING else, so the adapter can read
 * the reply while this card stays incapable of sending a chat — see
 * `listCustomModels`.
 */
function listOnly(list: ModelLister): ChatTransport {
  return {
    chat: () =>
      Promise.resolve(
        err(providerError('custom', 'bad-request', 'Settings only lists this service’s models.')),
      ),
    listModels: () => list(),
  };
}

export function createTauriCustomServicePort(
  list: ModelLister = listCustomModels,
): CustomServicePort {
  return {
    async status() {
      try {
        return ok(readStatus(await invoke(STATUS_COMMAND)));
      } catch (thrown) {
        return err({ message: describeFailure(thrown) });
      }
    },

    async save({ address, ownNetwork, key }) {
      try {
        // `ownNetwork` is Rust's `own_network`: Tauri converts the case.
        await invoke(SAVE_COMMAND, { address, ownNetwork, key });
        return ok(undefined);
      } catch (thrown) {
        return err({ message: describeFailure(thrown) });
      }
    },

    async remove() {
      try {
        await invoke('secret_delete', { key: CUSTOM_PROVIDER_SECRET_KEY });
        return ok(undefined);
      } catch (thrown) {
        return err({ message: describeFailure(thrown) });
      }
    },

    async listModels() {
      const listed = await createChatCompletionsProvider('custom', listOnly(list)).listModels();
      return listed.ok ? ok(listed.value) : err({ message: listed.error.message });
    },
  };
}
