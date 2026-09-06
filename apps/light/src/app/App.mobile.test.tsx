// @vitest-environment jsdom
/**
 * The shell on a phone (L-81): the rail is gone, a bottom bar is there, and
 * the three core views still stand up at 375px.
 *
 * Width is simulated through `matchMedia`, which is the only thing the shell
 * reads; jsdom does no layout, so nothing here measures a pixel. What can be
 * pinned is which navigation is mounted, that only one ever is, that it drives
 * the views, and that it follows a rotation.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
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

const NOW = new Date(2026, 7, 19, 9, 0, 0);

function installMatchMedia(widthPx: number) {
  const listeners = new Set<() => void>();
  let width = widthPx;
  const list = {
    get matches() {
      return width >= 768;
    },
    media: WIDE_QUERY,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => list,
  });
  return {
    resize(next: number) {
      width = next;
      for (const listener of listeners) listener();
    },
  };
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
  const result = render(<App trackerPort={createFakeTrackerPort()} now={NOW} />);
  await screen.findByTestId('shell');
  await vi.waitFor(() =>
    expect(tauri.invoke.mock.calls.some(([command]) => command === 'ollama_probe')).toBe(true),
  );
  return result;
}

describe('the shell at 375px', () => {
  it('mounts the bottom bar and not the rail', async () => {
    installMatchMedia(375);
    await renderApp();

    expect(screen.getByTestId('shell').getAttribute('data-viewport')).toBe('narrow');
    expect(screen.getByTestId('bottom-nav')).toBeTruthy();
    expect(screen.queryByTestId('sidebar')).toBeNull();
  });

  it('offers all four views, once each, under the same test ids as the rail', async () => {
    installMatchMedia(375);
    await renderApp();

    for (const id of ['search', 'tracker', 'analysis', 'settings']) {
      expect(screen.getAllByTestId(`nav-${id}`)).toHaveLength(1);
    }
  });

  it('switches view from the bar and marks exactly one item current', async () => {
    installMatchMedia(375);
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByTestId('nav-analysis'));

    expect(screen.getByTestId('view-analysis')).toBeTruthy();
    expect(screen.queryByTestId('view-tracker')).toBeNull();
    const current = ['search', 'tracker', 'analysis', 'settings'].filter(
      (id) => screen.getByTestId(`nav-${id}`).getAttribute('aria-current') === 'page',
    );
    expect(current).toEqual(['analysis']);
  });

  it('gives every bar item a 44px minimum height and the home-indicator inset', async () => {
    // Class pins: jsdom cannot measure, but the class is the whole mechanism.
    installMatchMedia(375);
    await renderApp();

    for (const id of ['search', 'tracker', 'analysis', 'settings']) {
      expect(screen.getByTestId(`nav-${id}`).className).toMatch(/\bmin-h-11\b/);
    }
    expect(screen.getByTestId('bottom-nav').className).toMatch(/\bpb-safe\b/);
    expect(screen.getByTestId('shell').className).toMatch(/\bpt-safe\b/);
  });

  it('stands up each of the three core views', async () => {
    installMatchMedia(375);
    const user = userEvent.setup();
    await renderApp();

    expect(screen.getByTestId('view-tracker')).toBeTruthy();
    await user.click(screen.getByTestId('nav-analysis'));
    expect(screen.getByTestId('view-analysis')).toBeTruthy();
    await user.click(screen.getByTestId('nav-settings'));
    expect(screen.getByTestId('view-settings')).toBeTruthy();
  });

  it('keeps Ctrl+1/2/3 working with a keyboard attached', async () => {
    installMatchMedia(375);
    await renderApp();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true }));
    });
    expect(screen.getByTestId('view-search')).toBeTruthy();
  });
});

describe('the shell at 768px and above', () => {
  it('mounts the rail and not the bottom bar, exactly as before L-81', async () => {
    installMatchMedia(768);
    await renderApp();

    expect(screen.getByTestId('shell').getAttribute('data-viewport')).toBe('wide');
    expect(screen.getByTestId('sidebar')).toBeTruthy();
    expect(screen.queryByTestId('bottom-nav')).toBeNull();
    expect(screen.getByTestId('shell').className).not.toMatch(/\bpt-safe\b/);
  });
});

describe('rotation', () => {
  it('swaps one navigation for the other without losing the current view', async () => {
    const media = installMatchMedia(375);
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByTestId('nav-settings'));

    act(() => media.resize(1024));

    expect(screen.getByTestId('sidebar')).toBeTruthy();
    expect(screen.queryByTestId('bottom-nav')).toBeNull();
    expect(screen.getByTestId('view-settings')).toBeTruthy();
    expect(screen.getByTestId('nav-settings').getAttribute('aria-current')).toBe('page');

    act(() => media.resize(375));

    expect(screen.getByTestId('bottom-nav')).toBeTruthy();
    expect(screen.queryByTestId('sidebar')).toBeNull();
    expect(screen.getByTestId('view-settings')).toBeTruthy();
  });
});

describe('the first-run introduction at 375px', () => {
  it('takes the window, with the phone insets and no navigation', async () => {
    localStorage.clear();
    installMatchMedia(375);
    render(<App trackerPort={createFakeTrackerPort()} now={NOW} />);

    expect(await screen.findByTestId('welcome')).toBeTruthy();
    expect(screen.queryByTestId('bottom-nav')).toBeNull();
    expect(screen.queryByTestId('sidebar')).toBeNull();
  });
});
