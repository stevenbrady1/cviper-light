// @vitest-environment jsdom
/**
 * L-338 end to end in the shell: for a UK search with no job-board key,
 * Search's "Get a free Reed key" opens Settings with the job-board keys
 * unfolded and the Reed card's own signup button focused — and only that
 * time, not on every later visit to Settings.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('./App');
const { markWelcomeSeen } = await import('../features/onboarding/store');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeProfilePort } = await import('../features/profile/test/fakePort');
const { createFakeTailorPort } = await import('../features/tailor/test/fakePort');
const { createFakeSearchPort } = await import('../features/search/test/fakeSearchPort');
const { createFakeBoardPort } = await import('../features/boards/test/fakeBoardPort');
const { createFakeBrowserPort } = await import('../platform/test/fakeBrowserPort');
const { createFakeBackupPort } = await import('../features/settings/test/fakePort');
const { createFakeFilePort } = await import('../platform/test/fakeFilePort');

const NOW = new Date(2026, 7, 19, 9, 0, 0);

beforeEach(() => {
  localStorage.clear();
  markWelcomeSeen();
  HTMLElement.prototype.scrollTo = vi.fn() as unknown as HTMLElement['scrollTo'];
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command ${command}`);
  });
});

afterEach(cleanup);

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
      backupPort={createFakeBackupPort()}
      filePort={createFakeFilePort()}
      now={NOW}
    />,
  );
  await screen.findByTestId('shell');
  return { user };
}

async function pressGetReedKey(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('nav-search'));
  await screen.findByTestId('keyless-bar');
  await user.type(screen.getByTestId('search-location'), 'London');
  await user.click(await screen.findByRole('button', { name: 'Get a free Reed key' }));
}

describe('Get a free Reed key, from Search to Settings', () => {
  it('opens Settings with the job-board keys unfolded and the Reed card targeted', async () => {
    const { user } = await renderApp();
    await pressGetReedKey(user);

    expect(await screen.findByTestId('view-settings')).toBeTruthy();
    expect(screen.getByTestId('nav-settings').getAttribute('aria-current')).toBe('page');
    const details = screen.getByTestId('settings-advanced') as HTMLDetailsElement;
    expect(details.open).toBe(true);
    const card = await screen.findByTestId('key-card-reed');
    expect(details.contains(card)).toBe(true);
    const signup = screen.getByTestId('key-signup-reed');
    await vi.waitFor(() => expect(document.activeElement).toBe(signup));
    expect(card.contains(document.activeElement)).toBe(true);
  });

  it('negative: the next ordinary visit to Settings opens at the top, keys folded', async () => {
    const { user } = await renderApp();
    await pressGetReedKey(user);
    const signup = await screen.findByTestId('key-signup-reed');
    await vi.waitFor(() => expect(document.activeElement).toBe(signup));

    await user.click(screen.getByTestId('nav-search'));
    await user.click(screen.getByTestId('nav-settings'));
    await screen.findByTestId('key-card-reed');
    expect((screen.getByTestId('settings-advanced') as HTMLDetailsElement).open).toBe(false);
    expect(document.activeElement).not.toBe(screen.getByTestId('key-signup-reed'));
  });
});
