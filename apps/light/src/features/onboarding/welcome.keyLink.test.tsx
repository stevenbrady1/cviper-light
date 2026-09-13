// @vitest-environment jsdom
/**
 * The welcome screen keeps the landing page's promise about a key, generically
 * (L-90, re-pinned for C1 — coordinator review of PR #96).
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
 * ============================================================================
 * C1: THIS SCREEN NO LONGER OPENS A BROWSER, OR NAMES A PROVIDER, AT ALL
 * ============================================================================
 * `welcome-key-link` used to call `browserPort.open(OPENAI_KEY_PROVIDER
 * .signupUrl)` directly — sending the reader straight to OpenAI's own signup
 * page. That was the same defect `AI_COST_LINE` was fixed for in L-148, in a
 * different shape: the cost line said "the provider you choose" while the
 * button two lines below it chose one FOR them. `Welcome` no longer accepts a
 * `BrowserPort` at all — there is nothing left on this screen that opens one —
 * so the assertions below are about WHERE the button routes (Settings, the
 * same destination `welcome-key-settings` already used) and that nothing on
 * this screen renders a link out to any site.
 *
 * Choosing a provider, and that provider's own "where do I get a key?" link to
 * its own signup page, now live entirely on that provider's card in Settings —
 * `AiKeySetup.test.tsx` and `AiKeySetup.anthropic.test.tsx` hold those to
 * account.
 *
 * ============================================================================
 * THE COST LINE MUST NOT TURN THE WELCOME INTO A PRICE LIST
 * ============================================================================
 * Two of the three cards work with no key at all, and the tracker needs
 * nothing whatsoever. A cost line that made the analysis card look gated would
 * break the promise the screen is mostly about. The keyless assertions at the
 * bottom are not decoration — they are the reason the wording is "a typical
 * analysis costs a few pence" rather than "requires payment".
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
  it('routes to Settings → AI provider keys, the same destination "Paste a key in Settings" uses', async () => {
    const onDismiss = vi.fn();
    const { user } = renderWelcome(onDismiss);

    await user.click(await screen.findByTestId('welcome-key-link'));

    expect(onDismiss).toHaveBeenCalledWith('settings');
  });

  it('says "choose a provider", never names one', async () => {
    renderWelcome();

    const control = await screen.findByTestId('welcome-key-link');
    expect(control.textContent).toContain('Choose a provider and get a key');
    for (const brand of ['OpenAI', 'Anthropic']) {
      expect(control.textContent, brand).not.toContain(brand);
    }
  });

  it('negative: renders no link out to any site — the whole screen stays in the app', async () => {
    renderWelcome();

    await screen.findByTestId('welcome-key-link');
    // A bare `<a href>` inside a Tauri window navigates the app itself, which
    // would replace the application with whatever site it pointed at. This
    // screen no longer has a `BrowserPort` to open one with at all.
    expect(document.querySelector('a[href^="http"]')).toBeNull();
  });

  it('puts the link on the analysis card, where the key is what it is for', async () => {
    renderWelcome();

    const card = await screen.findByTestId('welcome-card-analysis');
    expect(card.querySelector('[data-testid="welcome-key-link"]')).toBeTruthy();
  });
});

describe('what a typical CV costs', () => {
  it('names a figure and says who is paid', async () => {
    // Re-pinned for L-148: the figure and the payee are now stated generically
    // ("a few pence", "the AI provider you choose") rather than naming OpenAI
    // and its specific rate — see `AI_COST_LINE`'s docblock in `cards.ts` for
    // why a precise band tied to one provider's rate card was the thing that
    // read as tied to one AI provider.
    renderWelcome();

    const line = (await screen.findByTestId('welcome-cost')).textContent ?? '';
    expect(line).toContain('a few pence');
    // Who takes the money. CViper never sees it, and the screen must not imply
    // otherwise — the app has no payment path of any kind. Stated generically:
    // the provider is the user's choice, not this screen's.
    expect(line).toContain('the AI provider you choose');
  });

  it('says a model on your own PC costs nothing', async () => {
    // What the generic sentence adds that the old one-provider wording never
    // stated on this card at all.
    renderWelcome();

    const line = ((await screen.findByTestId('welcome-cost')).textContent ?? '').toLowerCase();
    expect(line).toContain('free');
  });

  it('still says CViper takes no cut, and that prices can change (W5, restored)', async () => {
    // This caveat was dropped by mistake when the figure went generic (L-148)
    // and restored under coordinator review of PR #96: the estimate is still
    // someone else's price list, not a live meter, and the Store submission
    // docs separately promise "we receive nothing" — a promise this sentence
    // is what makes visible on the one screen most likely to be asked about
    // money.
    renderWelcome();

    const line = (await screen.findByTestId('welcome-cost')).textContent ?? '';
    expect(line).toContain('CViper takes no cut');
    expect(line.toLowerCase()).toContain('prices can change');
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
