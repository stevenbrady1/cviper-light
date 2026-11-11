// @vitest-environment jsdom
/**
 * The shell loads the mono faces when it starts (L-364), so a screen drawn
 * later never lays out with a fallback face and then moves when the real one
 * lands. See `startupFonts.ts`.
 *
 * Mocked like `App.test.tsx`: no Tauri runtime, and it says no to everything.
 */
import { cleanup, render, screen } from '@testing-library/react';
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

const NOW = new Date(2026, 7, 19, 9, 0, 0);

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
  // jsdom has no `document.fonts`; put it back the way it was.
  Reflect.deleteProperty(document, 'fonts');
});

async function renderApp() {
  render(
    <App
      trackerPort={createFakeTrackerPort()}
      profilePort={createFakeProfilePort()}
      tailorPort={createFakeTailorPort()}
      now={NOW}
    />,
  );
  await screen.findByTestId('status-strip');
}

describe('the shell loads the mono faces at startup (L-364)', () => {
  it('asks the font set for Plex Mono 400 and 500 as it starts', async () => {
    const load = vi.fn(() => Promise.resolve([]));
    Object.defineProperty(document, 'fonts', { value: { load }, configurable: true });
    await renderApp();
    const asked = new Set(load.mock.calls.map((call: unknown[]) => call[0]));
    expect(asked).toEqual(new Set(['400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"']));
  });

  it('negative: with no font set at all, the shell still starts', async () => {
    expect('fonts' in document).toBe(false);
    await renderApp();
    expect(screen.getByTestId('shell')).toBeTruthy();
  });

  it('negative: with every face failing to load, the shell still starts', async () => {
    const load = vi.fn(() => Promise.reject(new Error('no such file')));
    Object.defineProperty(document, 'fonts', { value: { load }, configurable: true });
    await renderApp();
    expect(screen.getByTestId('shell')).toBeTruthy();
    expect(load).toHaveBeenCalled();
  });
});
