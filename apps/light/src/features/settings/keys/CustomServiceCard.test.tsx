// @vitest-environment jsdom
/**
 * The card for an AI service at an address the user types (L-150), driven the
 * way a user drives it.
 *
 * The fake port keeps what Rust would keep — one saved address-and-key pair —
 * and the assertions look at that, never at "was save called".
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { err, ok, type Result } from '@cviper/core-types';
import { type ModelInfo } from '@cviper/ai-providers';

import { CUSTOM_MODEL_STORAGE_KEY, readCustomModel } from '../../analysis/customModel';

import { CustomServiceCard } from './CustomServiceCard';
import {
  type CustomServiceInput,
  type CustomServicePort,
  type CustomServiceProblem,
  type CustomServiceStatus,
} from './customServicePort';

const SENTINEL_KEY = 'sk-SENTINEL-custom-1234';

interface FakePort extends CustomServicePort {
  saved: (CustomServiceInput & { readonly hasKey: boolean }) | null;
  refuseWith: string | null;
  models: readonly ModelInfo[] | string;
  statusFails: boolean;
}

function fakePort(start: CustomServiceInput | null = null): FakePort {
  const port: FakePort = {
    saved: start === null ? null : { ...start, hasKey: start.key !== '' },
    refuseWith: null,
    models: [{ id: 'qwen2.5-7b-instruct', label: 'qwen2.5-7b-instruct' }],
    statusFails: false,
    status(): Promise<Result<CustomServiceStatus | null, CustomServiceProblem>> {
      if (port.statusFails) return Promise.resolve(err({ message: 'The store is locked.' }));
      const saved = port.saved;
      return Promise.resolve(
        ok(
          saved === null
            ? null
            : { address: saved.address, ownNetwork: saved.ownNetwork, hasKey: saved.hasKey },
        ),
      );
    },
    save(input) {
      if (port.refuseWith !== null) return Promise.resolve(err({ message: port.refuseWith }));
      port.saved = { ...input, hasKey: input.key !== '' };
      return Promise.resolve(ok(undefined));
    },
    remove() {
      port.saved = null;
      return Promise.resolve(ok(undefined));
    },
    listModels() {
      return Promise.resolve(
        typeof port.models === 'string' ? err({ message: port.models }) : ok(port.models),
      );
    },
  };
  return port;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  address: string,
  key: string,
  ownNetwork = false,
): Promise<void> {
  if (address !== '') await user.type(screen.getByTestId('custom-service-address'), address);
  if (ownNetwork) await user.click(screen.getByTestId('custom-service-own-network'));
  if (key !== '') await user.type(screen.getByTestId('custom-service-key'), key);
}

describe('setting it up', () => {
  it('starts as not set up, with the address, the tick box and the key to fill in', async () => {
    render(<CustomServiceCard port={fakePort()} />);
    await waitFor(() =>
      expect(screen.getByTestId('custom-service-state').textContent).toBe('Not set up'),
    );
    expect(screen.getByTestId('custom-service-address')).toBeTruthy();
    expect((screen.getByTestId('custom-service-own-network') as HTMLInputElement).checked).toBe(
      false,
    );
    expect((screen.getByTestId('custom-service-key') as HTMLInputElement).type).toBe('password');
  });

  it('happy: tests and saves an internet service, then offers its models', async () => {
    const user = userEvent.setup();
    const port = fakePort();
    render(<CustomServiceCard port={port} />);

    await fill(user, '  https://api.example.com/v1 ', `${SENTINEL_KEY}\n`);
    await user.click(screen.getByTestId('custom-service-save'));

    await waitFor(() => expect(port.saved).not.toBeNull());
    // Trimmed once, here: the pair Rust tested is the pair it saved.
    expect(port.saved).toEqual({
      address: 'https://api.example.com/v1',
      ownNetwork: false,
      key: SENTINEL_KEY,
      hasKey: true,
    });
    expect(screen.getByTestId('custom-service-result').textContent).toContain('saved');
    expect(screen.getByTestId('custom-service-saved').textContent).toContain(
      'https://api.example.com/v1',
    );
    expect(screen.getByTestId('custom-service-state').textContent).toBe('Saved');
    // The key leaves the DOM once it is safely stored, and is never drawn.
    expect((screen.getByTestId('custom-service-key') as HTMLInputElement).value).toBe('');
    expect(document.body.innerHTML).not.toContain(SENTINEL_KEY);

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'qwen2.5-7b-instruct' })).toBeTruthy(),
    );
  });

  it('happy: a service on the user’s own network saves with the box ticked and no key', async () => {
    const user = userEvent.setup();
    const port = fakePort();
    render(<CustomServiceCard port={port} />);

    await fill(user, 'http://localhost:1234/v1', '', true);
    await user.click(screen.getByTestId('custom-service-save'));

    await waitFor(() =>
      expect(port.saved).toEqual({
        address: 'http://localhost:1234/v1',
        ownNetwork: true,
        key: '',
        hasKey: false,
      }),
    );
    expect(screen.getByTestId('custom-service-saved').textContent).toContain(
      'your own computer or network',
    );
    expect(screen.getByTestId('custom-service-saved').textContent).toContain('no key');
  });

  it('negative: an empty address is caught here, and nothing is sent', async () => {
    const user = userEvent.setup();
    const port = fakePort();
    render(<CustomServiceCard port={port} />);

    await fill(user, '   ', SENTINEL_KEY);
    await user.click(screen.getByTestId('custom-service-save'));

    expect(screen.getByTestId('custom-service-address-error').textContent).toContain('address');
    expect(screen.getByTestId('custom-service-address').getAttribute('aria-invalid')).toBe('true');
    expect(port.saved).toBeNull();
  });

  it('negative: no key without the tick is caught here, and says how to go on', async () => {
    const user = userEvent.setup();
    const port = fakePort();
    render(<CustomServiceCard port={port} />);

    await fill(user, 'https://api.example.com/v1', '');
    await user.click(screen.getByTestId('custom-service-save'));

    expect(screen.getByTestId('custom-service-key-error').textContent).toContain('tick');
    expect(port.saved).toBeNull();
  });

  it('negative: Rust’s refusal is shown as it is, and nothing is saved', async () => {
    const user = userEvent.setup();
    const port = fakePort();
    port.refuseWith = 'CViper will not connect to that address.';
    render(<CustomServiceCard port={port} />);

    await fill(user, 'http://169.254.169.254/v1', '', true);
    await user.click(screen.getByTestId('custom-service-save'));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'CViper will not connect to that address.',
      ),
    );
    expect(port.saved).toBeNull();
    expect(screen.queryByTestId('custom-service-saved')).toBeNull();
  });

  it('negative: a failed test keeps what the user typed, so they can fix it', async () => {
    const user = userEvent.setup();
    const port = fakePort();
    port.refuseWith = 'That service did not accept the key.';
    render(<CustomServiceCard port={port} />);

    await fill(user, 'https://api.example.com/v1', SENTINEL_KEY);
    await user.click(screen.getByTestId('custom-service-save'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect((screen.getByTestId('custom-service-address') as HTMLInputElement).value).toBe(
      'https://api.example.com/v1',
    );
  });

  it('boundary: the address box stops at the length Rust accepts', () => {
    render(<CustomServiceCard port={fakePort()} />);
    expect(screen.getByTestId('custom-service-address').getAttribute('maxlength')).toBe('300');
  });
});

describe('a saved service', () => {
  const SAVED: CustomServiceInput = {
    address: 'https://api.example.com/v1',
    ownNetwork: false,
    key: SENTINEL_KEY,
  };

  it('shows where it is, without the key', async () => {
    render(<CustomServiceCard port={fakePort(SAVED)} />);
    await waitFor(() =>
      expect(screen.getByTestId('custom-service-saved').textContent).toContain(
        'https://api.example.com/v1',
      ),
    );
    expect(screen.getByTestId('custom-service-saved').textContent).toContain('key saved');
    expect(document.body.innerHTML).not.toContain(SENTINEL_KEY);
  });

  it('remembers the model the user picks, which is what the pickers offer', async () => {
    const user = userEvent.setup();
    render(<CustomServiceCard port={fakePort(SAVED)} />);

    const select = await screen.findByTestId('custom-service-model-select');
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(1));
    await user.selectOptions(select, 'qwen2.5-7b-instruct');

    expect(readCustomModel()).toBe('qwen2.5-7b-instruct');
  });

  it('a model can be typed when the service will not list its models', async () => {
    const user = userEvent.setup();
    const port = fakePort(SAVED);
    port.models = 'That service did not return a model list.';
    render(<CustomServiceCard port={port} />);

    await waitFor(() =>
      expect(screen.getByTestId('custom-service-models-problem').textContent).toContain(
        'model list',
      ),
    );
    await user.type(screen.getByTestId('custom-service-model-typed'), 'my-model');
    await user.click(screen.getByTestId('custom-service-model-use'));
    expect(readCustomModel()).toBe('my-model');
  });

  it('negative: a typed model that is not an id is refused and not remembered', async () => {
    const user = userEvent.setup();
    const port = fakePort(SAVED);
    port.models = 'No list.';
    render(<CustomServiceCard port={port} />);

    await user.type(await screen.findByTestId('custom-service-model-typed'), 'two words');
    await user.click(screen.getByTestId('custom-service-model-use'));
    expect(screen.getByTestId('custom-service-model-error').textContent).toContain('model');
    expect(readCustomModel()).toBeNull();
  });

  it('removing it forgets the service and its model', async () => {
    const user = userEvent.setup();
    const port = fakePort(SAVED);
    localStorage.setItem(CUSTOM_MODEL_STORAGE_KEY, 'qwen2.5-7b-instruct');
    render(<CustomServiceCard port={port} />);

    const remove = await screen.findByTestId('custom-service-remove');
    await waitFor(() => expect((remove as HTMLButtonElement).disabled).toBe(false));
    await user.click(remove);

    await waitFor(() =>
      expect(screen.getByTestId('custom-service-state').textContent).toBe('Not set up'),
    );
    expect(port.saved).toBeNull();
    expect(readCustomModel()).toBeNull();
  });

  it('negative: Remove is shown but disabled while nothing is saved', async () => {
    render(<CustomServiceCard port={fakePort()} />);
    await waitFor(() =>
      expect(screen.getByTestId('custom-service-state').textContent).toBe('Not set up'),
    );
    expect((screen.getByTestId('custom-service-remove') as HTMLButtonElement).disabled).toBe(true);
  });

  it('negative: a store that will not answer says so rather than "not set up"', async () => {
    const port = fakePort(SAVED);
    port.statusFails = true;
    render(<CustomServiceCard port={port} />);
    await waitFor(() =>
      expect(screen.getByTestId('custom-service-state').textContent).toBe('Could not be read'),
    );
  });
});
