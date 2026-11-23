// @vitest-environment jsdom
/**
 * The version is in Settings, not in the menu (S1, L-452).
 *
 * It sat under Settings in the rail (L-251). It moved: the menu stays quiet,
 * and Settings → About says "CViper Light <version> · MIT licence", as it
 * already did. Settings → Updates says "You are on <version>" too.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('./App');
const { Sidebar } = await import('./Sidebar');
const { About } = await import('../features/settings/about/About');
const { APP_VERSION } = await import('../features/settings/backup');
const { markWelcomeSeen } = await import('../features/onboarding/store');
const { createFakeBrowserPort } = await import('../platform/test/fakeBrowserPort');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeProfilePort } = await import('../features/profile/test/fakePort');
const { createFakeTailorPort } = await import('../features/tailor/test/fakePort');

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

afterEach(() => cleanup());

// APP_VERSION is held to package.json by the backup tests (backup.ts says so).

describe('the version lives in Settings, not in the menu', () => {
  it('happy: About shows exactly "CViper Light <APP_VERSION> · MIT licence"', () => {
    render(<About browser={createFakeBrowserPort()} />);

    expect(screen.getByTestId('about-version').textContent).toBe(
      `CViper Light ${APP_VERSION} · MIT licence`,
    );
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('negative: the rail has no sidebar-version line', () => {
    render(<Sidebar activeView="tracker" onSelect={() => undefined} status={null} />);

    expect(screen.queryByTestId('sidebar-version')).toBeNull();
  });

  it('boundary: no text in the rail looks like a version, under any test id', () => {
    render(<Sidebar activeView="settings" onSelect={() => undefined} status={null} />);

    const rail = screen.getByTestId('sidebar');
    expect(rail.textContent).not.toMatch(/\d+\.\d+\.\d+/);
    expect(rail.textContent).not.toContain(APP_VERSION);
  });

  it('interaction: "Settings" in the menu opens Settings, and its About holds the version', async () => {
    const user = userEvent.setup();
    render(
      <App
        trackerPort={createFakeTrackerPort()}
        profilePort={createFakeProfilePort()}
        tailorPort={createFakeTailorPort()}
        now={new Date(2026, 7, 19, 9, 0, 0)}
      />,
    );
    await screen.findByTestId('status-strip');
    await vi.waitFor(() =>
      expect(tauri.invoke.mock.calls.some(([command]) => command === 'ollama_probe')).toBe(true),
    );
    expect(screen.getByTestId('sidebar').textContent).not.toMatch(/\d+\.\d+\.\d+/);

    await user.click(screen.getByTestId('nav-settings'));

    const about = await screen.findByTestId('settings-about');
    expect(about.querySelector('[data-testid="about-version"]')?.textContent).toBe(
      `CViper Light ${APP_VERSION} · MIT licence`,
    );
  });
});
