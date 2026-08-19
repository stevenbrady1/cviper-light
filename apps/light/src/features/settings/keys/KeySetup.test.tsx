// @vitest-environment jsdom
/**
 * The key wizard, driven the way a user drives it.
 *
 * ============================================================================
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE
 * ============================================================================
 * A KEY IS NEVER SAVED UNTIL IT HAS BEEN PROVED TO WORK.
 *
 * The failure it prevents is quiet and expensive: a mistyped key sits in the
 * credential store looking configured, the rail shows a teal dot, and the user
 * finds out three days later when a search returns nothing they can explain. So
 * the tests below do not check that a "save" function was called — they look at
 * what is actually in the fake credential store afterwards, and assert it is
 * empty on every failing path.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { err, ok } from '@cviper/core-types';
import { jobApiError } from '@cviper/job-apis';

import {
  createFakeBrowserPort,
  type FakeBrowserPort,
} from '../../../platform/test/fakeBrowserPort';

import { KeySetup } from './KeySetup';
import { MAX_KEY_BYTES } from './model';
import { createFakeKeyPort, rejectedKey, type FakeKeyPort } from './test/fakeKeyPort';

interface Harness {
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly port: FakeKeyPort;
  readonly browser: FakeBrowserPort;
}

function renderKeys(port = createFakeKeyPort()): Harness {
  const user = userEvent.setup();
  const browser = createFakeBrowserPort();
  render(<KeySetup port={port} browser={browser} />);
  return { user, port, browser };
}

/** Fill every box on a card. */
async function fillAdzuna(user: Harness['user'], id: string, key: string): Promise<void> {
  await user.type(screen.getByTestId('key-input-adzuna_app_id'), id);
  await user.type(screen.getByTestId('key-input-adzuna_app_key'), key);
}

afterEach(() => {
  cleanup();
});

describe('what the cards say', () => {
  it('shows one card per board, with Adzuna carrying TWO boxes and Reed one', async () => {
    renderKeys();
    await screen.findByTestId('key-card-adzuna');

    // The bug a single-field Adzuna form guarantees: half a credential, a 401,
    // and a user told their key is wrong when they only filled in one box.
    const adzunaBoxes = screen.getByTestId('key-card-adzuna').querySelectorAll('input');
    expect([...adzunaBoxes].map((box) => box.getAttribute('data-testid'))).toEqual([
      'key-input-adzuna_app_id',
      'key-input-adzuna_app_key',
    ]);

    const reedBoxes = screen.getByTestId('key-card-reed').querySelectorAll('input');
    expect([...reedBoxes].map((box) => box.getAttribute('data-testid'))).toEqual([
      'key-input-reed_api_key',
    ]);
  });

  it('states that each key is free, and states Reed’s real daily limit', async () => {
    renderKeys();
    await screen.findByTestId('key-card-reed');

    const reed = screen.getByTestId('key-card-reed').textContent ?? '';
    expect(reed).toContain('free');
    expect(reed).toContain('100 requests a day');

    const adzuna = screen.getByTestId('key-card-adzuna').textContent ?? '';
    expect(adzuna).toContain('free');
    // No invented number for Adzuna: the allowance depends on the plan.
    expect(adzuna).toContain('depends on the plan');
  });

  it('says the key cannot be shown back, on the card, before anyone relies on it', async () => {
    renderKeys();
    await screen.findByTestId('key-card-reed');

    expect(screen.getByTestId('key-card-reed').textContent ?? '').toContain('cannot show it back');
  });

  it('offers no way to reveal or read back a saved key', async () => {
    renderKeys(createFakeKeyPort({ reed_api_key: 'already-saved' }));
    await screen.findByTestId('key-card-reed');

    // Structural, not cosmetic: `secret_get` is not a Tauri command, so there
    // is nothing a reveal button could call. What is asserted here is that the
    // UI does not pretend otherwise, and that the value never reaches the DOM.
    const card = screen.getByTestId('key-card-reed');
    expect(card.textContent ?? '').not.toContain('already-saved');
    expect((screen.getByTestId('key-input-reed_api_key') as HTMLInputElement).value).toBe('');
    expect(card.querySelectorAll('[data-testid*="reveal"]')).toHaveLength(0);
  });

  it('opens the signup page in the real browser, not in the app', async () => {
    const { user, browser } = renderKeys();
    await screen.findByTestId('key-card-reed');

    await user.click(screen.getByTestId('key-signup-reed'));

    expect(browser.opened()).toEqual(['https://www.reed.co.uk/developers/jobseeker']);
  });
});

describe('what state this machine is in', () => {
  it('reads "not set up" when nothing is saved — which is not an error', async () => {
    renderKeys();

    const pill = await screen.findByTestId('key-state-reed');
    expect(pill.getAttribute('data-state')).toBe('missing');
    // A machine with no keys is the default, not a fault. Nothing shouts.
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('reads "key saved" when the credential store has everything', async () => {
    renderKeys(createFakeKeyPort({ adzuna_app_id: 'id', adzuna_app_key: 'key' }));

    const pill = await screen.findByTestId('key-state-adzuna');
    expect(pill.getAttribute('data-state')).toBe('configured');
  });

  it('reads ONE Adzuna credential of two as half set up, and names the missing one', async () => {
    // The state that would otherwise be reported as "missing" — telling somebody
    // who has just pasted an App ID that nothing happened.
    renderKeys(createFakeKeyPort({ adzuna_app_id: 'id' }));

    const pill = await screen.findByTestId('key-state-adzuna');
    expect(pill.getAttribute('data-state')).toBe('incomplete');

    const missing = await screen.findByTestId('key-missing-adzuna');
    expect(missing.textContent ?? '').toContain('App Key');
    // And what to do about it, given nothing can be read back.
    expect(missing.textContent ?? '').toContain('both');
  });

  it('reads a locked credential store as unreadable, never as empty', async () => {
    const port = createFakeKeyPort({ reed_api_key: 'saved' });
    port.makeUnreadable('reed_api_key');
    renderKeys(port);

    const pill = await screen.findByTestId('key-state-reed');
    expect(pill.getAttribute('data-state')).toBe('unreadable');
  });
});

describe('testing before saving', () => {
  it('saves both Adzuna credentials only after the board has answered', async () => {
    const { user, port } = renderKeys();
    await screen.findByTestId('key-card-adzuna');

    await fillAdzuna(user, 'the-id', 'the-key');
    expect(port.saved()).toEqual({});

    await user.click(screen.getByTestId('key-test-adzuna'));
    await screen.findByTestId('key-result-adzuna');

    // The order is the feature: tested first, and only then written.
    expect(port.calls.test).toBe(1);
    expect(port.saved()).toEqual({ adzuna_app_id: 'the-id', adzuna_app_key: 'the-key' });
    expect(screen.getByTestId('key-result-adzuna').textContent ?? '').toContain('saved');
  });

  it('sends what the user typed to the board, both values together', async () => {
    const { user, port } = renderKeys();
    await screen.findByTestId('key-card-adzuna');

    await fillAdzuna(user, 'the-id', 'the-key');
    await user.click(screen.getByTestId('key-test-adzuna'));
    await screen.findByTestId('key-result-adzuna');

    expect(port.tested()).toEqual([
      { provider: 'adzuna', values: { adzuna_app_id: 'the-id', adzuna_app_key: 'the-key' } },
    ]);
  });

  it('clears the boxes once the key is in the credential store', async () => {
    const { user } = renderKeys();
    await screen.findByTestId('key-card-reed');

    await user.type(screen.getByTestId('key-input-reed_api_key'), 'the-key');
    await user.click(screen.getByTestId('key-test-reed'));
    await screen.findByTestId('key-result-reed');

    // There is no reason for the value to stay in the DOM after it is saved,
    // and one good reason for it not to.
    expect((screen.getByTestId('key-input-reed_api_key') as HTMLInputElement).value).toBe('');
    expect((await screen.findByTestId('key-state-reed')).getAttribute('data-state')).toBe(
      'configured',
    );
  });

  it('boundary: a key that found no adverts is still a pass', async () => {
    // 200, a well-formed body, zero results. The key works; the one-result
    // probe simply matched nothing. Calling that a failure would send the user
    // back to re-paste a working key.
    const port = createFakeKeyPort();
    port.nextTest(ok(0));
    const { user } = renderKeys(port);
    await screen.findByTestId('key-card-reed');

    await user.type(screen.getByTestId('key-input-reed_api_key'), 'the-key');
    await user.click(screen.getByTestId('key-test-reed'));

    await screen.findByTestId('key-result-reed');
    expect(port.saved()).toEqual({ reed_api_key: 'the-key' });
  });
});

describe('a test that fails saves nothing', () => {
  it('negative: a rejected key is reported and NOT written to the store', async () => {
    const port = createFakeKeyPort();
    port.nextTest(rejectedKey('reed'));
    const { user } = renderKeys(port);
    await screen.findByTestId('key-card-reed');

    await user.type(screen.getByTestId('key-input-reed_api_key'), 'mistyped');
    await user.click(screen.getByTestId('key-test-reed'));

    const problem = await screen.findByTestId('key-problem-reed');
    expect(problem.textContent ?? '').toContain('refused');
    // The assertion that matters. Not "save was not called" — nothing is there.
    expect(port.saved()).toEqual({});
    expect(port.calls.save).toBe(0);
    expect(screen.queryByTestId('key-result-reed')).toBeNull();
  });

  it('negative: a network failure reads as a connection problem, not a bad key', async () => {
    const port = createFakeKeyPort();
    port.nextTest(
      err(jobApiError('reed', 'network', 'Could not reach Reed. Check your connection.')),
    );
    const { user } = renderKeys(port);
    await screen.findByTestId('key-card-reed');

    await user.type(screen.getByTestId('key-input-reed_api_key'), 'probably-fine');
    await user.click(screen.getByTestId('key-test-reed'));

    const problem = await screen.findByTestId('key-problem-reed');
    expect(problem.textContent ?? '').toContain('could not reach');
    expect(problem.textContent ?? '').not.toContain('refused');
    expect(port.saved()).toEqual({});
  });

  it('negative: a rate limit says to wait, and does not blame the key', async () => {
    const port = createFakeKeyPort();
    port.nextTest(err(jobApiError('adzuna', 'rate-limit', 'Slow down.', 429)));
    const { user } = renderKeys(port);
    await screen.findByTestId('key-card-adzuna');

    await fillAdzuna(user, 'the-id', 'the-key');
    await user.click(screen.getByTestId('key-test-adzuna'));

    const problem = await screen.findByTestId('key-problem-adzuna');
    expect(problem.textContent ?? '').toContain('too many requests');
    expect(port.saved()).toEqual({});
  });

  it('negative: an empty box is caught here, without spending a request', async () => {
    const { user, port } = renderKeys();
    await screen.findByTestId('key-card-adzuna');

    // Only the App ID. Reed's tier is 100 a day; finding out that a form is
    // half filled in should not cost one of them.
    await user.type(screen.getByTestId('key-input-adzuna_app_id'), 'the-id');
    await user.click(screen.getByTestId('key-test-adzuna'));

    expect((await screen.findByTestId('key-error-adzuna_app_key')).textContent ?? '').toContain(
      'App Key',
    );
    expect(port.calls.test).toBe(0);
    expect(port.saved()).toEqual({});
  });

  it('boundary: a key one byte over the limit is refused before it is sent', async () => {
    const { user, port } = renderKeys();
    await screen.findByTestId('key-card-reed');

    // `paste` rather than `type`: a thousand keystrokes is a slow test, and a
    // key this long only ever arrives by paste anyway.
    const input = screen.getByTestId('key-input-reed_api_key');
    input.focus();
    await user.paste('k'.repeat(MAX_KEY_BYTES + 1));
    await user.click(screen.getByTestId('key-test-reed'));

    expect((await screen.findByTestId('key-error-reed_api_key')).textContent ?? '').toContain(
      'too long',
    );
    expect(port.calls.test).toBe(0);
  });

  it('negative: a key that worked but could not be stored says exactly that', async () => {
    const port = createFakeKeyPort();
    port.failNext('save');
    const { user } = renderKeys(port);
    await screen.findByTestId('key-card-reed');

    await user.type(screen.getByTestId('key-input-reed_api_key'), 'the-key');
    await user.click(screen.getByTestId('key-test-reed'));

    const problem = await screen.findByTestId('key-problem-reed');
    // Two different failures with two different fixes. Reporting a locked
    // keychain as "your key was refused" sends the user to re-read their key.
    expect(problem.textContent ?? '').toContain('worked');
    expect(problem.textContent ?? '').toContain('credential store');
    expect(port.saved()).toEqual({});
  });
});

describe('removing a key', () => {
  it('removes every credential the board needs and says nothing is saved now', async () => {
    const port = createFakeKeyPort({ adzuna_app_id: 'id', adzuna_app_key: 'key' });
    const { user } = renderKeys(port);
    await screen.findByTestId('key-card-adzuna');

    await user.click(screen.getByTestId('key-remove-adzuna'));

    await screen.findByTestId('key-result-adzuna');
    expect(port.saved()).toEqual({});
    expect((await screen.findByTestId('key-state-adzuna')).getAttribute('data-state')).toBe(
      'missing',
    );
  });

  it('offers nothing to remove when there is nothing saved', async () => {
    renderKeys();

    const remove = (await screen.findByTestId('key-remove-reed')) as HTMLButtonElement;
    // Disabled, never hidden: a control that comes and goes is one the user
    // cannot learn.
    expect(remove.disabled).toBe(true);
  });

  it('negative: a removal that failed is reported rather than assumed', async () => {
    const port = createFakeKeyPort({ reed_api_key: 'saved' });
    port.failNext('remove');
    const { user } = renderKeys(port);
    await screen.findByTestId('key-card-reed');

    await user.click(screen.getByTestId('key-remove-reed'));

    expect((await screen.findByTestId('key-problem-reed')).textContent ?? '').toContain('locked');
    expect(port.saved()).toEqual({ reed_api_key: 'saved' });
  });
});

describe('the wizard never claims a primary action', () => {
  it('renders no primary button — Settings already has one', async () => {
    renderKeys();
    await screen.findByTestId('key-card-reed');

    // Blue means "this is the thing this screen is for", and there are two
    // boards here. Two blue buttons would mean neither is primary.
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(0);
  });
});
