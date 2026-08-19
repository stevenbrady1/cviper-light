/**
 * What is actually set up on this machine, as one readable answer.
 *
 * ============================================================================
 * WHY THIS IS PERMANENT CHROME AND NOT A SETTINGS SCREEN
 * ============================================================================
 * CViper Light works with nothing configured: the tracker is complete offline
 * and keyless, and the search and analysis views degrade to their keyless paths.
 * That is a genuine product promise, and the failure mode of a promise like that
 * is a user who cannot tell whether a feature is missing, broken, or simply
 * switched off.
 *
 * So the answer lives in the rail, always, rather than behind a Settings tab
 * that only tells you once you go looking. Nothing here is an error state. A
 * machine with no keys and no Ollama is not misconfigured — it is the default,
 * and it is honest to show it as three quiet dots rather than to hide it.
 *
 * ============================================================================
 * FOUR KEY STATES, NOT TWO
 * ============================================================================
 *   configured  the key or keys are there
 *   incomplete  Adzuna only: one of its two credentials is saved. It cannot
 *               work yet, and "missing" would tell a user who has just pasted
 *               an app id that nothing happened
 *   missing     nothing saved. The normal, expected state
 *   unreadable  the OS credential store refused to answer — locked keychain,
 *               no Secret Service, a platform error. NOT the same as missing:
 *               reporting a locked store as empty invites the user to paste a
 *               key they have already saved
 *
 * `secret_status` returns a bool and NEVER the value — see the module comment in
 * `src-tauri/src/secrets.rs`. Nothing in this file can see a key.
 */
import { invoke } from '@tauri-apps/api/core';

import { probeOllama } from '../ai/transport';

import { requestsToday } from './requestLog';

/**
 * The five credentials the app can hold, spelled exactly as the `SecretKey`
 * enum serialises them in `src-tauri/src/secrets.rs`.
 *
 * A string that is not one of these is refused by serde before our Rust runs,
 * so a typo here is a runtime failure rather than a silent `false` — which is
 * why `environment.test.ts` asserts the app asks about exactly this set.
 */
export const SECRET_KEYS = [
  'adzuna_app_id',
  'adzuna_app_key',
  'reed_api_key',
  'anthropic_api_key',
  'openai_api_key',
] as const;

export type SecretKeyName = (typeof SECRET_KEYS)[number];

/**
 * The credentials the status strip actually asks about.
 *
 * A strict subset of `SECRET_KEYS`, and deliberately not all of it. The strip
 * answers "can I search for jobs", so it reads the search credentials; the two
 * AI keys belong to the analysis view's own indicator, and reading them here
 * would be two IPC round trips per refresh for a dot nobody draws.
 */
export const QUERIED_SECRET_KEYS = [
  'adzuna_app_id',
  'adzuna_app_key',
  'reed_api_key',
] as const satisfies readonly SecretKeyName[];

export type OllamaState = 'running' | 'absent';

export type KeyState = 'configured' | 'incomplete' | 'missing' | 'unreadable';

export interface EnvironmentStatus {
  readonly ollama: OllamaState;
  readonly adzuna: KeyState;
  readonly reed: KeyState;
  readonly requestsToday: number;
}

/** One credential: is it there? `null` means the store could not say. */
async function secretStatus(key: SecretKeyName): Promise<boolean | null> {
  try {
    const answer = await invoke('secret_status', { key });
    // A non-boolean answer means Rust and this file disagree about the command.
    // Treating a truthy string as "yes" would claim a key exists on the word of
    // a bug.
    return typeof answer === 'boolean' ? answer : null;
  } catch {
    // The Rust side already turns every keyring error into a sentence safe to
    // show a user, and the Settings view is where that sentence belongs. Here
    // the only thing the strip needs to know is that the answer is not usable.
    return null;
  }
}

/**
 * Collapse the answers for one provider's credentials into a single state.
 *
 * Exported because the Settings key cards need exactly this rule and a second
 * copy of it would be a second place for `incomplete` to be got wrong. The rail
 * and the setup screen must never disagree about what this machine has.
 */
export function combineKeyState(answers: readonly (boolean | null)[]): KeyState {
  if (answers.some((answer) => answer === null)) return 'unreadable';
  if (answers.every((answer) => answer === true)) return 'configured';
  if (answers.some((answer) => answer === true)) return 'incomplete';
  return 'missing';
}

/**
 * Read the whole strip in one pass.
 *
 * Every probe runs concurrently and independently: one locked credential must
 * not stop the app finding out that Ollama is running. Nothing here rejects —
 * the caller gets a complete answer or a complete answer, never an exception.
 */
export async function readEnvironmentStatus(now: Date = new Date()): Promise<EnvironmentStatus> {
  const [tags, adzunaAppId, adzunaAppKey, reedApiKey] = await Promise.all([
    probeOllama(),
    secretStatus('adzuna_app_id'),
    secretStatus('adzuna_app_key'),
    secretStatus('reed_api_key'),
  ]);

  return {
    ollama: tags === null ? 'absent' : 'running',
    adzuna: combineKeyState([adzunaAppId, adzunaAppKey]),
    reed: combineKeyState([reedApiKey]),
    requestsToday: requestsToday(now),
  };
}
