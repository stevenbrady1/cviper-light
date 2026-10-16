/**
 * Keys left behind by an earlier install (L-251).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * API and job-board keys live in the system credential store (Windows
 * Credential Manager, the macOS keychain), not in the app's folders. An install
 * never clears it — that is what keeps keys across updates — and before 0.10.1
 * no uninstaller did either. So a fresh install can find keys somebody may have
 * forgotten were there. The owner's decision: ASK, never delete on our own.
 *
 * ============================================================================
 * WHEN IT ASKS: A FIRST RUN WITH NOTHING IN IT, ONCE
 * ============================================================================
 * Two signals together, because neither alone is enough:
 *
 *   * the welcome has not been seen (`onboarding/store.ts`) — the notice lives
 *     on the welcome, which only a first run (or Settings → "Show the welcome
 *     again") ever renders;
 *   * the database holds nothing: no job, application, CV, analysis, document
 *     or profile. A database that cannot be read counts as HAVING data, so a
 *     failure never produces the question.
 *
 * And once only: the moment it is decided — shown, or not needed — a flag is
 * stored under the app's own prefix, so "Delete everything" resets it along
 * with everything else. Storage that cannot be read counts as already asked,
 * for the same reason `onboarding/store.ts` gives.
 *
 * Removing goes through `secret_delete`, key by key — the same command "Delete
 * everything" uses — and only for the keys that were named.
 */
import { invoke } from '@tauri-apps/api/core';

import { err, ok, type Result } from '@cviper/core-types';

import { readAll } from '../../db';
import { SECRET_KEYS, type SecretKeyName } from '../../status/environment';

/** Every credential the question looks for: the same list "Delete everything" erases. */
export const LEFTOVER_QUERIED_KEYS: readonly SecretKeyName[] = SECRET_KEYS;

/** What each credential is called on screen. Adzuna's two parts share one name. */
export const LEFTOVER_KEY_LABELS: Readonly<Record<SecretKeyName, string>> = {
  adzuna_app_id: 'Adzuna',
  adzuna_app_key: 'Adzuna',
  reed_api_key: 'Reed',
  anthropic_api_key: 'Anthropic',
  openai_api_key: 'OpenAI',
  google_api_key: 'Google Gemini',
  mistral_api_key: 'Mistral',
  grok_api_key: 'xAI Grok',
  openrouter_api_key: 'OpenRouter',
  custom_provider: 'your own AI service',
};

/** Under the app prefix, so "Delete everything" clears it with the rest. */
export const LEFTOVER_KEYS_STORAGE_KEY = 'cviper.light.leftoverKeysChecked';

export interface LeftoverKeysPort {
  /** The saved credentials, from `LEFTOVER_QUERIED_KEYS`. A key that cannot be read is left out. */
  found(): Promise<SecretKeyName[]>;
  /** Whether the database holds anything. `true` when it cannot be read. */
  hasData(): Promise<boolean>;
  /** Delete exactly these credentials. */
  remove(keys: readonly SecretKeyName[]): Promise<Result<void, { readonly message: string }>>;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Already asked (or nothing to ask)? Unreadable storage counts as yes. */
export function hasCheckedLeftoverKeys(): boolean {
  const store = storage();
  if (store === null) return true;
  try {
    return store.getItem(LEFTOVER_KEYS_STORAGE_KEY) !== null;
  } catch {
    return true;
  }
}

export function markLeftoverKeysChecked(): void {
  try {
    storage()?.setItem(LEFTOVER_KEYS_STORAGE_KEY, 'checked');
  } catch {
    // Nothing to do: an unwritable store also reads as "checked" above.
  }
}

/** The names to show, in list order, each once. */
export function leftoverNames(keys: readonly SecretKeyName[]): string[] {
  const names: string[] = [];
  for (const key of LEFTOVER_QUERIED_KEYS) {
    if (!keys.includes(key)) continue;
    const name = LEFTOVER_KEY_LABELS[key];
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

function describeThrown(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string' && cause.trim() !== '') return cause;
  return 'The credential store did not answer.';
}

export function createTauriLeftoverKeysPort(): LeftoverKeysPort {
  return {
    async found() {
      const answers = await Promise.all(
        LEFTOVER_QUERIED_KEYS.map(async (key) => {
          try {
            return (await invoke('secret_status', { key })) === true ? key : null;
          } catch {
            // Unreadable is not "saved": never name a key we could not see.
            return null;
          }
        }),
      );
      return answers.filter((key): key is SecretKeyName => key !== null);
    },

    async hasData() {
      try {
        const read = await readAll();
        if (!read.ok) return true;
        const snapshot = read.value;
        return (
          snapshot.profile !== null ||
          snapshot.jobs.length > 0 ||
          snapshot.applications.length > 0 ||
          snapshot.cvs.length > 0 ||
          snapshot.analyses.length > 0 ||
          snapshot.documents.length > 0 ||
          snapshot.interview_substages.length > 0
        );
      } catch {
        return true;
      }
    },

    async remove(keys) {
      // Every one is attempted, and the first refusal is the one reported —
      // the same rule `forgetKeys` in settings/erase/port.ts follows.
      let first: string | null = null;
      for (const key of keys) {
        try {
          await invoke('secret_delete', { key });
        } catch (cause) {
          first ??= describeThrown(cause);
        }
      }
      return first === null ? ok(undefined) : err({ message: first });
    },
  };
}
