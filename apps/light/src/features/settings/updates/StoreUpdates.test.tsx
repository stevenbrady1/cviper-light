// @vitest-environment jsdom
/**
 * Updates on a phone: the section names the store and offers no check,
 * because the updater plugin is not compiled into that build at all (L-80).
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
});

function renderSettings(mobileOs: 'ios' | 'android' | null) {
  return render(
    <Settings
      port={createFakeBackupPort()}
      updatePort={createFakeUpdatePort()}
      mobileOs={mobileOs}
    />,
  );
}

describe('the Updates section', () => {
  it('on an iPhone names the App Store and offers no check button', () => {
    renderSettings('ios');

    expect(screen.getByTestId('settings-store-updates').textContent).toMatch(/App Store/);
    expect(screen.getByTestId('settings-store-updates').textContent).toMatch(/not at all/);
    expect(screen.queryByTestId('settings-check-updates')).toBeNull();
    expect(screen.queryByTestId('settings-update-note')).toBeNull();
  });

  it('on Android names Google Play', () => {
    renderSettings('android');

    expect(screen.getByTestId('settings-store-updates').textContent).toMatch(/Google Play/);
    expect(screen.queryByTestId('settings-check-updates')).toBeNull();
  });

  it('on a desktop is the manual check, exactly as before', () => {
    renderSettings(null);

    expect(screen.getByTestId('settings-check-updates')).toBeTruthy();
    expect(screen.queryByTestId('settings-store-updates')).toBeNull();
  });

  it('defaults to the desktop answer when nothing says otherwise (jsdom is not a phone)', () => {
    render(<Settings port={createFakeBackupPort()} updatePort={createFakeUpdatePort()} />);

    expect(screen.getByTestId('settings-check-updates')).toBeTruthy();
  });

  it('shows the version the build reports, never a network-fetched one', () => {
    render(<StoreUpdates os="ios" version="0.9.9" />);

    expect(screen.getByText('0.9.9')).toBeTruthy();
    // No IPC at all: the section is text.
    expect(tauri.invoke).not.toHaveBeenCalled();
  });
});
