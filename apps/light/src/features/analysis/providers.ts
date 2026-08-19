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
