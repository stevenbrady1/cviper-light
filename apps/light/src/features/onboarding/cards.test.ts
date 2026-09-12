/**
 * The three cards a first-time user meets, and the honesty rule they follow.
 *
 * ============================================================================
 * EVERY CARD STATES WHAT IT NEEDS, INCLUDING THE ONE THAT NEEDS NOTHING.
 * ============================================================================
 * A welcome screen that shows three equal-looking features, two of which turn
 * out to need an API key, is worse than no welcome screen: the user tries the
 * one that catches their eye, hits a wall, and concludes the app is broken
 * rather than unconfigured.
 *
 * So the requirement is a FIELD, not a sentence somebody remembered to write,
 * and the tests below assert it is populated and specific for all three.
 */
import { describe, expect, it } from 'vitest';

import { type Availability } from '../analysis/providers';

import { ONBOARDING_CARDS, localModelLine } from './cards';

const NOTHING: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: false,
};

describe('the cards', () => {
  it('is exactly three, in the order the app is used', () => {
    expect(ONBOARDING_CARDS.map((card) => card.id)).toEqual(['tracker', 'analysis', 'search']);
  });

  it('puts the one that needs nothing first', () => {
    // Deliberate, and the opposite of the rail's order. The first impression a
    // zero-setup product should make is a feature that works before anything
    // has been configured — not the one that needs two API keys.
    expect(ONBOARDING_CARDS[0]?.requirement).toBe('Works now, no setup.');
  });

  it('gives every card a requirement of its own', () => {
    const requirements = ONBOARDING_CARDS.map((card) => card.requirement);

    for (const requirement of requirements) expect(requirement.length).toBeGreaterThan(10);
    // Three identical reassurances would be three cards saying nothing.
    expect(new Set(requirements).size).toBe(3);
  });

  it('says the analysis card needs nothing to start but is better with a model', () => {
    const analysis = ONBOARDING_CARDS.find((card) => card.id === 'analysis');

    expect(analysis?.requirement).toContain('Needs nothing to start');
    expect(analysis?.requirement.toLowerCase()).toContain('much better');
  });

  it('says the search card needs keys AND names the keyless way round it', () => {
    const search = ONBOARDING_CARDS.find((card) => card.id === 'search');

    expect(search?.requirement).toContain('Adzuna');
    expect(search?.requirement).toContain('Reed');
    expect(search?.requirement.toLowerCase()).toContain('no key needed');
  });

  it('gives every card somewhere to go, so none of them is a poster', () => {
    for (const card of ONBOARDING_CARDS) {
      expect(card.actionLabel.length).toBeGreaterThan(3);
      expect(['search', 'tracker', 'analysis']).toContain(card.view);
    }
  });
});

describe('localModelLine — the live detection shown on the analysis card', () => {
  it('names the model when Ollama is running with one installed', () => {
    const line = localModelLine({
      ...NOTHING,
      ollamaRunning: true,
      ollamaModels: [{ id: 'llama3.2:3b', label: 'llama3.2:3b (3.2B)' }],
    });

    expect(line).toContain('llama3.2:3b');
    expect(line.toLowerCase()).toContain('found');
  });

  it('names the command when Ollama is running with nothing that can chat', () => {
    const line = localModelLine({ ...NOTHING, ollamaRunning: true });
    expect(line).toContain('ollama pull llama3.2');
  });

  it('says the basic match still works when nothing at all is installed', () => {
    // The default machine. This line has to leave the reader with something
    // they can do RIGHT NOW, not a shopping list.
    const line = localModelLine(NOTHING).toLowerCase();

    expect(line).toContain('word match');
    expect(line).toContain('works with nothing');
  });

  it('mentions a saved cloud key only when that key can actually be used', () => {
    // ========================================================================
    // THE CARD MUST NOT PROMISE A ROW THE PICKER WILL NOT SHOW (L-102)
    // ========================================================================
    // This used to assert that a saved Anthropic key put "Anthropic" in the
    // line — "Your Anthropic key is saved, so the full analysis is available."
    // The analysis screen has no Anthropic option and no way to set one up, so
    // that sentence sent a new user to a picker that did not contain what they
    // had just been told was there.
    //
    // The line is now derived from `providerOptions`, so it cannot say this
    // about a provider that is not offered — and it still says it for the one
    // that is.
    expect(localModelLine({ ...NOTHING, openaiKey: true })).toContain('OpenAI');

    expect(localModelLine({ ...NOTHING, anthropicKey: true })).not.toContain('Anthropic');
    // The machine reads exactly like one with nothing saved, which is the state
    // it is actually in as far as running an analysis goes.
    expect(localModelLine({ ...NOTHING, anthropicKey: true })).toBe(localModelLine(NOTHING));
  });

  it('boundary: a machine with everything reports the local model, not the key', () => {
    // Local before cloud, the same preference `defaultOptionKey` applies: it is
    // free, private, and does not spend the user's money.
    const line = localModelLine({
      ollamaRunning: true,
      ollamaModels: [{ id: 'llama3.2:3b', label: 'llama3.2:3b (3.2B)' }],
      anthropicKey: true,
      openaiKey: true,
    });

    expect(line).toContain('llama3.2:3b');
  });
});
