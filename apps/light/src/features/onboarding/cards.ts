/**
 * The three things this app does, and what each one actually needs.
 *
 * ============================================================================
 * THE REQUIREMENT IS A FIELD, NOT A SENTENCE SOMEBODY REMEMBERED TO WRITE.
 * ============================================================================
 * A welcome screen showing three equal-looking features, two of which turn out
 * to need an API key, is worse than no welcome screen at all: the user tries
 * whichever caught their eye, hits a wall, and concludes the app is broken
 * rather than unconfigured.
 *
 * So every card carries its cost up front, in its own field, and
 * `cards.test.ts` asserts all three are populated and distinct.
 *
 * ============================================================================
 * THE TRACKER GOES FIRST, WHICH IS NOT THE RAIL'S ORDER.
 * ============================================================================
 * The rail runs Search → Tracker → Analysis, because that is the order a job
 * hunt happens in. A first impression is a different question: the first thing
 * a new user should meet is the feature that works before they have configured
 * anything. Leading with job search would lead with "you need two API keys".
 */
import { providerLabel } from '../analysis/model';
import { SUGGESTED_OLLAMA_MODEL, providerOptions, type Availability } from '../analysis/providers';

import { type ViewId } from '../../app/views';

export interface OnboardingCard {
  readonly id: 'tracker' | 'analysis' | 'search';
  readonly title: string;
  /** What this costs the user before it works. Stated, never implied. */
  readonly requirement: string;
  readonly body: string;
  /** Where the card's button goes. Every card has one. */
  readonly view: ViewId;
  readonly actionLabel: string;
}

export const ONBOARDING_CARDS: readonly OnboardingCard[] = [
  {
    id: 'tracker',
    title: 'Track applications',
    // Unconditionally true, on every machine, with nothing installed. It is the
    // only one of the three that can say this, so it says it first.
    requirement: 'Works now, no setup.',
    body:
      'A board of everything you have applied for, with a mark down the side of ' +
      'each card showing how long it has sat still. The thing a job hunt loses ' +
      'track of is age, and age is what tells you who to chase.',
    view: 'tracker',
    actionLabel: 'Open the tracker',
  },
  {
    id: 'analysis',
    title: 'Analyse your CV',
    requirement:
      'Needs nothing to start; a free local model or your own API key makes it much better.',
    body:
      'Paste a job advert next to your CV and see which of its words you already ' +
      'use and which you are missing. The basic match is a word comparison and ' +
      'runs instantly. A model reads it properly and explains itself.',
    view: 'analysis',
    actionLabel: 'Check a CV',
  },
  {
    id: 'search',
    title: 'Search jobs',
    requirement: 'Needs free Adzuna/Reed keys — or use the browser links, no key needed.',
    body:
      'Search two UK job boards from inside the app and save what is worth ' +
      'chasing straight onto the board. Without keys, the same search opens in ' +
      'your own browser in one click.',
    view: 'search',
    actionLabel: 'Find jobs',
  },
];

/**
 * What one AI-read analysis costs, and who is paid for it.
 *
 * ============================================================================
 * A FIGURE, NOT A SHRUG — AND, SINCE L-148, NOT TIED TO ONE PROVIDER'S RATES
 * ============================================================================
 * "Bring your own key" is only an honest offer if the user can find out what
 * the key will cost them BEFORE they go and get one. This app's OWN landing
 * page at cviper.ai — not the hosted CViper, which was mothballed in September
 * 2026 and whose site cviper.ai replaced — promises that this screen "shows
 * what a typical CV costs", and a card that said only "you pay your provider"
 * with no figure at all would send somebody off to read a pricing page to work
 * out an answer we already know roughly.
 *
 * ============================================================================
 * WHY THIS NO LONGER NAMES A PROVIDER OR A BAND (L-148)
 * ============================================================================
 * The line used to be derived from one specific model's published per-token
 * rate (`OPENAI_DEFAULT_MODEL`, at the time `gpt-4o`) and said "about 2–3p,
 * paid straight to OpenAI". That was an honest number for the one provider a
 * user could actually choose — but the owner's decision on L-148 is that the
 * product must not read as tied to one AI provider, and a precise band derived
 * from one provider's rate card is exactly that: correct for OpenAI, silent
 * about Anthropic (whose card shipped in L-149, at different published rates),
 * and one repricing away from being quietly wrong for the provider it names.
 *
 * "A few pence" is the looser, provider-agnostic shape of the same fact — both
 * shipped providers land in that range for one CV-and-advert exchange — and it
 * still agrees with the landing page's own "a few pence, about 2–3p for a CV
 * check" without repeating the precise band that only ever described one of
 * them. The per-provider cost REMAINS on each key card (`aiKeyModel.ts`'s
 * `billing` field), where naming a provider and its rate is exactly what that
 * card is for.
 *
 * "Prices can change" survives for the same reason it always existed: this is
 * still an estimate of someone else's price list, not a live meter.
 */
export const AI_COST_LINE =
  'A typical CV check costs a few pence, paid to the AI provider you choose on your own ' +
  'account. A model running on your own PC is free. CViper takes no cut, and prices can change.';

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
      `Run \`ollama pull ${SUGGESTED_OLLAMA_MODEL}\` to get one.`
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
