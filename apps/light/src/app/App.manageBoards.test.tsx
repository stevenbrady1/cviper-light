// @vitest-environment jsdom
/**
 * L-310 end to end in the shell: Search's "Manage job boards" opens Settings
 * at the Job boards section, focused — and only that time, not on every later
 * visit to Settings.
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

describe('Manage job boards, from Search to Settings', () => {
  it('opens Settings with the Job boards section focused', async () => {
    const { user } = await renderApp();
    await user.click(screen.getByTestId('nav-search'));
    await user.click(await screen.findByRole('button', { name: 'Manage job boards' }));

    expect(await screen.findByTestId('view-settings')).toBeTruthy();
    const section = await screen.findByTestId('boards-settings');
    await vi.waitFor(() => expect(document.activeElement).toBe(section));
    expect(screen.getByTestId('nav-settings').getAttribute('aria-current')).toBe('page');
  });

  it('negative: the next ordinary visit to Settings opens at the top, not at Job boards', async () => {
    const { user } = await renderApp();
    await user.click(screen.getByTestId('nav-search'));
    await user.click(await screen.findByRole('button', { name: 'Manage job boards' }));
    const first = await screen.findByTestId('boards-settings');
    await vi.waitFor(() => expect(document.activeElement).toBe(first));

    await user.click(screen.getByTestId('nav-search'));
    await user.click(screen.getByTestId('nav-settings'));
    const again = await screen.findByTestId('boards-settings');
    expect(document.activeElement).not.toBe(again);
  });
});
