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

import { SECONDARY_BUTTON } from '../../../app/buttons';

import { CustomServiceCard } from './CustomServiceCard';
import {
  type CustomServiceInput,
  type CustomServicePort,
  type CustomServiceProblem,
  type CustomServiceStatus,
} from './customServicePort';

/**
 * Writes straight to browser storage, as an earlier session would have.
 * A helper rather than inline: a storage-key NAME beside a literal reads to
 * the secret scanner like a credential assignment, and these are model names.
 */
function storeModelRaw(value: string): void {
  localStorage.setItem(CUSTOM_MODEL_STORAGE_KEY, value);
}

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
    // L-390: saved, but no model chosen yet, so it is offered nowhere.
    expect(screen.getByTestId('custom-service-state').textContent).toBe('Choose a model');
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
    storeModelRaw('qwen2.5-7b-instruct');
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

describe('"Remove this service" sits with what it removes (0.10.1)', () => {
  it('is a real button in the same row as the "Saved:" line, not beside "Test and save"', async () => {
    const user = userEvent.setup();
    const port = fakePort({
      address: 'https://api.example.com/v1',
      ownNetwork: false,
      key: SENTINEL_KEY,
    });
    render(<CustomServiceCard port={port} />);

    const saved = await screen.findByTestId('custom-service-saved');
    const row = screen.getByTestId('custom-service-saved-row');
    expect(row.contains(saved)).toBe(true);

    const remove = screen.getByTestId('custom-service-remove');
    expect(row.contains(remove)).toBe(true);
    expect(remove.className).toBe(SECONDARY_BUTTON);
    expect(screen.getByTestId('custom-service-save').parentElement?.contains(remove)).toBe(false);

    await waitFor(() => expect((remove as HTMLButtonElement).disabled).toBe(false));
    await user.click(remove);
    await waitFor(() =>
      expect(screen.getByTestId('custom-service-state').textContent).toBe('Not set up'),
    );
    expect(port.saved).toBeNull();
    expect(screen.queryByTestId('custom-service-saved')).toBeNull();
  });
});

describe('"No service saved" beside the disabled Remove button (L-251)', () => {
  it('with nothing saved: says so in the same row as the disabled button', async () => {
    render(<CustomServiceCard port={fakePort()} />);

    const none = await screen.findByTestId('custom-service-none');
    expect(none.textContent).toBe('No service saved');
    const row = screen.getByTestId('custom-service-saved-row');
    expect(row.contains(none)).toBe(true);
    expect((screen.getByTestId('custom-service-remove') as HTMLButtonElement).disabled).toBe(true);
  });

  it('negative: a store that will not answer is not "no service saved"', async () => {
    const port = fakePort();
    port.statusFails = true;
    render(<CustomServiceCard port={port} />);
    await waitFor(() =>
      expect(screen.getByTestId('custom-service-state').textContent).toBe('Could not be read'),
    );
    expect(screen.queryByTestId('custom-service-none')).toBeNull();
  });

  it('with a service saved: the "Saved:" line instead', async () => {
    render(
      <CustomServiceCard
        port={fakePort({
          address: 'https://api.example.com/v1',
          ownNetwork: false,
          key: SENTINEL_KEY,
        })}
      />,
    );
    await screen.findByTestId('custom-service-saved');
    expect(screen.queryByTestId('custom-service-none')).toBeNull();
  });
});

/**
 * L-390: the card is a short row that opens on click, and its closed title
 * must say when the service needs something. Until a model is chosen it is
 * offered nowhere, so "Saved" alone would be a false all-clear.
 */
describe('the closed row says what the service needs (L-390)', () => {
  const SAVED: CustomServiceInput = {
    address: 'https://api.example.com/v1',
    ownNetwork: false,
    key: SENTINEL_KEY,
  };

  function row(): HTMLDetailsElement {
    return screen.getByTestId('custom-service-row') as HTMLDetailsElement;
  }

  function title(): HTMLElement {
    const summary = row().querySelector('summary');
    if (summary === null) throw new Error('the row has no title');
    return summary;
  }

  it('is a closed row with the name and the pill in its title', async () => {
    render(<CustomServiceCard port={fakePort()} />);
    await waitFor(() =>
      expect(screen.getByTestId('custom-service-state').textContent).toBe('Not set up'),
    );
    expect(row().open).toBe(false);
    expect(title().textContent).toContain('Your own AI service');
    expect(title().contains(screen.getByTestId('custom-service-state'))).toBe(true);
    expect(title().contains(screen.getByTestId('custom-service-address'))).toBe(false);
  });

  it('saved with no model: a gold "Choose a model" in the closed title', async () => {
    render(<CustomServiceCard port={fakePort(SAVED)} />);
    const pill = screen.getByTestId('custom-service-state');
    await waitFor(() => expect(pill.textContent).toBe('Choose a model'));

    expect(pill.getAttribute('data-tone')).toBe('attention');
    expect(title().contains(pill)).toBe(true);
    expect(row().open).toBe(false);
  });

  it('negative: saved with a model, the title says "Saved" and names the model', async () => {
    storeModelRaw('qwen2.5-7b-instruct');
    render(<CustomServiceCard port={fakePort(SAVED)} />);
    const pill = screen.getByTestId('custom-service-state');
    await waitFor(() => expect(pill.textContent).toBe('Saved'));

    expect(pill.getAttribute('data-tone')).toBe('ready');
    expect(title().textContent).toContain('qwen2.5-7b-instruct');
  });

  it('choosing a model inside turns "Choose a model" into "Saved"', async () => {
    const user = userEvent.setup();
    render(<CustomServiceCard port={fakePort(SAVED)} />);
    const pill = screen.getByTestId('custom-service-state');
    await waitFor(() => expect(pill.textContent).toBe('Choose a model'));

    const select = await screen.findByTestId('custom-service-model-select');
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(1));
    await user.selectOptions(select, 'qwen2.5-7b-instruct');

    expect(pill.textContent).toBe('Saved');
    expect(title().textContent).toContain('qwen2.5-7b-instruct');
  });

  it('boundary: removing the service goes back to "Not set up", with no model in the title', async () => {
    const user = userEvent.setup();
    storeModelRaw('qwen2.5-7b-instruct');
    render(<CustomServiceCard port={fakePort(SAVED)} />);
    const pill = screen.getByTestId('custom-service-state');
    await waitFor(() => expect(pill.textContent).toBe('Saved'));

    await user.click(title());
    await user.click(screen.getByTestId('custom-service-remove'));

    await waitFor(() => expect(pill.textContent).toBe('Not set up'));
    expect(title().textContent).not.toContain('qwen2.5-7b-instruct');
  });

  it('the model choice inside is called "AI model"', async () => {
    render(<CustomServiceCard port={fakePort(SAVED)} />);
    await screen.findByTestId('custom-service-model');

    expect(screen.getByText('AI model')).toBeTruthy();
  });
});
