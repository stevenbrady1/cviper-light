/**
 * Which model each cloud provider runs (L-183).
 *
 * ============================================================================
 * A SHORT CURATED LIST PER PROVIDER, NOT THE PROVIDER'S WHOLE CATALOGUE
 * ============================================================================
 * `/models` returns everything a key can reach — embedders, image and speech
 * models, previews, dated snapshots — in no useful order and with no field that
 * says which of them can return this app's strict JSON. A picker built from it
 * would offer dozens of ways to get a 400, and would cost a request on every
 * visit to Settings just to draw a dropdown.
 *
 * So each provider has three to five models named here, first of which is the
 * default the app has always used — nothing changes until somebody chooses.
 * The lists favour the providers' own long-lived aliases (`-latest`) where they
 * publish them, because a desktop app may go a year without an update and a
 * dated snapshot is the kind of name that gets retired underneath it.
 *
 * OpenAI's list was GPT-4 only, because every job sends `temperature: 0` — a
 * literal the type system pins, see `ChatJsonRequest` — and OpenAI's reasoning
 * models refuse it. OpenAI shuts every one of those GPT-4 models down on
 * 2027-01-14 (L-248), so the OpenAI adapter no longer sends `temperature` at
 * all (`chat-completions.ts`, `omitsTemperature`) and the list is GPT-6.
 *
 * ============================================================================
 * READ WHERE THE OPTIONS ARE BUILT, SO EVERY FEATURE GETS IT
 * ============================================================================
 * The analysis, tailoring, cover letter, reviewer, pasted-advert extraction,
 * follow-up and interview paths all send `option.model` from the option
 * `providerOptions` built. Reading the choice there — and only there — is what
 * makes it one choice rather than seven.
 *
 * ============================================================================
 * NO VALUE IMPORTS FROM THE ANALYSIS OR SETTINGS SCREENS
 * ============================================================================
 * `providers.ts` imports this file, and `settings/keys/aiKeyModel.ts` imports
 * `providers.ts` at module-evaluation time (see the note in
 * `aiKeyProviders.ts`). Anything here importing a value back from either would
 * close that cycle, so the only imports are the provider package and a TYPE.
 */
import {
  ANTHROPIC_DEFAULT_MODEL,
  GOOGLE_DEFAULT_MODEL,
  GROK_DEFAULT_MODEL,
  MISTRAL_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_MODEL,
} from '@cviper/ai-providers';

// `import type`, never the inline spelling: see `aiKeyProviders.ts` for why the
// difference is a startup crash rather than a style choice.
import type { AiKeyProviderId } from '../settings/keys/aiKeyModel';

/**
 * The OpenAI model used when the user has an OpenAI key and has not chosen
 * another.
 *
 * `gpt-6-luna` since L-248. It was `gpt-4o`, chosen for longevity; OpenAI
 * deprecated gpt-4o, gpt-4o-mini, gpt-4.1 and gpt-4.1-mini on 2026-10-14, shuts
 * them down on 2027-01-14, and names `gpt-6-luna` as the replacement for all
 * four (developers.openai.com/api/docs/deprecations). Its model page lists
 * Chat Completions, structured outputs and 128,000 max output tokens. It lived
 * in `providers.ts` as the only answer until L-183; it is now the fallback, and
 * lives here with the list it heads. `providers.ts` re-exports it for the files
 * that import it from there.
 */
export const OPENAI_DEFAULT_MODEL = 'gpt-6-luna';

export interface ModelChoice {
  /** The exact model string sent to the provider. */
  readonly id: string;
}

/** Every provider's list, default first. */
export const AI_MODEL_CHOICES: Readonly<Record<AiKeyProviderId, readonly ModelChoice[]>> = {
  // Each is on developers.openai.com/api/docs/models with Chat Completions,
  // structured outputs and 128,000 max output tokens, and none has a
  // deprecation notice. A stored GPT-4 choice is off the list, so it reads as
  // the default (L-248).
  openai: [{ id: OPENAI_DEFAULT_MODEL }, { id: 'gpt-6.1-sol' }, { id: 'gpt-6-astra' }],
  anthropic: [
    { id: ANTHROPIC_DEFAULT_MODEL },
    { id: 'claude-opus-5-5' },
    { id: 'claude-sonnet-5-5' },
    { id: 'claude-haiku-4-5' },
  ],
  // The two aliases follow Google's current Flash and Flash-Lite. Flash-Lite
  // does not think by default, so it is also the quick answer to a Flash that
  // thinks for too long.
  google: [
    { id: GOOGLE_DEFAULT_MODEL },
    { id: 'gemini-flash-latest' },
    { id: 'gemini-flash-lite-latest' },
  ],
  mistral: [
    { id: MISTRAL_DEFAULT_MODEL },
    { id: 'mistral-medium-latest' },
    { id: 'mistral-large-latest' },
  ],
  // xAI retired `grok-4` (grok-4-0709) and `grok-4-fast-non-reasoning` on
  // 2026-05-15 and serves them as grok-4.3, at grok-4.3's price. Both
  // replacements are on docs.x.ai/docs/models with structured outputs, and
  // temperature is not among what xAI says reasoning models refuse
  // (presencePenalty, frequencyPenalty, stop).
  grok: [{ id: GROK_DEFAULT_MODEL }, { id: 'grok-4.7' }, { id: 'grok-4.20-non-reasoning' }],
  // OpenRouter passes the request on to the company named before the slash.
  // Each id is on OpenRouter's /models with no expiration_date and with
  // response_format and structured_outputs among its supported_parameters.
  // Every job sends both, and `temperature` too unless the id starts
  // `openai/` (L-248) — those list none. (Anthropic's 4.7 and later list no
  // temperature there either, so Sonnet 4.6 is the newest that fits.)
  openrouter: [
    { id: OPENROUTER_DEFAULT_MODEL },
    { id: 'openai/gpt-6.1-sol' },
    { id: 'anthropic/claude-sonnet-4.6' },
    { id: 'google/gemini-3.8-flash' },
  ],
};

/**
 * Where the choices are kept: one JSON object, `{ google: "…", … }`.
 *
 * `localStorage` for the reason `settings/updates/launchCheck.ts` gives: a
 * preference that means nothing on another machine does not belong in SQLite
 * or the backup file. The `cviper.light.` prefix is what "Delete everything"
 * removes — `erase/localStorageKeys.contract.test.ts` holds every store to it.
 */
export const MODEL_CHOICE_STORAGE_KEY = 'cviper.light.aiModels';

/** The model a provider runs when nothing (valid) has been chosen. */
export function defaultModelFor(provider: AiKeyProviderId): string {
  // Every list is non-empty and starts with its default; the test pins both.
  return AI_MODEL_CHOICES[provider][0]?.id ?? '';
}

function isOnList(provider: AiKeyProviderId, model: string): boolean {
  return AI_MODEL_CHOICES[provider].some((choice) => choice.id === model);
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Some embedders throw on the property access itself when storage is off.
    return null;
  }
}

/** What is stored, as an object, or `{}` for anything else. */
function readStored(): Record<string, unknown> {
  try {
    const raw = storage()?.getItem(MODEL_CHOICE_STORAGE_KEY) ?? null;
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // Unreadable storage, or text that is not JSON: the defaults. A broken
    // preference must never stop an analysis from running.
    return {};
  }
}

/**
 * The model this provider runs.
 *
 * A stored value that is no longer on the list — a model a later version
 * dropped, or a hand-edited store — is ignored for the default rather than
 * sent, so the list is the only thing that can ever reach a provider.
 */
export function chosenModel(provider: AiKeyProviderId): string {
  const stored = readStored()[provider];
  return typeof stored === 'string' && isOnList(provider, stored)
    ? stored
    : defaultModelFor(provider);
}

/** Every provider's model at once — what `providerOptions` reads. */
export function readModelChoices(): Record<AiKeyProviderId, string> {
  const stored = readStored();
  const out = {} as Record<AiKeyProviderId, string>;
  for (const provider of Object.keys(AI_MODEL_CHOICES) as AiKeyProviderId[]) {
    const value = stored[provider];
    out[provider] =
      typeof value === 'string' && isOnList(provider, value) ? value : defaultModelFor(provider);
  }
  return out;
}

/**
 * Record a choice. `false`, and nothing written, for a model not on this
 * provider's list — the Settings select cannot produce one, so it means a bug.
 */
export function chooseModel(provider: AiKeyProviderId, model: string): boolean {
  if (!isOnList(provider, model)) return false;

  const store = storage();
  if (store === null) return false;
  try {
    store.setItem(MODEL_CHOICE_STORAGE_KEY, JSON.stringify({ ...readStored(), [provider]: model }));
    return true;
  } catch {
    // Quota or a storage that refuses writes: the choice is not kept, and the
    // caller is told so rather than showing a selection that will not stick.
    return false;
  }
}
