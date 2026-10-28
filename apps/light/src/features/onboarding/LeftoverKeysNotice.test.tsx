// @vitest-environment jsdom
/**
 * Keys left behind by an earlier install (L-251).
 *
 * API keys live in the system credential store, which an uninstall from an
 * older installer never cleared and an install never clears. So a fresh install
 * can find keys the person may have forgotten about. The owner's decision: ASK,
 * never delete on our own — once, on a first run with no data, and never again.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { err, ok } from '@cviper/core-types';

import { type SecretKeyName } from '../../status/environment';

import {
  LEFTOVER_KEYS_STORAGE_KEY,
  hasCheckedLeftoverKeys,
  type LeftoverKeysPort,
} from './leftoverKeys';
import { LeftoverKeysNotice } from './LeftoverKeysNotice';
import { expectSpoken } from '../../app/test/spoken';

interface FakePort extends LeftoverKeysPort {
  readonly calls: { found: number; hasData: number };
  readonly removed: SecretKeyName[][];
  failRemove: boolean;
}

function fakePort(found: SecretKeyName[], hasData = false): FakePort {
  const port: FakePort = {
    calls: { found: 0, hasData: 0 },
    removed: [],
    failRemove: false,
    async found() {
      port.calls.found += 1;
      return found;
    },
    async hasData() {
      port.calls.hasData += 1;
      return hasData;
    },
    async remove(keys) {
      if (port.failRemove) return err({ message: 'The credential store is locked.' });
      port.removed.push([...keys]);
      return ok(undefined);
    },
  };
  return port;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => cleanup());

describe('a fresh install that finds keys from an earlier one', () => {
  it('names the providers and offers Keep them / Remove them', async () => {
    render(<LeftoverKeysNotice port={fakePort(['google_api_key'])} />);

    const notice = await screen.findByTestId('leftover-keys');
    expect(notice.textContent).toContain('Google Gemini');
    expect(within(notice).getByRole('button', { name: 'Keep them' })).toBeTruthy();
    expect(within(notice).getByRole('button', { name: 'Remove them' })).toBeTruthy();
    // Shown once: it is marked as asked the moment it appears.
    expect(hasCheckedLeftoverKeys()).toBe(true);
  });

  it('"Remove them" deletes exactly the keys it named, then says so', async () => {
    const user = userEvent.setup();
    const port = fakePort(['google_api_key', 'reed_api_key']);
    render(<LeftoverKeysNotice port={port} />);

    await user.click(await screen.findByRole('button', { name: 'Remove them' }));

    expect(port.removed).toEqual([['google_api_key', 'reed_api_key']]);
    const done = await screen.findByTestId('leftover-keys-done');
    expect(done.textContent).toContain('removed');
    // Read out by a screen reader, from a region already on the page (L-238).
    expectSpoken(done, 'Done — those keys are removed from this computer.');
    expect(screen.queryByRole('button', { name: 'Remove them' })).toBeNull();
  });

  it('"Keep them" closes it, deletes nothing, and it never comes back', async () => {
    const user = userEvent.setup();
    const port = fakePort(['openai_api_key']);
    const { unmount } = render(<LeftoverKeysNotice port={port} />);

    await user.click(await screen.findByRole('button', { name: 'Keep them' }));

    expect(screen.queryByTestId('leftover-keys')).toBeNull();
    expect(port.removed).toEqual([]);
    unmount();

    const again = fakePort(['openai_api_key']);
    render(<LeftoverKeysNotice port={again} />);
    await Promise.resolve();
    expect(screen.queryByTestId('leftover-keys')).toBeNull();
    expect(again.calls.found).toBe(0);
  });

  it('negative: a removal that failed is said out loud and the question stays', async () => {
    const user = userEvent.setup();
    const port = fakePort(['google_api_key']);
    port.failRemove = true;
    render(<LeftoverKeysNotice port={port} />);

    await user.click(await screen.findByRole('button', { name: 'Remove them' }));

    expect((await screen.findByRole('alert')).textContent).toContain('locked');
    expect(screen.getByRole('button', { name: 'Remove them' })).toBeTruthy();
  });
});

describe('when it must not appear', () => {
  it('negative: never on a launch with existing data', async () => {
    const port = fakePort(['google_api_key'], true);
    render(<LeftoverKeysNotice port={port} />);

    await vi_waitForChecked();
    expect(screen.queryByTestId('leftover-keys')).toBeNull();
  });

  it('negative: never when there are no keys', async () => {
    render(<LeftoverKeysNotice port={fakePort([])} />);

    await vi_waitForChecked();
    expect(screen.queryByTestId('leftover-keys')).toBeNull();
  });

  it('negative: never once it has been asked, even on an empty install', async () => {
    localStorage.setItem(LEFTOVER_KEYS_STORAGE_KEY, 'checked');
    const port = fakePort(['google_api_key']);
    render(<LeftoverKeysNotice port={port} />);

    await Promise.resolve();
    expect(screen.queryByTestId('leftover-keys')).toBeNull();
    expect(port.calls.found).toBe(0);
  });
});

describe('boundary: what it names', () => {
  it('a job-board key only, with Adzuna’s two parts named once', async () => {
    render(<LeftoverKeysNotice port={fakePort(['adzuna_app_id', 'adzuna_app_key'])} />);

    const notice = await screen.findByTestId('leftover-keys');
    expect(notice.textContent?.match(/Adzuna/g)).toHaveLength(1);
  });

  it('your own AI service', async () => {
    render(<LeftoverKeysNotice port={fakePort(['custom_provider'])} />);

    expect((await screen.findByTestId('leftover-keys')).textContent).toContain(
      'your own AI service',
    );
  });
});

/** Wait until the component has finished deciding (it marks itself checked). */
async function vi_waitForChecked(): Promise<void> {
  for (let attempt = 0; attempt < 50 && !hasCheckedLeftoverKeys(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(hasCheckedLeftoverKeys()).toBe(true);
}

describe('on the welcome', () => {
  it('appears on the first-run welcome, above the three cards', async () => {
    const { Welcome } = await import('./Welcome');
    render(
      <Welcome
        onDismiss={() => undefined}
        detect={() =>
          Promise.resolve({
            ollamaRunning: false,
            ollamaModels: [],
            anthropicKey: false,
            openaiKey: false,
          })
        }
        leftoverKeys={fakePort(['google_api_key'])}
      />,
    );

    const notice = await screen.findByTestId('leftover-keys');
    const firstCard = screen.getByTestId('welcome-card-tracker');
    expect(notice.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // The welcome's one primary button is still the only one.
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
  });
});
