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
import type { ModelInfo } from '@cviper/ai-providers';

import type { AiKeyProviderId } from '../settings/keys/aiKeyModel';
import { AI_KEY_PROVIDER_IDS } from '../settings/keys/aiKeyProviders';
import { readModelChoices } from './modelChoice';

// Where it has lived since L-183, beside the list it now heads. Re-exported so
// the files that have always imported it from here keep doing so.
export { OPENAI_DEFAULT_MODEL } from './modelChoice';

/** Which family an option belongs to. */
export type ProviderKind =
  | 'keyword'
  | 'ollama'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'mistral'
  | 'grok'
  | 'openrouter'
  // L-150: the service at the address the user typed in Settings.
  | 'custom';

/** The key of the always-available option. */
export const KEYWORD_KEY = 'keyword';

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
  /*
   * L-177: four more clouds. OPTIONAL, and read as "no key" when absent —
   * fail-closed, the same way `readAvailability` treats a store that will not
   * answer. Every screen that builds an `Availability` by hand before the
   * probe returns (the welcome cards, the analysis view's first render) is
   * describing "nothing set up yet", and absence says exactly that.
   * `readAvailability` itself always fills all six.
   */
  readonly googleKey?: boolean;
  readonly mistralKey?: boolean;
  readonly grokKey?: boolean;
  readonly openrouterKey?: boolean;
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

/**
 * The cloud providers Settings can actually set a key up for.
 *
 * ============================================================================
 * THE APP OFFERS ONLY WHAT IT CAN SET UP (L-102) — HISTORICAL: FIXED BY L-149
 * ============================================================================
 * A saved key is not on its own a reason to offer a provider. Anthropic was the
 * case that proved it: `SecretKey::AnthropicApiKey` exists, `secret_set` accepts
 * it, and a credential store SURVIVES AN UNINSTALL — so `readAvailability` could
 * report `anthropicKey: true` on a machine whose Settings screen had never had
 * an Anthropic card. Until L-149 the picker offered it anyway, `runAnalysis`
 * would have sent the user's CV to Anthropic, and the Rust transport told
 * anyone who got there to "Add one in Settings" — a screen that did not exist.
 * L-149 added that card, so both branches below now run under the same rule.
 *
 * So the offer is gated on the SET-UP surface rather than on the credential
 * store. Read from `AI_KEY_PROVIDER_IDS` rather than restated, so a card added
 * later switches its option back on by itself, and
 * `offeredProviders.contract.test.ts` fails the build if the two ever disagree.
 *
 * This gate lives HERE and deliberately not in `readAvailability`. `Availability`
 * is a report of what this machine actually has, and a report that said `false`
 * about a key genuinely sitting in the credential store would be a different
 * claim altogether — "we cannot see it" instead of "we do not offer it". Only
 * one of those is true.
 */
const CLOUD_PROVIDERS_WITH_A_KEY_CARD: ReadonlySet<string> = new Set(AI_KEY_PROVIDER_IDS);

/** Can the user actually get a key for this provider into the app? */
function canBeSetUp(kind: ProviderKind): boolean {
  return CLOUD_PROVIDERS_WITH_A_KEY_CARD.has(kind);
}

/**
 * `models` is which model each cloud runs (L-183). It defaults to what the user
 * chose in Settings, read afresh on every call, so a choice made there reaches
 * the next screen that builds options without anything else being told.
 */
export function providerOptions(
  availability: Availability,
  models: Readonly<Record<AiKeyProviderId, string>> = readModelChoices(),
): ProviderOption[] {
  const options: ProviderOption[] = [KEYWORD_OPTION];

  for (const model of availability.ollamaModels) {
    options.push({
      // The model id is inside the key: two installed models are two options,
      // and switching between them must not be mistaken for the same choice.
      key: `ollama:${model.id}`,
      kind: 'ollama',
      label: `Ollama · ${model.label}`,
      // Scoped to its own subject, so it needs no privacy-promise suppression:
      // "your CV" is what this option keeps local, read against "sent to
      // Anthropic" two entries below. Ollama's base URL is a &'static str
      // pinned to http://127.0.0.1:11434 in src-tauri/src/providers.rs, never
      // built from anything JavaScript sends, with a Rust test holding it there.
      note: 'Private but weaker — your CV stays on your PC.',
      model: model.id,
      local: true,
      needsKey: false,
    });
  }

  // Saved AND settable-up. Both cloud providers have a card as of L-149, so
  // both branches run under the identical rule: the option disappears again
  // the day a card is ever removed from `AI_KEY_PROVIDER_IDS`, rather than
  // being left behind pointing at a screen that is gone.
  if (availability.anthropicKey && canBeSetUp('anthropic')) {
    options.push({
      key: 'anthropic',
      kind: 'anthropic',
      label: `Anthropic · ${models.anthropic}`,
      // Said plainly, every time. This is the only option that sends the user's
      // CV to someone else, and burying that would be the one dishonest line in
      // an app whose whole pitch is that it does not.
      note: 'A full reading. Your CV and the advert are sent to Anthropic.',
      model: models.anthropic,
      local: false,
      needsKey: true,
    });
  }

  // The same rule, applied to the other cloud provider (W1, coordinator
  // review of PR #96: both notes now use the SAME shape — "A full reading…" —
  // rather than one claiming to be "the strongest" and the other merely "a
  // strong" reading, a comparison this file never actually measured).
  if (availability.openaiKey && canBeSetUp('openai')) {
    options.push({
      key: 'openai',
      kind: 'openai',
      label: `OpenAI · ${models.openai}`,
      note: 'A full reading. Your CV and the advert are sent to OpenAI.',
      model: models.openai,
      local: false,
      needsKey: true,
    });
  }

  // L-177: the four chat-completions clouds, under the identical rule and in
  // the order their cards render. Same note shape as the two above — each
  // names who receives the CV, and OpenRouter's names who it passes it on to.
  for (const cloud of MORE_CLOUDS) {
    if (availability[cloud.flag] === true && canBeSetUp(cloud.kind)) {
      options.push({
        key: cloud.kind,
        kind: cloud.kind,
        label: `${cloud.label} · ${models[cloud.kind]}`,
        note: cloud.note,
        model: models[cloud.kind],
        local: false,
        needsKey: true,
      });
    }
  }

  return options;
}

/** One of the clouds L-177 added: which flag gates it, and what it says. */
interface MoreCloud {
  readonly kind: 'google' | 'mistral' | 'grok' | 'openrouter';
  readonly flag: 'googleKey' | 'mistralKey' | 'grokKey' | 'openrouterKey';
  readonly label: string;
  readonly note: string;
}

const MORE_CLOUDS: readonly MoreCloud[] = [
  {
    kind: 'google',
    flag: 'googleKey',
    label: 'Google Gemini',
    note: 'A full reading. Your CV and the advert are sent to Google.',
  },
  {
    kind: 'mistral',
    flag: 'mistralKey',
    label: 'Mistral',
    note: 'A full reading. Your CV and the advert are sent to Mistral.',
  },
  {
    kind: 'grok',
    flag: 'grokKey',
    label: 'xAI Grok',
    note: 'A full reading. Your CV and the advert are sent to xAI.',
  },
  {
    kind: 'openrouter',
    flag: 'openrouterKey',
    label: 'OpenRouter',
    note:
      'A full reading. Your CV and the advert are sent to OpenRouter, which passes them to ' +
      'the company that runs the model.',
  },
];

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
