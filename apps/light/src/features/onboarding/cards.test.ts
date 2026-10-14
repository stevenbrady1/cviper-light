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
 * The refresh states it as a status pill ("Ready now") plus a body that says
 * what a key adds — and every card can say "Ready now" only because all three
 * genuinely work with nothing configured. The tests below hold that.
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

  it('gives every card its own title, hook and body', () => {
    // Re-pinned for the welcome refresh: the long `requirement` sentence became
    // a short hook plus a status pill. Three identical hooks would be three
    // cards saying nothing, so they must still differ.
    for (const card of ONBOARDING_CARDS) {
      expect(card.title.length, card.id).toBeGreaterThan(3);
      expect(card.hook.length, card.id).toBeGreaterThan(10);
      expect(card.body.length, card.id).toBeGreaterThan(20);
    }
    expect(new Set(ONBOARDING_CARDS.map((card) => card.hook)).size).toBe(3);
  });

  it('says every card is ready now — because every one of them works with nothing set up', () => {
    // The tracker is offline, the CV check has a keyword match that needs no
    // account, and search has keyless browser links. "Ready now" is only
    // honest because all three are true; the bodies say what a key adds.
    for (const card of ONBOARDING_CARDS) expect(card.status, card.id).toBe('Ready now');
  });

  it('says on the search card that free keys add more, rather than hiding that keys exist', () => {
    const search = ONBOARDING_CARDS.find((card) => card.id === 'search');

    expect(search?.body.toLowerCase()).toContain('free keys');
    expect(search?.body.toLowerCase()).toContain('more results');
  });

  it('negative: no card says a key is required', () => {
    for (const card of ONBOARDING_CARDS) {
      const copy = `${card.hook} ${card.body}`.toLowerCase();
      expect(copy, card.id).not.toMatch(/\b(requires?|needs?) (an? )?(api )?key/);
    }
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
    // THE CARD MUST NOT PROMISE A ROW THE PICKER WILL NOT SHOW (L-102 / L-149)
    // ========================================================================
    // Before L-149 this asserted the opposite for Anthropic: the analysis
    // screen had no Anthropic option and no way to set one up, so a line
    // naming it would have sent a new user to a picker that did not contain
    // what they had just been told was there.
    //
    // The line is derived from `providerOptions`, so it can never say this
    // about a provider that is not offered — and now that Anthropic has a key
    // card, it is offered, so the line says so exactly as it does for OpenAI.
    expect(localModelLine({ ...NOTHING, openaiKey: true })).toContain('OpenAI');
    expect(localModelLine({ ...NOTHING, anthropicKey: true })).toContain('Anthropic');
  });

  it('names both, joined, and pluralises correctly, when both keys are saved', () => {
    // The `keys.join(' and ')` branch, only reachable with two cloud
    // providers configured at once — untested until L-149 gave Anthropic a
    // card, since OpenAI was the only one `providerOptions` could ever offer.
    // W4 (coordinator review of PR #96): "Your Anthropic and OpenAI key is
    // saved" was ungrammatical for exactly this state — asserted here as the
    // whole sentence, not a substring, so a regression back to the singular
    // cannot pass by only checking that both names appear somewhere in it.
    const line = localModelLine({ ...NOTHING, anthropicKey: true, openaiKey: true });
    expect(line).toBe(
      'Your Anthropic and OpenAI keys are saved, so the full analysis is available.',
    );
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
