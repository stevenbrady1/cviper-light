/**
 * Which model the AI service at a typed address runs (L-150).
 *
 * The named clouds each have a short curated list (`modelChoice.ts`). This one
 * cannot: the service is whatever the user pointed at — LM Studio, llama.cpp,
 * a company gateway — and only it knows what it serves. So the id is picked
 * from the service's own model list in Settings, or typed, and is checked here
 * only for being something a server could plausibly accept: one token of
 * visible characters, of a sane length.
 *
 * Kept in this app's browser storage, under the prefix "delete everything"
 * sweeps. It is not a secret — the address and the key are, and they live in
 * Rust, bound together.
 */

export const CUSTOM_MODEL_STORAGE_KEY = 'cviper.light.customModel';

/** Real ids run to about sixty characters; this only catches a paste accident. */
export const MAX_CUSTOM_MODEL_CHARS = 200;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The id as it will be sent, or `null` when it is not one.
 *
 * Visible ASCII only, no spaces: ids such as `meta-llama/Llama-3.1-8B` and
 * `llama3.2:latest` pass, and a sentence pasted into the box does not.
 */
export function normaliseCustomModel(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > MAX_CUSTOM_MODEL_CHARS) return null;
  return /^[\x21-\x7e]+$/.test(trimmed) ? trimmed : null;
}

/** The chosen model, or `null` when none is chosen or what is stored is unusable. */
export function readCustomModel(): string | null {
  try {
    const stored = storage()?.getItem(CUSTOM_MODEL_STORAGE_KEY) ?? null;
    return stored === null ? null : normaliseCustomModel(stored);
  } catch {
    return null;
  }
}

/** Remember a model. `false` — and nothing changed — when it is not usable or cannot be kept. */
export function chooseCustomModel(raw: string): boolean {
  const model = normaliseCustomModel(raw);
  const store = storage();
  if (model === null || store === null) return false;
  try {
    store.setItem(CUSTOM_MODEL_STORAGE_KEY, model);
    return true;
  } catch {
    return false;
  }
}

/** Forget the choice — when the service itself is removed. */
export function forgetCustomModel(): void {
  try {
    storage()?.removeItem(CUSTOM_MODEL_STORAGE_KEY);
  } catch {
    // Nothing to do: the next read fails closed to "none chosen" anyway.
  }
}
