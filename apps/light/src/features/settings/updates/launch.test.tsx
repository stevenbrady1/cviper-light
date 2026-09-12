// @vitest-environment jsdom
/**
 * The update check on launch, and the promise that replaced the old one.
 *
 * ============================================================================
 * WHAT THIS FILE USED TO GUARANTEE, AND WHY THAT CHANGED (L-92)
 * ============================================================================
 * It used to assert that mounting the application called `check` ZERO times,
 * full stop. That was the right guarantee for a build with no launch check in
 * it, and the owner has since decided the direct-download build should look for
 * an update when it starts — because a local-first app with no store behind it
 * has no other way to tell somebody that a version with a security fix exists.
 *
 * The old promise is not simply dropped. It is REPLACED by a narrower one that
 * is worth the same amount, and this file is where it is pinned:
 *
 *   * THE TOGGLE OFF MEANS ZERO OUTBOUND REQUESTS. Not "a smaller request",
 *     not "a request without identifying data" — none at all, on launch and on
 *     every screen after it.
 *   * NOTHING IS REQUESTED BEFORE THE TOGGLE HAS BEEN READ. A check that fires
 *     and then consults the preference has already broken it. The ordering is
 *     asserted, not assumed, because it is the difference between a setting and
 *     a decoration.
 *
 * `noAutoCheck.test.ts` is untouched and still holds: the updater plugin has
 * exactly ONE import site. That guard was never about when the check happens —
 * it is about the claim being auditable by reading one module — and the launch
 * check goes through the same port, so it stays true.
 *
 * ============================================================================
 * THE DEFAULT IS ON, SO THE DEFAULT IS THE ONE TESTED AGAINST REAL STORAGE
 * ============================================================================
 * Two of the tests below drive the REAL preference store through
 * `localStorage` rather than an injected reader, because a toggle that works
 * only when a test hands the component its answer is a toggle that is not
 * wired to anything. The injected reader is used for one thing only: proving
 * the ORDER of the read and the request, which no amount of storage can show.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('../../../app/App');
const { createFakeUpdatePort, AN_UPDATE } = await import('./test/fakeUpdatePort');
const { createFakeTrackerPort } = await import('../../tracker/test/fakePort');
const { createFakeBackupPort } = await import('../test/fakePort');
const { markWelcomeSeen } = await import('../../onboarding/store');
const { setUpdateCheckOnLaunch } = await import('./launchCheck');

beforeEach(() => {
  localStorage.clear();
  // Past the first-run introduction. It replaces the whole window, so without
  // this the app never draws the shell and the assertions below would pass for
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

function renderApp(props: Partial<Parameters<typeof App>[0]> = {}) {
  const updatePort = createFakeUpdatePort();
  render(
    <App
      trackerPort={createFakeTrackerPort()}
      backupPort={createFakeBackupPort()}
      updatePort={updatePort}
      {...props}
    />,
  );
  return updatePort;
}

describe('the toggle is off', () => {
  it('makes ZERO requests on launch', async () => {
    setUpdateCheckOnLaunch(false);
    const updatePort = renderApp();

    await screen.findByTestId('view-tracker');
    expect(updatePort.calls.check).toBe(0);
  });

  it('makes zero requests when Settings is opened either', async () => {
    // The subtler version of the same mistake: "check when the user visits the
    // screen" is still a request they switched off.
    setUpdateCheckOnLaunch(false);
    const user = userEvent.setup();
    const updatePort = renderApp();

    await user.click(await screen.findByTestId('nav-settings'));
    await screen.findByTestId('settings-check-updates');

    expect(updatePort.calls.check).toBe(0);
  });

  it('shows no banner, because nothing was asked', async () => {
    setUpdateCheckOnLaunch(false);
    renderApp();

    await screen.findByTestId('view-tracker');
    expect(screen.queryByTestId('update-banner')).toBeNull();
  });
});

describe('nothing is requested before the toggle has been read', () => {
  it('reads the preference first, then checks', async () => {
    // A check that fires and consults the preference afterwards has already
    // made the request the user switched off. Only the order shows that.
    const order: string[] = [];
    const updatePort = createFakeUpdatePort();
    const recording = {
      ...updatePort,
      check: () => {
        order.push('check');
        return updatePort.check();
      },
    };

    render(
      <App
        trackerPort={createFakeTrackerPort()}
        backupPort={createFakeBackupPort()}
        updatePort={recording}
        readUpdateCheckOnLaunch={() => {
          order.push('read-the-toggle');
          return true;
        }}
      />,
    );

    await screen.findByTestId('view-tracker');
    expect(order[0]).toBe('read-the-toggle');
    expect(order).toContain('check');
  });
});

describe('the toggle is on, which is the default', () => {
  it('checks once on launch with nothing stored at all', async () => {
    // Default-on is asserted against the REAL store: nothing written, nothing
    // injected. A default that only exists in a test fixture is not a default.
    const updatePort = renderApp();

    await screen.findByTestId('view-tracker');
    await vi.waitFor(() => expect(updatePort.calls.check).toBe(1));
  });

  it('checks once, not once per view change', async () => {
    const user = userEvent.setup();
    const updatePort = renderApp();

    await vi.waitFor(() => expect(updatePort.calls.check).toBe(1));
    await user.click(await screen.findByTestId('nav-settings'));
    await screen.findByTestId('settings-check-updates');

    expect(updatePort.calls.check).toBe(1);
  });

  it('is silent when there is nothing newer — no banner, no interruption', async () => {
    const updatePort = renderApp();

    await vi.waitFor(() => expect(updatePort.calls.check).toBe(1));
    expect(screen.queryByTestId('update-banner')).toBeNull();
    // And the app is usable, not sitting behind a spinner.
    expect(screen.getByTestId('view-tracker')).toBeTruthy();
  });

  it('is silent about a FAILED check — the user did not ask, so they are not told', async () => {
    // A launch check nobody requested must not produce an error banner. The
    // manual button is where a failure is worth reporting, because somebody is
    // waiting for the answer.
    const updatePort = createFakeUpdatePort();
    updatePort.nextCheck({ ok: false, error: { message: 'GitHub could not be reached.' } });
    render(
      <App
        trackerPort={createFakeTrackerPort()}
        backupPort={createFakeBackupPort()}
        updatePort={updatePort}
      />,
    );

    await vi.waitFor(() => expect(updatePort.calls.check).toBe(1));
    expect(screen.queryByTestId('update-banner')).toBeNull();
  });
});

describe('when there is an update, it is offered and never forced', () => {
  it('shows a banner naming the version, with the app still usable behind it', async () => {
    const updatePort = createFakeUpdatePort();
    updatePort.nextCheck({ ok: true, value: AN_UPDATE });
    render(
      <App
        trackerPort={createFakeTrackerPort()}
        backupPort={createFakeBackupPort()}
        updatePort={updatePort}
      />,
    );

    const banner = await screen.findByTestId('update-banner');
    expect(banner.textContent).toContain('0.2.0');
    // Not a modal: the thing the user opened the app to do is still there.
    expect(screen.getByTestId('view-tracker')).toBeTruthy();
  });

  it('installs in one press', async () => {
    const user = userEvent.setup();
    const updatePort = createFakeUpdatePort();
    updatePort.nextCheck({ ok: true, value: AN_UPDATE });
    render(
      <App
        trackerPort={createFakeTrackerPort()}
        backupPort={createFakeBackupPort()}
        updatePort={updatePort}
      />,
    );

    await user.click(await screen.findByTestId('update-banner-install'));
    expect(updatePort.calls.install).toBe(1);
  });

  it('can be dismissed, and dismissing installs nothing', async () => {
    // "Never forced" has to mean there is a way out that does not install.
    const user = userEvent.setup();
    const updatePort = createFakeUpdatePort();
    updatePort.nextCheck({ ok: true, value: AN_UPDATE });
    render(
      <App
        trackerPort={createFakeTrackerPort()}
        backupPort={createFakeBackupPort()}
        updatePort={updatePort}
      />,
    );

    await user.click(await screen.findByTestId('update-banner-dismiss'));

    expect(screen.queryByTestId('update-banner')).toBeNull();
    expect(updatePort.calls.install).toBe(0);
  });
});

describe('the manual button still works', () => {
  it('reaches the port when pressed — the guards above are not vacuous', async () => {
    setUpdateCheckOnLaunch(false);
    const user = userEvent.setup();
    const updatePort = renderApp();

    await user.click(await screen.findByTestId('nav-settings'));
    await user.click(await screen.findByTestId('settings-check-updates'));

    expect(updatePort.calls.check).toBe(1);
  });
});
