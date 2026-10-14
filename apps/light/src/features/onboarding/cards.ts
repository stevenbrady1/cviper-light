/**
 * The three things this app does, and whether each one works yet.
 *
 * ============================================================================
 * EVERY CARD SAYS WHETHER IT WORKS NOW — AND ALL THREE DO.
 * ============================================================================
 * A welcome screen showing three equal-looking features, two of which turn out
 * to need an API key, is worse than no welcome screen at all: the user tries
 * whichever caught their eye, hits a wall, and concludes the app is broken
 * rather than unconfigured.
 *
 * The first version of this screen answered that with a `requirement` sentence
 * per card. The refresh (the approved "Your job hunt, organised." mockup) says
 * it shorter: a "Ready now" pill — honest for all three, because the tracker is
 * offline, the CV check has a keyword match that needs no account, and search
 * has keyless browser links — plus a body that says what a free key adds. The
 * CV card's pill also reports the live Ollama detection (see `Welcome.tsx`).
 * `cards.test.ts` holds both halves.
 *
 * ============================================================================
 * THE TRACKER GOES FIRST, WHICH IS NOT THE RAIL'S ORDER.
 * ============================================================================
 * The rail runs Search → Tracker → Analysis, because that is the order a job
 * hunt happens in. A first impression is a different question. The CV check
 * sits in the middle and carries the screen's one primary button and its
 * "Start here" marker: it is the quickest way to get something useful back.
 */
import { providerLabel } from '../analysis/model';
import { providerOptions, type Availability } from '../analysis/providers';

import { type ViewId } from '../../app/views';

export interface OnboardingCard {
  readonly id: 'tracker' | 'analysis' | 'search';
  readonly title: string;
  /** One line under the title, in muted ink: why you would open it. */
  readonly hook: string;
  /** The pill. Stated, never implied — see the docblock above. */
  readonly status: 'Ready now';
  /** One sentence: what it does, and — where it applies — what a key adds. */
  readonly body: string;
  /** Where the card's button goes. Every card has one. */
  readonly view: ViewId;
  readonly actionLabel: string;
}

export const ONBOARDING_CARDS: readonly OnboardingCard[] = [
  {
    id: 'tracker',
    title: 'Track applications',
    hook: 'See who to chase next.',
    status: 'Ready now',
    body: 'Every job you applied for on one board. Old ones stand out.',
    view: 'tracker',
    actionLabel: 'Open my board',
  },
  {
    id: 'analysis',
    title: 'Check your CV',
    hook: "Find the words you're missing.",
    status: 'Ready now',
    body: "Paste a job advert. See which key words your CV has and which it doesn't.",
    view: 'analysis',
    actionLabel: 'Check my CV',
  },
  {
    id: 'search',
    title: 'Find jobs',
    hook: 'Search UK jobs in one place.',
    status: 'Ready now',
    body: 'Save the good ones straight to your board. Free keys add more results.',
    view: 'search',
    actionLabel: 'Find jobs',
  },
];

/**
 * What a user should know about paying for AI before adding a key — with no
 * figure in it (L-249).
 *
 * It used to say "A typical CV check costs a few pence". CViper cannot know
 * that: prices are each provider's, they change, they differ by model, and a
 * long CV costs more than a short one. An estimate is a promise somebody else
 * keeps. So this says only what is TRUE: what the AI is for, who bills whom
 * (the provider, the user's own account, at its published rates), that a model
 * on the user's own PC is free, that CViper takes no cut, and that prices can
 * change. `no-cost-estimates.contract.test.ts` fails the build if an amount or
 * "pence" comes back into any copy.
 *
 * No provider is named (L-148): each key card says who bills, in `aiKeyModel.ts`.
 *
 * WHERE IT IS SHOWN: at the top of Settings → AI provider keys (`AiKeySetup`),
 * where the welcome's "Add a key →" link lands, before the first key box.
 * `AiKeySetup.cost.test.tsx` pins it there.
 */
export const AI_COST_LINE =
  'Some features use AI to help generate results. When you use the AI provider you choose, it ' +
  'bills your own account at its published rates, and prices can change. A model running on ' +
  'your own PC is free. CViper takes no cut.';

/**
 * What this machine can do for a CV check, in one line, read live.
 *
 * ============================================================================
 * DETECTION, ON THE CARD, RATHER THAN A CLAIM ABOUT DETECTION.
 * ============================================================================
 * "Install Ollama for a better analysis" is a leaflet. "llama3.2:3b found on
 * this machine" is an answer, and it is the difference between a user who
 * wonders whether the app noticed and a user who knows it did.
 *
 * The order matters and matches `defaultOptionKey`: a local model before a
 * cloud key, because it is free, private, and does not spend the user's money.
 */
export function localModelLine(availability: Availability): string {
  const [first] = availability.ollamaModels;
  if (first !== undefined) {
    return `Ollama found on this machine, running ${first.id}. Nothing you check will leave your PC.`;
  }

  if (availability.ollamaRunning) {
    return (
      'Ollama is running, but none of its models can hold a conversation. ' +
      'Open the Ollama app and add a chat model in it.'
    );
  }

  // Derived from the options the picker will ACTUALLY show, not from the raw
  // availability flags (L-102). "The full analysis is available" has to be true
  // of the screen the user is about to open, and a key the app has no card for
  // is never offered there — so reading `availability.anthropicKey` directly
  // would make this card promise a row that does not exist. One rule, in
  // `providerOptions`, and this sentence follows it by construction.
  const keys = providerOptions(availability)
    .filter((option) => option.needsKey)
    .map((option) => providerLabel(option.kind));

  if (keys.length > 0) {
    // W4 (coordinator review of PR #96): "Your Anthropic and OpenAI key is
    // saved" was ungrammatical the moment two cloud keys could be saved at
    // once (L-149 made that a real, reachable state) — singular "key ... is"
    // was only ever true for one.
    const noun = keys.length > 1 ? 'keys are' : 'key is';
    return `Your ${keys.join(' and ')} ${noun} saved, so the full analysis is available.`;
  }

  // The default machine, and the line that has to leave the reader with
  // something they can do right now rather than a shopping list.
  return (
    'No local model and no API key found — the basic word match works with ' +
    'nothing set up, and you can add either later.'
  );
}
