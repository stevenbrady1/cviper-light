// @vitest-environment jsdom
/**
 * Nothing checks for an update unless a person presses the button.
 *
 * ============================================================================
 * THE BEHAVIOURAL HALF OF THE PROMISE.
 * ============================================================================
 * `noAutoCheck.test.ts` asserts the structural half — one import site, so the
 * claim can be verified by reading one module. This file asserts what actually
 * happens: mount the whole application, walk to Settings, and confirm the port
 * was never touched. It also proves the port IS reachable, because a guard that
 * passes because the button is broken is not a guard at all.
 *
 * Every Tauri command is stubbed to the "nothing is set up" answers, which is
 * the state a first launch is in.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('../../../app/App');
const { createFakeUpdatePort } = await import('./test/fakeUpdatePort');
const { createFakeTrackerPort } = await import('../../tracker/test/fakePort');
const { createFakeBackupPort } = await import('../test/fakePort');
const { markWelcomeSeen } = await import('../../onboarding/store');

beforeEach(() => {
  localStorage.clear();
  // Past the first-run introduction. It replaces the whole window, so without
  // this the app never draws Settings and the assertions below would pass for
  // the wrong reason — the strongest way to make a negative guard vacuous.
  markWelcomeSeen();
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

describe('launching the app', () => {
  it('does not check for updates on startup', async () => {
    const updatePort = createFakeUpdatePort();

    render(
      <App
        trackerPort={createFakeTrackerPort()}
        backupPort={createFakeBackupPort()}
        updatePort={updatePort}
      />,
    );

    await screen.findByTestId('view-tracker');
    expect(updatePort.calls.check).toBe(0);
  });

  it('does not check for updates merely because Settings was opened', async () => {
    // The subtler version of the same mistake: "check when the user visits the
    // screen" is still a request nobody asked for, and it is the one a future
    // `useEffect` would most plausibly introduce.
    const user = userEvent.setup();
    const updatePort = createFakeUpdatePort();

    render(
      <App
        trackerPort={createFakeTrackerPort()}
        backupPort={createFakeBackupPort()}
        updatePort={updatePort}
      />,
    );

    await user.click(await screen.findByTestId('nav-settings'));
    await screen.findByTestId('settings-check-updates');

    expect(updatePort.calls.check).toBe(0);
  });

  it('and the button really does reach the port — the guard above is not vacuous', async () => {
    const user = userEvent.setup();
    const updatePort = createFakeUpdatePort();

    render(
      <App
        trackerPort={createFakeTrackerPort()}
        backupPort={createFakeBackupPort()}
        updatePort={updatePort}
      />,
    );

    await user.click(await screen.findByTestId('nav-settings'));
    await user.click(await screen.findByTestId('settings-check-updates'));

    expect(updatePort.calls.check).toBe(1);
  });
});
