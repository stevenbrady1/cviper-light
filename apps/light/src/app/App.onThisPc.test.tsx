// @vitest-environment jsdom
/**
 * The shell hands its own Ollama check down to Settings' "On this PC" box (L-406).
 *
 * The box asks nothing itself: it says what the rail's status read already
 * found. So it knows what to say the first time Settings is drawn, and cannot
 * grow after Settings has scrolled to a section (L-364).
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
const { LOOKING_FOR_LOCAL_AI } = await import('../features/onboarding/cards');

const NOW = new Date(2026, 7, 19, 9, 0, 0);

const ONE_MODEL = JSON.stringify({
  models: [{ model: 'llama3.2:3b', name: 'llama3.2:3b', details: { parameter_size: '3.2B' } }],
});

/** Answer the Ollama probe with `tags`; every key is unset. */
function ollamaAnswers(tags: string | null | Error): void {
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') {
      if (tags instanceof Error) throw tags;
      return tags;
    }
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command ${command}`);
  });
}

beforeEach(() => {
  localStorage.clear();
  markWelcomeSeen();
  tauri.invoke.mockReset();
});

afterEach(() => {
  cleanup();
});

function renderApp() {
  render(
    <App
      trackerPort={createFakeTrackerPort()}
      profilePort={createFakeProfilePort()}
      tailorPort={createFakeTailorPort()}
      now={NOW}
    />,
  );
}

/** Open the app, let the rail's first status read start, then open Settings. */
async function openSettings() {
  const user = userEvent.setup();
  renderApp();
  await screen.findByTestId('status-strip');
  await vi.waitFor(() =>
    expect(tauri.invoke.mock.calls.some(([command]) => command === 'ollama_probe')).toBe(true),
  );
  await user.click(screen.getByTestId('nav-settings'));
  return screen.getByTestId('settings-on-this-pc');
}

describe('Settings → On this PC, fed by the shell', () => {
  it('happy: a chat model the shell found is named, and the box says Ready', async () => {
    ollamaAnswers(ONE_MODEL);
    const box = await openSettings();

    await vi.waitFor(() => expect(box.textContent).toContain('running llama3.2:3b.'));
    expect(screen.getByTestId('on-this-pc-status').textContent).toBe('Ready');
  });

  it('the answer is already there when Settings is first drawn: it never says "Looking"', async () => {
    ollamaAnswers(ONE_MODEL);
    renderApp();
    // The rail saying "Ollama" is the shell's answer on screen.
    await vi.waitFor(() =>
      expect(screen.getByTestId('status-strip').textContent).toContain('Ollama'),
    );

    await userEvent.setup().click(screen.getByTestId('nav-settings'));

    // Read in the same turn as the click: no wait, so no later answer can help.
    const box = screen.getByTestId('settings-on-this-pc');
    expect(box.textContent).not.toContain(LOOKING_FOR_LOCAL_AI);
    expect(box.textContent).toContain('running llama3.2:3b.');
  });

  it('negative: no Ollama is "No AI is running", never Ready', async () => {
    ollamaAnswers(null);
    const box = await openSettings();

    await vi.waitFor(() => expect(box.textContent).toContain('No AI is running on this PC.'));
    expect(screen.queryByTestId('on-this-pc-status')).toBeNull();
  });

  it('negative: a probe that fails is "No AI is running" too, never Ready', async () => {
    ollamaAnswers(new Error('the probe broke'));
    const box = await openSettings();

    await vi.waitFor(() => expect(box.textContent).toContain('No AI is running on this PC.'));
    expect(box.textContent).not.toContain('Ready');
  });

  it('boundary: Ollama running with no chat model needs one', async () => {
    ollamaAnswers(JSON.stringify({ models: [] }));
    const box = await openSettings();

    await vi.waitFor(() =>
      expect(screen.getByTestId('on-this-pc-status').textContent).toBe('Needs a chat model'),
    );
    expect(box.textContent).not.toContain('Ready');
  });
});
