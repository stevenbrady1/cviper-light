// @vitest-environment jsdom
/**
 * The first screen a new user sees.
 *
 * The assertions that matter here are about honesty and escape: every card says
 * what it costs, the one that costs nothing is actionable before anything is
 * detected, and there is always a way out that does not require reading.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Availability } from '../analysis/providers';

import { Welcome } from './Welcome';

const NOTHING: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: false,
};

/** A detection that never resolves, for asserting the pre-detection state. */
function pending(): () => Promise<Availability> {
  return () => new Promise<Availability>(() => undefined);
}

afterEach(() => {
  cleanup();
});

describe('the three cards', () => {
  it('shows all three, each with what it needs', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    expect(await screen.findByTestId('welcome-card-tracker')).toBeTruthy();
    expect(screen.getByTestId('welcome-card-analysis')).toBeTruthy();
    expect(screen.getByTestId('welcome-card-search')).toBeTruthy();

    expect(screen.getByTestId('welcome-requirement-tracker').textContent).toBe(
      'Works now, no setup.',
    );
  });

  it('makes the tracker card actionable before any detection has finished', async () => {
    // The card that needs nothing must not wait on a probe of something it does
    // not use. This is the first impression of a zero-setup product.
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Welcome onDismiss={onDismiss} detect={pending()} />);

    const action = await screen.findByTestId('welcome-action-tracker');
    expect(action).toHaveProperty('disabled', false);

    await user.click(action);
    expect(onDismiss).toHaveBeenCalledWith('tracker');
  });

  it('takes the user to the view a card names', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Welcome onDismiss={onDismiss} detect={() => Promise.resolve(NOTHING)} />);

    await user.click(await screen.findByTestId('welcome-action-search'));
    expect(onDismiss).toHaveBeenCalledWith('search');
  });
});

describe('the live Ollama detection on the analysis card', () => {
  it('names the model it found', async () => {
    render(
      <Welcome
        onDismiss={() => undefined}
        detect={() =>
          Promise.resolve({
            ...NOTHING,
            ollamaRunning: true,
            ollamaModels: [{ id: 'llama3.2:3b', label: 'llama3.2:3b (3.2B)' }],
          })
        }
      />,
    );

    expect((await screen.findByTestId('welcome-local-model')).textContent).toContain('llama3.2:3b');
  });

  it('negative: says the basic match still works when it finds nothing', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    const line = (await screen.findByTestId('welcome-local-model')).textContent ?? '';
    expect(line.toLowerCase()).toContain('works with nothing');
  });

  it('boundary: says it is still looking rather than showing an empty line', async () => {
    // A blank space where a fact will appear reads as a rendering fault. The
    // probe is a local request and normally finishes in milliseconds, but
    // "normally" is not a state to design for.
    render(<Welcome onDismiss={() => undefined} detect={pending()} />);

    expect((await screen.findByTestId('welcome-local-model')).textContent).toContain('Looking');
  });

  it('negative: a detection that fails does not take the screen down with it', async () => {
    // The welcome must survive a broken probe. Its other two cards are still
    // true, and the analysis card degrades to the honest default.
    render(
      <Welcome onDismiss={() => undefined} detect={() => Promise.reject(new Error('no IPC'))} />,
    );

    const line = (await screen.findByTestId('welcome-local-model')).textContent ?? '';
    expect(line.toLowerCase()).toContain('works with nothing');
    expect(screen.getByTestId('welcome-card-tracker')).toBeTruthy();
  });
});

describe('getting out of it', () => {
  it('can be skipped without choosing anything', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Welcome onDismiss={onDismiss} detect={() => Promise.resolve(NOTHING)} />);

    await user.click(await screen.findByTestId('welcome-skip'));
    expect(onDismiss).toHaveBeenCalledWith(null);
  });

  it('closes on Escape, like every other overlay in this app', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Welcome onDismiss={onDismiss} detect={() => Promise.resolve(NOTHING)} />);

    await screen.findByTestId('welcome');
    await user.keyboard('{Escape}');

    expect(onDismiss).toHaveBeenCalledWith(null);
  });
});
