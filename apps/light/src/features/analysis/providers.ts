/**
 * The ways an analysis can be run, and which of them this machine can offer.
 *
 * ============================================================================
 * THE BASIC MATCH IS ALWAYS IN THE LIST. THAT IS THE PRODUCT PROMISE.
 * ============================================================================
 * CViper Light claims to be useful before you have configured anything, and the
 * analysis screen is where that claim is either true or a lie. Every other
 * option here depends on the user having done something first — downloaded a
 * multi-gigabyte model, pasted an API key — and most people will never do
 * either. `scoreByKeywords` needs nothing at all, so it is offered
 * unconditionally, and `providers.test.ts` asserts that across every
 * combination of what is and is not set up.
 *
 * ============================================================================
 * WHAT IS SHOWN, AND WHAT IS HIDDEN
 * ============================================================================
 * An option the user cannot use is ABSENT, not greyed out. A permanently
 * disabled "Ollama (not installed)" row is a small advertisement for software
 * they have never heard of, shown on every single launch, and it makes the
 * picker look broken rather than simple. The one thing worth saying about a
 * missing provider belongs in Settings, once, where somebody has gone looking.
 *
 * The reverse rule applies to the RUN BUTTON, which is always visible and
 * always explains itself — see `model.ts`. A control the user is looking for
 * must not move; a control they have no use for should not exist.
 */
import { ANTHROPIC_DEFAULT_MODEL, type ModelInfo } from '@cviper/ai-providers';

/** Which family an option belongs to. */
export type ProviderKind = 'keyword' | 'ollama' | 'anthropic' | 'openai';

/** The key of the always-available option. */
export const KEYWORD_KEY = 'keyword';

/**
 * The OpenAI model used when the user has an OpenAI key.
 *
 * ============================================================================
 * A FIXED DEFAULT, NOT A CHOICE, AND DELIBERATELY A CONSERVATIVE ONE.
 * ============================================================================
 * Ollama publishes exactly which models are installed, so its options are real.
 * OpenAI's `/v1/models` returns everything the key can reach in no useful
 * order, with no capability field and no indication of which is any good at
 * this task — picking "the first one" would be arbitrary, and it would cost a
 * metered request on every visit to this screen just to build a dropdown.
 *
 * So one model is named here. `gpt-4o` is chosen for longevity rather than
 * ambition: it has been generally available and stable for a long time, which
 * is the property that matters for a desktop app a user may not update for a
 * year. A per-provider model picker is future work, and when it arrives this
 * constant becomes the fallback rather than the answer.
 */
export const OPENAI_DEFAULT_MODEL = 'gpt-4o';

export interface ProviderOption {
  /** Unique, and what the picker's `<option value>` carries. */
  readonly key: string;
  readonly kind: ProviderKind;
  /** The picker's own text. Names the provider and, where it varies, the model. */
  readonly label: string;
  /** One line under it: what this choice costs and what it gives up. */
  readonly note: string;
  /** The exact model string to send. `null` for the keyword scanner. */
  readonly model: string | null;
  /** True when running this option sends nothing off the machine. */
  readonly local: boolean;
  /** True when this option only exists because a key is saved. */
  readonly needsKey: boolean;
}

/** What this machine actually has. */
export interface Availability {
  /**
   * Did anything answer on Ollama's port?
   *
   * Separate from the list below because the two empty cases are different
   * people. No daemon is the default state of almost every machine and needs no
   * comment. A daemon with nothing chat-capable in it is somebody who installed
   * Ollama, pulled an embedder, and is now looking at a picker that appears
   * broken — see `ollamaHint`.
   */
  readonly ollamaRunning: boolean;
  /** Chat-capable models Ollama reported. Empty means "not usable". */
  readonly ollamaModels: readonly ModelInfo[];
  readonly anthropicKey: boolean;
  readonly openaiKey: boolean;
}

/**
 * The basic match.
 *
 * The note says what it DOES rather than what it lacks. "No AI" would be
 * accurate and would also make the one thing that always works sound like a
 * degraded mode, which is the wrong first impression for the feature most
 * people will use most of the time.
 */
const KEYWORD_OPTION: ProviderOption = {
  key: KEYWORD_KEY,
  kind: 'keyword',
  label: 'Basic match — no key needed',
  note:
    'Compares the words on your CV with the words in the advert. Instant, free, ' +
    'and works with nothing set up.',
  model: null,
  local: true,
  needsKey: false,
};

export function providerOptions(availability: Availability): ProviderOption[] {
  const options: ProviderOption[] = [KEYWORD_OPTION];

  for (const model of availability.ollamaModels) {
    options.push({
      // The model id is inside the key: two installed models are two options,
      // and switching between them must not be mistaken for the same choice.
      key: `ollama:${model.id}`,
      kind: 'ollama',
      label: `Ollama · ${model.label}`,
      // cviper-allow-absolute-privacy-claim: a per-option note, read against
      // "sent to Anthropic" two entries below, so its subject is this choice
      // and not the app. Ollama's base URL is a &'static str pinned to
      // http://127.0.0.1:11434 in src-tauri/src/providers.rs, never built from
      // anything JavaScript sends, with a Rust test holding it there.
      note: 'Private but weaker — nothing leaves your PC.',
      model: model.id,
      local: true,
      needsKey: false,
    });
  }

  if (availability.anthropicKey) {
    options.push({
      key: 'anthropic',
      kind: 'anthropic',
      label: `Anthropic · ${ANTHROPIC_DEFAULT_MODEL}`,
      // Said plainly, every time. This is the only option that sends the user's
      // CV to someone else, and burying that would be the one dishonest line in
      // an app whose whole pitch is that it does not.
      note: 'The strongest reading. Your CV and the advert are sent to Anthropic.',
      model: ANTHROPIC_DEFAULT_MODEL,
      local: false,
      needsKey: true,
    });
  }

  if (availability.openaiKey) {
    options.push({
      key: 'openai',
      kind: 'openai',
      label: `OpenAI · ${OPENAI_DEFAULT_MODEL}`,
      note: 'A strong reading. Your CV and the advert are sent to OpenAI.',
      model: OPENAI_DEFAULT_MODEL,
      local: false,
      needsKey: true,
    });
  }

  return options;
}

/**
 * What the picker starts on.
 *
 * ============================================================================
 * THE BEST AVAILABLE OPTION, NOT ALWAYS THE BASIC ONE.
 * ============================================================================
 * On a machine with nothing set up this is the keyword match, which is the
 * whole point of the promise. But a user who has installed a local model or
 * saved a key has already told us which analysis they want, and starting them
 * on the basic match would answer with a word count and a label saying "add an
 * AI key for a full analysis" — advice they have already taken.
 *
 * Local before cloud: it is free, it is private, and it does not spend the
 * user's money without them choosing to.
 */
export function defaultOptionKey(options: readonly ProviderOption[]): string {
  const preferred = options.find((option) => option.kind !== 'keyword');
  return preferred?.key ?? KEYWORD_KEY;
}

/**
 * The option with this key, or `null`.
 *
 * `null` is a real answer, not a miss to paper over: Ollama can be running when
 * the view loads and stopped by the time the user presses Run. Falling back to
 * a different provider would run an analysis nobody asked for — possibly a paid
 * one — so the caller is made to handle it.
 */
export function optionByKey(
  options: readonly ProviderOption[],
  key: string,
): ProviderOption | null {
  return options.find((option) => option.key === key) ?? null;
}

/**
 * The model most people should pull first, named in the hint below.
 *
 * `llama3.2` rather than anything larger: it is ~2 GB, it runs on a laptop with
 * no discrete GPU, and it is good enough at this task. Naming a model the
 * user's machine cannot run would turn one dead end into a slower one.
 */
export const SUGGESTED_OLLAMA_MODEL = 'llama3.2';

/**
 * What to say about Ollama under the picker, or `null` for nothing.
 *
 * ============================================================================
 * EXACTLY ONE STATE EARNS A SENTENCE.
 * ============================================================================
 * `providerOptions` hides options the user cannot use, and the reasoning at the
 * top of this file holds: a permanent "Ollama (not installed)" row is an advert
 * for software they have never heard of, shown on every launch.
 *
 * But "running, and every model in it is an embedder" is not that state. That
 * user has already installed Ollama — they took the advice — and the app is
 * still showing them nothing. Saying "no chat models found" without naming the
 * command is a dead end, and this app has no support inbox to absorb dead ends.
 * So the one state where the user is a single command from success is the one
 * state that gets a sentence, and the sentence contains the command.
 */
export function ollamaHint(availability: Availability): string | null {
  if (!availability.ollamaRunning) return null;
  if (availability.ollamaModels.length > 0) return null;

  return (
    'Ollama is running, but none of the models installed can hold a ' +
    `conversation — an embedding model cannot. Run \`ollama pull ${SUGGESTED_OLLAMA_MODEL}\` ` +
    'in a terminal, then reopen this screen.'
  );
}
