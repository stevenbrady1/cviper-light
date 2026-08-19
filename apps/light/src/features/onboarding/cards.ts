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
import { SUGGESTED_OLLAMA_MODEL, type Availability } from '../analysis/providers';

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

  const keys = [
    availability.anthropicKey ? 'Anthropic' : null,
    availability.openaiKey ? 'OpenAI' : null,
  ].filter((name): name is string => name !== null);

  if (keys.length > 0) {
    return `Your ${keys.join(' and ')} key is saved, so the full analysis is available.`;
  }

  // The default machine, and the line that has to leave the reader with
  // something they can do right now rather than a shopping list.
  return (
    'No local model and no API key found — the basic word match works with ' +
    'nothing set up, and you can add either later.'
  );
}
