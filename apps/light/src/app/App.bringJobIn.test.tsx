// @vitest-environment jsdom
/**
 * L-324 end to end in the shell: Search's "Found one? Bring it in" shows
 * Tracker with the paste pane open and the cursor in the link box — and only
 * that time, not on every later visit to Tracker.
 *
 * Width is simulated through `matchMedia`, as in `App.mobile.test.tsx`. jsdom
 * does no layout: whether the pane really covers the window is checked in
 * WebKit (`e2e/contrast-webkit.spec.ts`).
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('./App');
const { WIDE_QUERY } = await import('./viewport');
const { markWelcomeSeen } = await import('../features/onboarding/store');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeProfilePort } = await import('../features/profile/test/fakePort');
const { createFakeTailorPort } = await import('../features/tailor/test/fakePort');
const { createFakeSearchPort } = await import('../features/search/test/fakeSearchPort');
const { createFakeBoardPort } = await import('../features/boards/test/fakeBoardPort');
const { createFakeBrowserPort } = await import('../platform/test/fakeBrowserPort');

const NOW = new Date(2026, 7, 19, 9, 0, 0);

function installMatchMedia(widthPx: number) {
  const list = {
    matches: widthPx >= 768,
    media: WIDE_QUERY,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => list,
  });
}

beforeEach(() => {
  localStorage.clear();
  markWelcomeSeen();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command ${command}`);
  });
});

afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

async function renderApp() {
  const user = userEvent.setup();
  render(
    <App
      trackerPort={createFakeTrackerPort()}
      profilePort={createFakeProfilePort()}
      tailorPort={createFakeTailorPort()}
      searchPort={createFakeSearchPort()}
      boardsPort={createFakeBoardPort()}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => ({ adzuna: 'missing', reed: 'missing' })}
      now={NOW}
    />,
  );
  await screen.findByTestId('shell');
  return { user };
}

async function bringJobIn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('nav-search'));
  await user.click(await screen.findByRole('button', { name: 'Found one? Bring it in' }));
  expect(await screen.findByTestId('view-tracker')).toBeTruthy();
}

describe('Found one? Bring it in — from Search to Tracker', () => {
  it('Search → Bring it in → Tracker, pane open, link box focused', async () => {
    const { user } = await renderApp();
    await bringJobIn(user);

    expect(screen.getByTestId('nav-tracker').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('paste-job-form')).toBeTruthy();
    const link = screen.getByLabelText('Link to the advert');
    await vi.waitFor(() => expect(document.activeElement).toBe(link));
    // Still there once the board has loaded: nothing took focus back.
    await screen.findByTestId('tracker-empty');
    expect(document.activeElement).toBe(link);
  });

  it('negative: the next ordinary visit to Tracker opens shut, focus on the title', async () => {
    const { user } = await renderApp();
    await bringJobIn(user);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Link to the advert')),
    );

    await user.click(screen.getByTestId('nav-search'));
    await user.click(screen.getByTestId('nav-tracker'));
    await screen.findByTestId('tracker-empty');

    expect(screen.queryByTestId('paste-job-form')).toBeNull();
    const title = screen.getByTestId('view-tracker').querySelector('h1');
    expect(title).not.toBeNull();
    expect(document.activeElement).toBe(title);
  });

  it('boundary: narrow window — focus is inside the covering pane', async () => {
    installMatchMedia(375);
    const { user } = await renderApp();
    expect(screen.getByTestId('shell').getAttribute('data-viewport')).toBe('narrow');
    await bringJobIn(user);

    const pane = screen.getByTestId('detail-pane');
    const link = screen.getByLabelText('Link to the advert');
    // The link box, not the pane's Close button the phone pane would pick.
    await vi.waitFor(() => expect(document.activeElement).toBe(link));
    expect(pane.contains(document.activeElement)).toBe(true);
  });
});
