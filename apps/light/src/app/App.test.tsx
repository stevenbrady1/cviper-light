// @vitest-environment jsdom
/**
 * The shell, driven the way a user drives it.
 *
 * `@tauri-apps/api/core` is mocked because there is no Tauri runtime here, and
 * it is mocked to say NO TO EVERYTHING — no Ollama, no keys — because that is
 * the state every user is in the first time they open the app, and it is the
 * state the whole product has to work in.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('./App');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');

/**
 * A fixed clock and an in-memory tracker port.
 *
 * The port matters: without one the tracker builds the real SQLite-backed port,
 * `Database.load()` finds no Tauri runtime, and the board correctly raises "the
 * database could not be opened". That is the RIGHT behaviour and it is asserted
 * in the tracker's own tests — but it is not what these tests are about, and it
 * would make "no errors on an unconfigured machine" fail for a reason that has
 * nothing to do with keys.
 */
const NOW = new Date(2026, 7, 19, 9, 0, 0);

beforeEach(() => {
  localStorage.clear();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

/** Render and wait for the rail's first status read to land. */
async function renderApp() {
  const result = render(<App trackerPort={createFakeTrackerPort()} now={NOW} />);
  await screen.findByTestId('status-strip');
  // The status read is three IPC promises; let them settle so no assertion
  // races the first paint.
  await vi.waitFor(() =>
    expect(tauri.invoke.mock.calls.some(([command]) => command === 'ollama_probe')).toBe(true),
  );
  return result;
}

describe('the shell', () => {
  it('shows the rail with the three steps and Settings', async () => {
    await renderApp();

    for (const id of ['search', 'tracker', 'analysis', 'settings']) {
      expect(screen.getByTestId(`nav-${id}`)).toBeTruthy();
    }
  });

  it('opens on the tracker', async () => {
    await renderApp();

    expect(screen.getByTestId('nav-tracker').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('view-tracker')).toBeTruthy();
  });

  it('switches view when a rail button is clicked', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByTestId('nav-search'));

    expect(screen.getByTestId('view-search')).toBeTruthy();
    expect(screen.queryByTestId('view-tracker')).toBeNull();
    expect(screen.getByTestId('nav-search').getAttribute('aria-current')).toBe('page');
  });

  it('marks exactly one rail item as the current page', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByTestId('nav-settings'));

    const current = ['search', 'tracker', 'analysis', 'settings'].filter(
      (id) => screen.getByTestId(`nav-${id}`).getAttribute('aria-current') === 'page',
    );
    expect(current).toEqual(['settings']);
  });
});

describe('keyboard shortcuts', () => {
  it('switches to Search, Tracker and Analysis with Ctrl+1/2/3', async () => {
    await renderApp();

    fireEvent.keyDown(document, { key: '1', ctrlKey: true });
    expect(screen.getByTestId('view-search')).toBeTruthy();

    fireEvent.keyDown(document, { key: '3', ctrlKey: true });
    expect(screen.getByTestId('view-analysis')).toBeTruthy();

    fireEvent.keyDown(document, { key: '2', ctrlKey: true });
    expect(screen.getByTestId('view-tracker')).toBeTruthy();
  });

  it('boundary: an unbound digit does nothing at all', async () => {
    await renderApp();

    fireEvent.keyDown(document, { key: '4', ctrlKey: true });
    fireEvent.keyDown(document, { key: '0', ctrlKey: true });

    expect(screen.getByTestId('view-tracker')).toBeTruthy();
  });

  it('negative: a bare digit, or Ctrl+Alt+digit, is left for the user to type', async () => {
    // Ctrl+Alt is AltGr on many European layouts and types a real character.
    // Stealing it would make text entry impossible on those keyboards.
    await renderApp();

    fireEvent.keyDown(document, { key: '1' });
    fireEvent.keyDown(document, { key: '1', ctrlKey: true, altKey: true });

    expect(screen.getByTestId('view-tracker')).toBeTruthy();
  });

  it('negative: a non-digit key with Ctrl is ignored', async () => {
    await renderApp();

    fireEvent.keyDown(document, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true });

    expect(screen.getByTestId('view-tracker')).toBeTruthy();
  });
});

describe('the status strip on a machine with nothing set up', () => {
  it('reports Ollama absent and both search providers missing, with no error', async () => {
    await renderApp();

    await vi.waitFor(() => {
      expect(screen.getByTestId('status-ollama').getAttribute('data-state')).toBe('absent');
    });
    expect(screen.getByTestId('status-adzuna').getAttribute('data-state')).toBe('missing');
    expect(screen.getByTestId('status-reed').getAttribute('data-state')).toBe('missing');

    // Nothing about an unconfigured machine is an error, so nothing may
    // announce itself as one.
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('shows zero requests today', async () => {
    await renderApp();

    expect(screen.getByTestId('status-requests').textContent).toContain('0');
  });

  it('turns the Ollama dot on when the daemon answers', async () => {
    tauri.invoke.mockImplementation(async (command) => {
      if (command === 'ollama_probe') return '{"models":[]}';
      if (command === 'secret_status') return false;
      throw new Error(`unexpected command ${command}`);
    });

    await renderApp();

    await vi.waitFor(() => {
      expect(screen.getByTestId('status-ollama').getAttribute('data-state')).toBe('running');
    });
  });

  it('re-reads the status when the user changes view', async () => {
    // The moment this exists for: coming back from Settings having just pasted
    // a key. The rail must already agree, without a restart.
    const user = userEvent.setup();
    await renderApp();

    const before = tauri.invoke.mock.calls.filter(([command]) => command === 'ollama_probe').length;

    await user.click(screen.getByTestId('nav-settings'));

    await vi.waitFor(() => {
      const after = tauri.invoke.mock.calls.filter(([c]) => c === 'ollama_probe').length;
      expect(after).toBeGreaterThan(before);
    });
  });
});
