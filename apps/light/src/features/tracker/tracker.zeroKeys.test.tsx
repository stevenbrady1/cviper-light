// @vitest-environment jsdom
/**
 * ============================================================================
 * THE PROMISE: THE TRACKER WORKS WITH NOTHING CONFIGURED.
 * ============================================================================
 * No API key for Adzuna, none for Reed, none for Anthropic or OpenAI, and no
 * Ollama running. That is not an edge case — it is EVERY user's first launch,
 * and for most of them it is every launch after that too. It is also a claim
 * the product makes out loud.
 *
 * A claim like that decays quietly. Nobody sets out to make the board need a
 * key: somebody adds a "suggest a next action" button, or an enrichment call
 * when a card is created, or a model dropdown in the pane, and it works
 * perfectly on their machine because their machine has keys. This file is what
 * turns that from a thing people remember into a thing the build refuses.
 *
 * So it does two things, and the second is the load-bearing one:
 *
 *   1. Drives the WHOLE tracker loop — add, change status, set a next action,
 *      write a note — with `secret_status` answering false for every key and
 *      `ollama_probe` answering nothing.
 *   2. Asserts that NO PROVIDER TRANSPORT WAS INVOKED. Not `provider_chat`, not
 *      `provider_list_models`. If a future change makes the board reach for a
 *      model, this fails, and it names the command it saw.
 *
 * It also asserts that no error surface appears anywhere, because an
 * unconfigured machine is a working machine, not a broken one.
 *
 * The whole APP is rendered, not the tracker alone: the rail's status strip is
 * part of what a user sees on a zero-key machine, and a red dot or an error
 * banner up there would break the same promise just as thoroughly.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('../../app/App');
const { markWelcomeSeen } = await import('../onboarding/store');
const { createFakeTrackerPort } = await import('./test/fakePort');

/** Commands that mean a provider was contacted. See `src/ai/transport.ts`. */
const PROVIDER_COMMANDS = ['provider_chat', 'provider_list_models'];

const NOW = new Date(2026, 7, 19, 9, 0, 0);

function invokedProviderCommands(): string[] {
  return tauri.invoke.mock.calls
    .map(([command]) => command)
    .filter((command) => PROVIDER_COMMANDS.includes(command));
}

beforeEach(() => {
  localStorage.clear();
  // Past the first-run introduction, which is what every assertion in this file
  // is about — see `onboarding/firstRun.test.tsx` for the introduction itself.
  // Without this the app opens on the welcome screen and the shell is not drawn.
  markWelcomeSeen();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    // A machine with nothing set up: no daemon, and not one saved credential.
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    // Anything else reaching Rust is a failure of the promise, and it fails
    // loudly rather than resolving to something the UI can paper over.
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

describe('the tracker on a machine with no keys and no Ollama', () => {
  it('runs the whole loop — add, move, schedule, annotate — and needs nothing', async () => {
    const user = userEvent.setup();
    const port = createFakeTrackerPort();

    render(<App trackerPort={port} now={NOW} />);

    // --- The board is there, and it is inviting rather than apologetic ------
    const empty = await screen.findByTestId('tracker-empty');
    expect(empty.textContent).toContain('no API key');

    // --- Add ---------------------------------------------------------------
    await user.click(screen.getByTestId('tracker-empty-add'));
    await user.type(screen.getByLabelText('Job title'), 'Credit Risk Analyst');
    await user.type(screen.getByLabelText('Company'), 'Lloyds');
    await user.type(screen.getByLabelText(/^Location/), 'London');
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    await screen.findByTestId('tracker-column-saved');
    expect(port.entries()).toHaveLength(1);
    const applicationId = port.entries()[0]?.application.id ?? '';
    expect(applicationId).not.toBe('');

    // --- Change status -----------------------------------------------------
    await user.selectOptions(await screen.findByTestId('detail-status'), 'applied');
    await vi.waitFor(() => {
      expect(port.entries()[0]?.application.status).toBe('applied');
    });
    expect(
      within(screen.getByTestId('tracker-column-applied')).getByText('Credit Risk Analyst'),
    ).toBeTruthy();

    // --- Set a next action -------------------------------------------------
    fireEvent.change(screen.getByTestId('detail-next-action'), {
      target: { value: 'Chase the recruiter' },
    });
    fireEvent.blur(screen.getByTestId('detail-next-action'));
    fireEvent.change(screen.getByTestId('detail-next-action-date'), {
      target: { value: '2026-08-21' },
    });

    await vi.waitFor(() => {
      expect(port.entries()[0]?.application.next_action).toBe('Chase the recruiter');
      expect(port.entries()[0]?.application.next_action_date).toBe('2026-08-21');
    });

    // --- Write a note ------------------------------------------------------
    fireEvent.change(screen.getByTestId('detail-notes'), {
      target: { value: 'Spoke to Priya, sending my CV on Thursday.' },
    });
    fireEvent.blur(screen.getByTestId('detail-notes'));

    await vi.waitFor(() => {
      expect(port.entries()[0]?.application.notes).toBe(
        'Spoke to Priya, sending my CV on Thursday.',
      );
    });

    // --- The two things this file exists to prove --------------------------
    expect(invokedProviderCommands()).toEqual([]);
    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(screen.queryByTestId('tracker-error')).toBeNull();
  });

  it('shows the due date the user set, coloured but not alarming', async () => {
    // The card ends the loop above carrying a real due date. Two days out is
    // gold — the user's attention, not an error.
    const user = userEvent.setup();
    const port = createFakeTrackerPort();
    render(<App trackerPort={port} now={NOW} />);

    await screen.findByTestId('tracker-empty');
    await user.click(screen.getByTestId('tracker-empty-add'));
    await user.type(screen.getByLabelText('Job title'), 'Credit Risk Analyst');
    await user.type(screen.getByLabelText('Company'), 'Lloyds');
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    fireEvent.change(await screen.findByTestId('detail-next-action-date'), {
      target: { value: '2026-08-21' },
    });

    const applicationId = port.entries()[0]?.application.id ?? '';
    const chip = await screen.findByTestId(`tracker-card-due-${applicationId}`);
    expect(chip.dataset['urgency']).toBe('soon');
    expect(invokedProviderCommands()).toEqual([]);
  });

  it('deletes an application without any provider ever being asked', async () => {
    const user = userEvent.setup();
    const port = createFakeTrackerPort();
    render(<App trackerPort={port} now={NOW} />);

    await screen.findByTestId('tracker-empty');
    await user.click(screen.getByTestId('tracker-empty-add'));
    await user.type(screen.getByLabelText('Job title'), 'Credit Risk Analyst');
    await user.type(screen.getByLabelText('Company'), 'Lloyds');
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    await user.click(await screen.findByTestId('detail-delete'));
    await user.click(screen.getByTestId('confirm-delete-confirm'));

    await vi.waitFor(() => expect(port.entries()).toHaveLength(0));
    expect(invokedProviderCommands()).toEqual([]);
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });
});

describe('the rail on the same machine', () => {
  it('reports what is set up without treating "nothing" as a fault', async () => {
    render(<App trackerPort={createFakeTrackerPort()} now={NOW} />);

    await screen.findByTestId('status-strip');
    await vi.waitFor(() => {
      expect(screen.getByTestId('status-ollama').getAttribute('data-state')).toBe('absent');
    });

    expect(screen.getByTestId('status-adzuna').getAttribute('data-state')).toBe('missing');
    expect(screen.getByTestId('status-reed').getAttribute('data-state')).toBe('missing');
    expect(screen.getByTestId('status-requests').textContent).toContain('0');

    // Nothing anywhere on screen claims something has gone wrong.
    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(invokedProviderCommands()).toEqual([]);
  });

  it('leaves the request counter at zero, because nothing was requested', async () => {
    // The counter is wired into the transport. A number above zero here would
    // mean something in the tracker path called a provider.
    const user = userEvent.setup();
    const port = createFakeTrackerPort();
    render(<App trackerPort={port} now={NOW} />);

    await screen.findByTestId('tracker-empty');
    await user.click(screen.getByTestId('tracker-empty-add'));
    await user.type(screen.getByLabelText('Job title'), 'Credit Risk Analyst');
    await user.type(screen.getByLabelText('Company'), 'Lloyds');
    await user.click(screen.getByRole('button', { name: 'Save application' }));
    await screen.findByTestId('tracker-column-saved');

    expect(screen.getByTestId('status-requests').textContent).toContain('0');
    expect(localStorage.getItem('cviper.light.requests')).toBeNull();
  });
});

describe('the guard itself', () => {
  it('would notice a provider call — proved, not assumed', async () => {
    // A guard that cannot fail is worse than no guard. This calls the real
    // transport directly, exactly as a future "suggest a next action" button
    // would, and shows that `invokedProviderCommands` sees it.
    const { createTauriTransport } = await import('../../ai/transport');
    tauri.invoke.mockResolvedValue(JSON.stringify({ status: 200, body: '{}' }));

    await createTauriTransport().chat('ollama', '{}');

    expect(invokedProviderCommands()).toEqual(['provider_chat']);
  });
});
