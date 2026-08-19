// @vitest-environment jsdom
/**
 * First run, second run, and the way back.
 *
 * ============================================================================
 * THE PROPERTY WORTH GUARDING IS "ONCE".
 * ============================================================================
 * An introduction that reappears is the single most irritating thing a desktop
 * app can do, and it is an easy regression: any change to how the flag is read
 * turns "shown once" into "shown for ever" with no test in between. So the
 * second-launch case is asserted by mounting the app a second time against the
 * same storage, exactly as a relaunch would.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('../../app/App');
const { createFakeTrackerPort } = await import('../tracker/test/fakePort');
const { createFakeBackupPort } = await import('../settings/test/fakePort');
const { createFakeUpdatePort } = await import('../settings/updates/test/fakeUpdatePort');

function renderApp() {
  return render(
    <App
      trackerPort={createFakeTrackerPort()}
      backupPort={createFakeBackupPort()}
      updatePort={createFakeUpdatePort()}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

describe('the first launch', () => {
  it('opens on the introduction rather than the board', async () => {
    renderApp();

    expect(await screen.findByTestId('welcome')).toBeTruthy();
    expect(screen.queryByTestId('view-tracker')).toBeNull();
  });

  it('goes where the chosen card points, and does not come back', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByTestId('welcome-action-analysis'));

    expect(await screen.findByTestId('view-analysis')).toBeTruthy();
    expect(screen.queryByTestId('welcome')).toBeNull();
  });

  it('skipping leaves the user on the board', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByTestId('welcome-skip'));

    expect(await screen.findByTestId('view-tracker')).toBeTruthy();
  });
});

describe('every launch after the first', () => {
  it('does not show the introduction again', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByTestId('welcome-skip'));

    // A relaunch: a fresh mount against the storage the first one wrote.
    cleanup();
    renderApp();

    expect(await screen.findByTestId('view-tracker')).toBeTruthy();
    expect(screen.queryByTestId('welcome')).toBeNull();
  });
});

describe('opening it again from Settings', () => {
  it('brings the introduction back', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByTestId('welcome-skip'));

    await user.click(await screen.findByTestId('nav-settings'));
    await user.click(await screen.findByTestId('settings-show-welcome'));

    expect(await screen.findByTestId('welcome')).toBeTruthy();
  });

  it('boundary: closing it a second time returns to Settings, not to the board', async () => {
    // The user was in Settings when they opened it. Dropping them somewhere
    // else afterwards is the app losing their place.
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByTestId('welcome-skip'));

    await user.click(await screen.findByTestId('nav-settings'));
    await user.click(await screen.findByTestId('settings-show-welcome'));
    await user.click(await screen.findByTestId('welcome-skip'));

    expect(await screen.findByTestId('view-settings')).toBeTruthy();
  });
});
