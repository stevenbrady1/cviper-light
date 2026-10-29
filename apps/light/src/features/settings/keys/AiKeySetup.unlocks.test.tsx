// @vitest-environment jsdom
/**
 * L-327 — the AI keys section says everything AI adds, not "one thing".
 *
 * The heading used to say "A key adds one thing: a full reading of your CV
 * against an advert". That was true once. By L-327 the same key (or an AI
 * service on the user's own computer) also drives tailoring, the cover letter,
 * interview preparation, follow-up drafts and Paste a job, so a user deciding
 * whether AI is worth setting up was told about a sixth of it.
 *
 * The list quotes the labels the user meets on the other screens, so a renamed
 * button is a reason to look here too.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeBrowserPort } from '../../../platform/test/fakeBrowserPort';

import { AiKeySetup } from './AiKeySetup';
import { AI_KEY_PROVIDERS, type AiKeyProviderId } from './aiKeyModel';
import { AI_KEY_PROVIDER_IDS } from './aiKeyProviders';
import { createFakeAiKeyPort, type FakeAiKeyPort } from './test/fakeAiKeyPort';

type StoreState = 'none' | 'all saved' | 'unreadable';

function renderSetup(state: StoreState = 'none'): Partial<Record<AiKeyProviderId, FakeAiKeyPort>> {
  const ports: Partial<Record<AiKeyProviderId, FakeAiKeyPort>> = {};
  for (const id of AI_KEY_PROVIDER_IDS) {
    const port = createFakeAiKeyPort(state === 'all saved' ? 'sk-saved' : null);
    if (state === 'unreadable') port.makeUnreadable();
    ports[id] = port;
  }
  render(<AiKeySetup ports={ports} browser={createFakeBrowserPort()} />);
  return ports;
}

/** What the AI section says about itself: its heading and the list under it. */
function introText(): string {
  const section = screen.getByTestId('ai-key-setup');
  const heading = within(section).getByRole('heading', { name: 'AI provider keys' });
  const intro = heading.closest('div')?.parentElement?.textContent ?? '';
  const list = screen.getByTestId('ai-keys-unlocks').textContent ?? '';
  return `${intro} ${list}`;
}

/** The six things, each by the name the app gives it on its own screen. */
const SIX = [
  /full reading of your CV against an advert/i,
  /Tailor my CV/,
  /Write the cover letter/,
  /Prepare for this interview/,
  /Draft a follow-up/,
  /Paste a job/,
] as const;

afterEach(() => {
  cleanup();
});

describe('what AI adds, above the AI cards (L-327)', () => {
  it('lists all six things AI adds, one per line', () => {
    renderSetup();
    const items = within(screen.getByTestId('ai-keys-unlocks')).getAllByRole('listitem');
    expect(items).toHaveLength(SIX.length);
    SIX.forEach((name, index) => {
      expect(items[index]?.textContent ?? '').toMatch(name);
    });
  });

  it('says AI on your own computer counts too, not only a key', () => {
    renderSetup();
    expect(introText()).toMatch(/your own computer/i);
  });

  it('no longer claims a key adds only one thing', () => {
    renderSetup();
    const text = screen.getByTestId('ai-key-setup').textContent ?? '';
    expect(text).not.toMatch(/adds one thing/i);
  });

  it('names no AI company in what it says AI adds', () => {
    renderSetup();
    const text = introText();
    for (const id of AI_KEY_PROVIDER_IDS) {
      expect(text).not.toContain(AI_KEY_PROVIDERS[id].label);
    }
    expect(text).not.toMatch(/ollama|openai|anthropic|gemini|mistral|grok|openrouter/i);
  });

  it.each<[StoreState, string]>([
    ['none', 'missing'],
    ['all saved', 'configured'],
    ['unreadable', 'unreadable'],
  ])('shows the whole list whatever the key store says (%s)', async (state, pillState) => {
    const ports = renderSetup(state);
    for (const id of AI_KEY_PROVIDER_IDS) {
      await waitFor(() => {
        expect(ports[id]?.calls.status ?? 0).toBeGreaterThan(0);
        expect(screen.getByTestId(`ai-key-state-${id}`).dataset['state']).toBe(pillState);
      });
    }
    const items = within(screen.getByTestId('ai-keys-unlocks')).getAllByRole('listitem');
    expect(items).toHaveLength(SIX.length);
  });
});
