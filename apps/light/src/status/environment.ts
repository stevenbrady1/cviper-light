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
 * machine with no keys and no Ollama is not misconfigured — it is the default.
 * Since L-191 the rail names only what is set up (or needs the user) and says
 * "Nothing set up yet" when that is nothing; see `app/StatusStrip.tsx`.
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
import {
  ANTHROPIC_SECRET_KEY,
  GOOGLE_SECRET_KEY,
  GROK_SECRET_KEY,
  MISTRAL_SECRET_KEY,
  OPENAI_SECRET_KEY,
  OPENROUTER_SECRET_KEY,
} from './secretKeyNames';

/**
 * The five credentials the app can hold, spelled exactly as the `SecretKey`
 * enum serialises them in `src-tauri/src/secrets.rs`.
 *
 * A string that is not one of these is refused by serde before our Rust runs,
 * so a typo here is a runtime failure rather than a silent `false` — which is
 * why `environment.test.ts` asserts the app asks about exactly this set. The
 * two AI credentials are the shared constants from `./secretKeyNames` (C2,
 * coordinator review of PR #96) rather than a third copy of the same two
 * literals — `keys/aiKeyModel.ts` and `analysis/availability.ts` are the
 * other two.
 */
export const SECRET_KEYS = [
  'adzuna_app_id',
  'adzuna_app_key',
  'reed_api_key',
  ANTHROPIC_SECRET_KEY,
  OPENAI_SECRET_KEY,
  GOOGLE_SECRET_KEY,
  MISTRAL_SECRET_KEY,
  GROK_SECRET_KEY,
  OPENROUTER_SECRET_KEY,
] as const;

export type SecretKeyName = (typeof SECRET_KEYS)[number];

export type KeyState = 'configured' | 'incomplete' | 'missing' | 'unreadable';

/**
 * The cloud AI providers the strip reports on (L-182), in the order Settings
 * lists them, each with the short name the narrow rail has room for.
 */
export const AI_STATUS_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', key: OPENAI_SECRET_KEY },
  { id: 'anthropic', label: 'Anthropic', key: ANTHROPIC_SECRET_KEY },
  { id: 'google', label: 'Gemini', key: GOOGLE_SECRET_KEY },
  { id: 'mistral', label: 'Mistral', key: MISTRAL_SECRET_KEY },
  { id: 'grok', label: 'Grok', key: GROK_SECRET_KEY },
  { id: 'openrouter', label: 'OpenRouter', key: OPENROUTER_SECRET_KEY },
] as const;

export type AiStatusId = (typeof AI_STATUS_PROVIDERS)[number]['id'];

/** Every AI provider without a key: the first-run state, and the shape before the first read. */
export const NO_AI_KEYS: Readonly<Record<AiStatusId, KeyState>> = {
  openai: 'missing',
  anthropic: 'missing',
  google: 'missing',
  mistral: 'missing',
  grok: 'missing',
  openrouter: 'missing',
};

/**
 * The credentials the status strip asks about: the search credentials and,
 * since L-182, every AI key too.
 *
 * It used to leave the AI keys out to save six IPC round trips per refresh, on
 * the grounds that the analysis view had its own indicator. The owner asked
 * for them in the rail, so a user can see which AI providers are set up
 * without opening Settings. The reads are local and concurrent.
 */
export const QUERIED_SECRET_KEYS = [
  'adzuna_app_id',
  'adzuna_app_key',
  'reed_api_key',
  ...AI_STATUS_PROVIDERS.map((provider) => provider.key),
] as const satisfies readonly SecretKeyName[];

export type OllamaState = 'running' | 'absent';

export interface EnvironmentStatus {
  readonly ollama: OllamaState;
  readonly adzuna: KeyState;
  readonly reed: KeyState;
  /** Each cloud AI provider's key (L-182). */
  readonly ai: Readonly<Record<AiStatusId, KeyState>>;
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
 * Just the two job boards, for the search screen's provider toggles.
 *
 * A strict subset of `readEnvironmentStatus`, and deliberately not a call to
 * it: that one also probes Ollama, and a loopback request every time the search
 * screen opens — for a fact this screen does not draw — is a request nobody
 * asked for.
 *
 * The three credential reads run concurrently and independently, and nothing
 * here rejects. A screen that showed no toggles because one keychain was locked
 * would be worse than one that shows both and says why one cannot be used.
 */
export async function readJobKeyStates(): Promise<Record<'adzuna' | 'reed', KeyState>> {
  const [adzunaAppId, adzunaAppKey, reedApiKey] = await Promise.all([
    secretStatus('adzuna_app_id'),
    secretStatus('adzuna_app_key'),
    secretStatus('reed_api_key'),
  ]);

  return {
    adzuna: combineKeyState([adzunaAppId, adzunaAppKey]),
    reed: combineKeyState([reedApiKey]),
  };
}

/**
 * Read the whole strip in one pass.
 *
 * Every probe runs concurrently and independently: one locked credential must
 * not stop the app finding out that Ollama is running. Nothing here rejects —
 * the caller gets a complete answer or a complete answer, never an exception.
 */
export async function readEnvironmentStatus(now: Date = new Date()): Promise<EnvironmentStatus> {
  const [tags, adzunaAppId, adzunaAppKey, reedApiKey, ...aiAnswers] = await Promise.all([
    probeOllama(),
    secretStatus('adzuna_app_id'),
    secretStatus('adzuna_app_key'),
    secretStatus('reed_api_key'),
    ...AI_STATUS_PROVIDERS.map((provider) => secretStatus(provider.key)),
  ]);

  const ai = { ...NO_AI_KEYS };
  AI_STATUS_PROVIDERS.forEach((provider, index) => {
    ai[provider.id] = combineKeyState([aiAnswers[index] ?? null]);
  });

  return {
    ollama: tags === null ? 'absent' : 'running',
    adzuna: combineKeyState([adzunaAppId, adzunaAppKey]),
    reed: combineKeyState([reedApiKey]),
    ai,
    requestsToday: requestsToday(now),
  };
}
