// @vitest-environment jsdom
/**
 * The welcome screen keeps the landing page's promise about a key, generically
 * (L-90, re-pinned for C1 — coordinator review of PR #96 — and again for the
 * welcome refresh).
 *
 * ============================================================================
 * THE PROMISE THIS FILE HOLDS THE SCREEN TO
 * ============================================================================
 * cviper.ai says the welcome screen links to where you get a key and shows
 * what a typical CV costs. Before L-90 the analysis card said a key "makes it
 * much better" and stopped there — a dead end.
 *
 * ============================================================================
 * THE WELCOME REFRESH: ONE LINK, AND THE COST MOVED WITH IT
 * ============================================================================
 * The approved redesign gives the CV card one small link — "Want sharper AI?
 * Add a key →" — in place of the two ("Choose a provider and get a key →",
 * "Paste a key in Settings →"), which both went to the same place anyway. The
 * cost sentence moved to that place: the top of Settings → AI provider keys,
 * where the key is actually pasted. `AiKeySetup.cost.test.tsx` now holds every
 * assertion about the cost line that used to live here, unweakened.
 *
 * What stays here: the link exists, it is on the CV card, it routes into the
 * app (never out to a browser), it names no provider, and none of it makes the
 * free story look gated.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Availability } from '../analysis/providers';

import { Welcome } from './Welcome';

/** The default machine: no local model, no key, nothing configured. */
const NOTHING: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: false,
};

function renderWelcome(onDismiss: (view: unknown) => void = () => undefined) {
  const user = userEvent.setup();
  render(<Welcome onDismiss={onDismiss as never} detect={() => Promise.resolve(NOTHING)} />);
  return { user };
}

describe('where do I get a key', () => {
  it('routes to Settings → AI provider keys, where the provider is chosen and the cost is shown', async () => {
    const onDismiss = vi.fn();
    const { user } = renderWelcome(onDismiss);

    await user.click(await screen.findByTestId('welcome-key-link'));

    expect(onDismiss).toHaveBeenCalledWith('settings');
  });

  it('says "Add a key", never names a provider', async () => {
    renderWelcome();

    const control = await screen.findByTestId('welcome-key-link');
    expect(control.textContent).toContain('Want sharper AI? Add a key');
    for (const brand of ['OpenAI', 'Anthropic']) {
      expect(control.textContent, brand).not.toContain(brand);
    }
  });

  it('negative: renders no link out to any site — the whole screen stays in the app', async () => {
    renderWelcome();

    await screen.findByTestId('welcome-key-link');
    // A bare `<a href>` inside a Tauri window navigates the app itself, which
    // would replace the application with whatever site it pointed at.
    expect(document.querySelector('a[href^="http"]')).toBeNull();
  });

  it('puts the link on the CV card, where the key is what it is for', async () => {
    renderWelcome();

    const card = await screen.findByTestId('welcome-card-analysis');
    expect(card.querySelector('[data-testid="welcome-key-link"]')).toBeTruthy();
  });

  it('is a link, not a second blue button', async () => {
    renderWelcome();

    const control = await screen.findByTestId('welcome-key-link');
    expect(control.getAttribute('data-primary')).toBeNull();
    expect(control.className).not.toContain('bg-blue');
  });
});

describe('the free story survives all of it', () => {
  it('negative: with no key and no local model, the CV card is still usable', async () => {
    const onDismiss = vi.fn();
    const { user } = renderWelcome(onDismiss);

    const action = await screen.findByTestId('welcome-action-analysis');
    expect(action).toHaveProperty('disabled', false);

    await user.click(action);
    expect(onDismiss).toHaveBeenCalledWith('analysis');
  });

  it('boundary: the cards that need nothing gain neither a price nor a key link', async () => {
    renderWelcome();

    for (const id of ['tracker', 'search']) {
      const card = await screen.findByTestId(`welcome-card-${id}`);
      expect(card.querySelector('[data-testid="welcome-key-link"]'), id).toBeNull();
      expect(card.textContent ?? '', id).not.toMatch(/pence|£/);
    }
  });

  it('boundary: the screen still says the basic match works with nothing set up', async () => {
    renderWelcome();

    const local = (
      (await screen.findByTestId('welcome-local-model')).textContent ?? ''
    ).toLowerCase();
    expect(local).toContain('works with nothing');
  });
});

afterEach(() => {
  cleanup();
});
