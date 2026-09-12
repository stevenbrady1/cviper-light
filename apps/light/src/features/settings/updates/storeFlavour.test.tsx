// @vitest-environment jsdom
/**
 * Updates in the Microsoft Store flavour (L-93): the section names the Store
 * and offers no check, because the updater plugin is not in that binary.
 *
 * ============================================================================
 * WHY THIS IS A SEPARATE FILE FROM `StoreUpdates.test.tsx`
 * ============================================================================
 * That file is about a PHONE, where the platform is read from the WebView's
 * user agent. This is about a WINDOWS DESKTOP, where the same user agent, the
 * same operating system and the same code can be either a direct download that
 * updates itself or a Store install that must not try to — and the only thing
 * that tells them apart is how the bundle was built.
 *
 * ============================================================================
 * THE FAILURE THIS PREVENTS
 * ============================================================================
 * An installed MSIX's files are read-only. A Store build that still drew
 * "Check for updates" would offer a button that either throws (the plugin is
 * not compiled in) or downloads an installer it cannot write. Either way the
 * user sees it fail, on a machine where Windows was already updating the app
 * properly.
 *
 * The structural half — that the plugin really is absent from that binary —
 * is `lib/msix-store-build.contract.test.ts`. This is the half that says the
 * screen agrees with it.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Settings } = await import('../Settings');
const { StoreUpdates } = await import('./StoreUpdates');
const { createFakeUpdatePort } = await import('./test/fakeUpdatePort');
const { createFakeBackupPort } = await import('../test/fakePort');
const { DISTRIBUTION_ENV, MICROSOFT_STORE } = await import('../../../platform/distribution');

beforeEach(() => {
  localStorage.clear();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function renderSettings(distribution?: 'microsoft-store' | 'direct') {
  return render(
    <Settings
      port={createFakeBackupPort()}
      updatePort={createFakeUpdatePort()}
      mobileOs={null}
      {...(distribution === undefined ? {} : { distribution })}
    />,
  );
}

describe('a Microsoft Store build on the desktop', () => {
  it('names the Microsoft Store and offers no check button', () => {
    renderSettings(MICROSOFT_STORE);

    const note = screen.getByTestId('settings-store-updates').textContent ?? '';
    expect(note).toMatch(/Microsoft Store/);
    expect(note).toMatch(/not at all/);
    expect(screen.queryByTestId('settings-check-updates')).toBeNull();
    // The launch-check switch goes with it: there is nothing for it to switch.
    expect(screen.queryByTestId('settings-update-on-launch')).toBeNull();
    expect(screen.queryByTestId('settings-update-note')).toBeNull();
  });

  it('never calls the update port, even once', () => {
    // The point of the flavour. A port that was called would mean the plugin
    // was still being reached in a build that does not contain it.
    const port = createFakeUpdatePort();
    render(
      <Settings
        port={createFakeBackupPort()}
        updatePort={port}
        mobileOs={null}
        distribution={MICROSOFT_STORE}
      />,
    );

    expect(port.calls.check).toBe(0);
    expect(port.calls.install).toBe(0);
  });

  it('reads the real build variable, so the wiring is not decorative', () => {
    // No `distribution` prop at all: the default has to reach
    // `distributionChannel()`, which has to read the variable the packaging
    // workflow actually sets. A component wired to a prop nobody passes in
    // production would pass every test above and ship the wrong screen.
    vi.stubEnv(DISTRIBUTION_ENV, MICROSOFT_STORE);
    renderSettings();

    expect(screen.getByTestId('settings-store-updates').textContent).toMatch(/Microsoft Store/);
    expect(screen.queryByTestId('settings-check-updates')).toBeNull();
  });
});

describe('a direct download on the desktop is unchanged', () => {
  it('still offers the manual check and the launch switch', () => {
    // The regression half. Most Windows copies are direct downloads, and the
    // manual check is the ONLY way one of them learns about a security fix.
    renderSettings('direct');

    expect(screen.getByTestId('settings-check-updates')).toBeTruthy();
    expect(screen.getByTestId('settings-update-on-launch')).toBeTruthy();
    expect(screen.queryByTestId('settings-store-updates')).toBeNull();
  });

  it('negative: an unset build variable is a direct download, not a Store build', () => {
    // The state every developer build and every test run is in. Resolving it
    // to "Store" would hide the update button from people who need it.
    renderSettings();

    expect(screen.getByTestId('settings-check-updates')).toBeTruthy();
    expect(screen.queryByTestId('settings-store-updates')).toBeNull();
  });

  it('negative: a variable set to something else is still a direct download', () => {
    vi.stubEnv(DISTRIBUTION_ENV, 'sideloaded');
    renderSettings();

    expect(screen.getByTestId('settings-check-updates')).toBeTruthy();
  });
});

describe('the section itself', () => {
  it('says the Microsoft Store when asked directly, and touches no IPC', () => {
    render(<StoreUpdates os="windows" version="1.2.3" />);

    expect(screen.getByTestId('settings-store-updates').textContent).toMatch(/Microsoft Store/);
    expect(screen.getByText('1.2.3')).toBeTruthy();
    expect(tauri.invoke).not.toHaveBeenCalled();
  });
});
