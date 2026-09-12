// @vitest-environment jsdom
/**
 * The welcome screen keeps the landing page's promise about the OpenAI key
 * (L-90).
 *
 * ============================================================================
 * THE PROMISE THIS FILE HOLDS THE SCREEN TO
 * ============================================================================
 * cviper.ai says, of this exact screen:
 *
 *     "It opens straight into a short welcome… The welcome screen links to
 *      where you get one and shows what a typical CV costs."
 *
 * Before L-90 the analysis card said a key "makes it much better" and stopped
 * there. A user who read that and wanted the better answer had nowhere to go
 * and no idea what it would cost — which is the same dead end the card's
 * `requirement` field exists to prevent, one level down.
 *
 * So two facts are asserted here, because they are the two halves of the
 * sentence on the landing page: WHERE the key comes from, and WHAT a run of it
 * costs.
 *
 * ============================================================================
 * THE ADDRESS IS THE SETTINGS CARD'S ADDRESS, NOT A SECOND COPY OF IT
 * ============================================================================
 * `OPENAI_KEY_PROVIDER.signupUrl` already exists and is already registered in
 * `lib/outbound-hosts.ts`. A second literal would be a second thing to drift,
 * and the drift would be invisible: both links would work, and they would
 * quietly point at different pages. The test below reads the constant rather
 * than repeating the string, so moving it moves both.
 *
 * ============================================================================
 * THE COST LINE MUST NOT TURN THE WELCOME INTO A PRICE LIST
 * ============================================================================
 * Two of the three cards work with no key at all, and the tracker needs
 * nothing whatsoever. A cost line that made the analysis card look gated would
 * break the promise the screen is mostly about. The keyless assertions at the
 * bottom are not decoration — they are the reason the wording is "a typical
 * analysis costs about 2p" rather than "requires payment".
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type Availability } from '../analysis/providers';
import { OPENAI_KEY_PROVIDER } from '../settings/keys/aiKeyModel';

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
  const browser = createFakeBrowserPort();
  render(
    <Welcome
      onDismiss={onDismiss as never}
      browser={browser}
      detect={() => Promise.resolve(NOTHING)}
    />,
  );
  return { user, browser };
}

describe('where do I get a key', () => {
  it('opens OpenAI’s key page in the user’s own browser', async () => {
    const { user, browser } = renderWelcome();

    await user.click(await screen.findByTestId('welcome-key-link'));

    // The exact address, byte for byte, with nothing appended to it.
    expect(browser.opened()).toEqual(['https://platform.openai.com/api-keys']);
  });

  it('uses the same address the Settings card uses, not a second copy of it', async () => {
    const { user, browser } = renderWelcome();

    await user.click(await screen.findByTestId('welcome-key-link'));

    expect(browser.opened()).toEqual([OPENAI_KEY_PROVIDER.signupUrl]);
  });

  it('hands the address to the browser rather than rendering a link the app follows', async () => {
    renderWelcome();

    const control = await screen.findByTestId('welcome-key-link');
    // A `<button>` driven through `platform/browser.ts`. A bare `<a href>`
    // inside a Tauri window navigates the app itself, which would replace the
    // application with openai.com and lose the user's session.
    expect(control.tagName).toBe('BUTTON');
    expect(document.querySelector('a[href*="platform.openai.com"]')).toBeNull();
  });

  it('puts the link on the analysis card, where the key is what it is for', async () => {
    renderWelcome();

    const card = await screen.findByTestId('welcome-card-analysis');
    expect(card.querySelector('[data-testid="welcome-key-link"]')).toBeTruthy();
  });
});

describe('what a typical CV costs', () => {
  it('names a figure and says who is paid', async () => {
    renderWelcome();

    const line = (await screen.findByTestId('welcome-cost')).textContent ?? '';
    expect(line).toContain('2p');
    // Who takes the money. CViper never sees it, and the screen must not imply
    // otherwise — the app has no payment path of any kind.
    expect(line).toContain('OpenAI');
  });

  it('says the figure can move, because it is someone else’s price list', async () => {
    renderWelcome();

    const line = ((await screen.findByTestId('welcome-cost')).textContent ?? '').toLowerCase();
    expect(line).toContain('change');
  });

  it('sits on the analysis card, not on the two that cost nothing', async () => {
    renderWelcome();

    const analysis = await screen.findByTestId('welcome-card-analysis');
    expect(analysis.querySelector('[data-testid="welcome-cost"]')).toBeTruthy();
    expect(
      screen.getByTestId('welcome-card-tracker').querySelector('[data-testid="welcome-cost"]'),
    ).toBeNull();
  });
});

describe('the way to the box you paste it into', () => {
  it('can send the user to Settings, where the key is actually entered', async () => {
    // `onDismiss` already takes any `ViewId`, and `App.onDismissWelcome` calls
    // `setActiveView` with whatever it is given. No new routing is invented
    // here — this is the screen's existing way of going somewhere.
    const onDismiss = vi.fn();
    const { user } = renderWelcome(onDismiss);

    await user.click(await screen.findByTestId('welcome-key-settings'));

    expect(onDismiss).toHaveBeenCalledWith('settings');
  });
});

describe('the free story survives all of it', () => {
  it('negative: with no key and no local model, the analysis card is still usable', async () => {
    // The whole product claim. A cost line that disabled the card would be a
    // paywall on a screen whose first sentence says there is nothing to sign
    // up for.
    const onDismiss = vi.fn();
    const { user } = renderWelcome(onDismiss);

    const action = await screen.findByTestId('welcome-action-analysis');
    expect(action).toHaveProperty('disabled', false);

    await user.click(action);
    expect(onDismiss).toHaveBeenCalledWith('analysis');
  });

  it('boundary: the card that needs nothing gains neither a price nor a key link', async () => {
    renderWelcome();

    const tracker = await screen.findByTestId('welcome-card-tracker');
    expect(tracker.querySelector('[data-testid="welcome-cost"]')).toBeNull();
    expect(tracker.querySelector('[data-testid="welcome-key-link"]')).toBeNull();
  });

  it('boundary: the screen still says the basic match works with nothing set up', async () => {
    // The cost line must sit ALONGSIDE the keyless sentence, never replace it.
    renderWelcome();

    const local = (
      (await screen.findByTestId('welcome-local-model')).textContent ?? ''
    ).toLowerCase();
    expect(local).toContain('works with nothing');
  });

  it('adds no second blue button to the screen', async () => {
    // One primary per view (`app/buttons.ts`). The welcome spends it on the
    // tracker card, and neither new control may take it.
    renderWelcome();

    await screen.findByTestId('welcome');
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
  });
});

afterEach(() => {
  cleanup();
});
