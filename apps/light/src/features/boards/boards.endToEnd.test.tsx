// @vitest-environment jsdom
/**
 * ============================================================================
 * THE WHOLE PATH: SETTINGS CHANGES THE LIST, THE SEARCH SCREEN OPENS THE LINK.
 * ============================================================================
 * Every other test in this feature checks one layer. This one drives the app
 * the way a person does — switch a board off, add one of your own, walk back to
 * the search screen, type a job title, press the new button — and asserts on
 * the URL the browser was handed.
 *
 * It is the only test that would catch the two failures that no unit test can:
 * the two screens reading DIFFERENT stores, and the search screen never
 * re-reading the list after Settings wrote it. Both would leave every other
 * file in this feature perfectly green.
 *
 * The whole `App` is rendered, and no provider transport may be touched: the
 * board buttons are the keyless path and they must not need a key, a network or
 * a database to work.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('../../app/App');
const { markWelcomeSeen } = await import('../onboarding/store');
const { createFakeTrackerPort } = await import('../tracker/test/fakePort');
const { createFakeBrowserPort } = await import('../../platform/test/fakeBrowserPort');
const { createFakeBoardPort } = await import('./test/fakeBoardPort');

/*
  Deliberately ONE case, and it is the richest one: it walks Settings -> add a
  board -> Search -> click it -> assert the URL, so it exercises the whole path
  including both screens sharing one store.

  Every full-`App` render in jsdom costs about a second of wall clock and holds
  a worker, and this suite already has several files that mount the whole app —
  on a slow machine the heaviest of those sit close to the 5s per-test timeout.
  Everything a second or third case here would add is asserted more cheaply
  against the components alone in `BoardSettings.test.tsx` and
  `KeylessBar.test.tsx`, so it is asserted there.
*/

const NOW = new Date('2026-08-19T09:00:00.000Z');

const PROVIDER_COMMANDS = ['job_search', 'job_test_credentials', 'provider_chat'];

function contactedAnyBoard(): string[] {
  return tauri.invoke.mock.calls
    .map(([command]) => command)
    .filter((command) => PROVIDER_COMMANDS.includes(command));
}

beforeEach(() => {
  localStorage.clear();
  markWelcomeSeen();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    if (command === 'plugin:sql|load') return 'sqlite:cviper.db';
    if (command === 'plugin:sql|execute') return [0, 0];
    if (command === 'plugin:sql|select') return [];
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

describe('changing the board list and using it', () => {
  it('A BOARD ADDED IN SETTINGS OPENS ITS OWN URL FROM THE SEARCH SCREEN', async () => {
    const user = userEvent.setup();
    const browser = createFakeBrowserPort();
    const boardsPort = createFakeBoardPort();

    render(
      <App
        trackerPort={createFakeTrackerPort()}
        browser={browser}
        boardsPort={boardsPort}
        now={NOW}
      />,
    );

    await screen.findByTestId('status-strip');
    await user.click(screen.getByTestId('nav-settings'));

    await user.click(await screen.findByTestId('boards-add-open'));
    await user.click(screen.getByTestId('boards-new-label'));
    await user.paste('My Board');
    // PASTED, not typed. It is what the form's own instructions tell the user to
    // do with an address, it is one event instead of fifty, and it sidesteps
    // userEvent reading `{...}` as a key descriptor.
    await user.click(screen.getByTestId('boards-new-template'));
    await user.paste('https://www.example.com/{keyword}-jobs-in-{location}');
    await user.selectOptions(screen.getByTestId('boards-new-encoding'), 'hyphen');
    await user.click(screen.getByTestId('boards-add-submit'));

    await user.click(screen.getByTestId('nav-search'));
    await screen.findByTestId('view-search');

    // Pasted rather than typed: this test already mounts the whole application
    // and drives a dozen interactions, and every synthetic keystroke is another
    // React flush. Typing is covered by `Search.test.tsx`; what is under test
    // here is the URL that comes out the other end.
    await user.click(screen.getByTestId('search-keywords'));
    await user.paste('business analyst');
    await user.click(screen.getByTestId('search-location'));
    await user.paste('Milton Keynes');
    await user.click(await screen.findByTestId('keyless-custom-my-board'));

    expect(browser.opened()).toEqual([
      'https://www.example.com/business-analyst-jobs-in-Milton-Keynes',
    ]);
    expect(contactedAnyBoard()).toEqual([]);
  });
});
