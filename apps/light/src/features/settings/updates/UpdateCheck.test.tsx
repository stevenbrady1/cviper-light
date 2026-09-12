// @vitest-environment jsdom
/**
 * The update section of Settings, driven the way a user drives it.
 *
 * The negative assertions carry most of the weight here: nothing is checked
 * until the button is pressed, and a failed check leaves the user with a
 * sentence they can act on rather than a spinner that stopped.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { UpdateCheck } from './UpdateCheck';
import { AN_UPDATE, UNVERIFIABLE, createFakeUpdatePort } from './test/fakeUpdatePort';

afterEach(() => {
  cleanup();
});

describe('before anything is pressed', () => {
  it('checks nothing when it is merely rendered', async () => {
    const port = createFakeUpdatePort();
    render(<UpdateCheck port={port} version="0.1.0" />);

    await screen.findByTestId('settings-check-updates');
    expect(port.calls.check).toBe(0);
  });

  it('says which of the two things it does, and the note follows the setting', async () => {
    // This used to assert only that the absence of a launch check was stated.
    // There are two behaviours now and the user picks between them (L-92), so
    // the note has to be true of whichever is IN FORCE — a screen saying "never
    // checks on its own" while a launch check was running would teach the
    // reader that nothing else on it can be trusted either.
    const user = userEvent.setup();
    const port = createFakeUpdatePort();
    render(<UpdateCheck port={port} version="0.1.0" />);

    const note = await screen.findByTestId('settings-update-note');
    const toggle = screen.getByTestId('settings-update-on-launch');

    // The default is on, and the note says what that means.
    expect((note.textContent ?? '').toLowerCase()).toContain('once when it starts');

    await user.click(toggle);
    // Switched off, the original sentence is exactly true again.
    expect((note.textContent ?? '').toLowerCase()).toContain('never checks on its own');

    // Put back, so this test leaves no stored preference behind for the next.
    await user.click(toggle);
    expect((note.textContent ?? '').toLowerCase()).toContain('once when it starts');
  });

  it('shows no status line at all until asked', () => {
    render(<UpdateCheck port={createFakeUpdatePort()} version="0.1.0" />);
    expect(screen.queryByTestId('settings-update-status')).toBeNull();
  });
});

describe('pressing check for updates', () => {
  it('says which version you are on when there is nothing newer', async () => {
    const user = userEvent.setup();
    const port = createFakeUpdatePort();
    render(<UpdateCheck port={port} version="0.1.0" />);

    await user.click(screen.getByTestId('settings-check-updates'));

    expect((await screen.findByTestId('settings-update-status')).textContent).toContain('0.1.0');
    expect(port.calls.check).toBe(1);
  });

  it('offers the install once an update is found, naming the version', async () => {
    const user = userEvent.setup();
    const port = createFakeUpdatePort();
    port.nextCheck({ ok: true, value: AN_UPDATE });
    render(<UpdateCheck port={port} version="0.1.0" />);

    await user.click(screen.getByTestId('settings-check-updates'));

    expect((await screen.findByTestId('settings-update-status')).textContent).toContain('0.2.0');
    expect(screen.getByTestId('settings-install-update')).toBeTruthy();
  });

  it('negative: a failed check shows the reason, not a stopped spinner', async () => {
    const user = userEvent.setup();
    const port = createFakeUpdatePort();
    port.nextCheck(UNVERIFIABLE);
    render(<UpdateCheck port={port} version="0.1.0" />);

    await user.click(screen.getByTestId('settings-check-updates'));

    const status = await screen.findByTestId('settings-update-status');
    expect(status.textContent).toContain('verified as genuine');
    // And the button comes back, because trying again is the obvious next move.
    expect(screen.getByTestId('settings-check-updates')).toHaveProperty('disabled', false);
    expect(screen.queryByTestId('settings-install-update')).toBeNull();
  });

  it('boundary: the button is disabled while a check is in flight, never hidden', async () => {
    const user = userEvent.setup();
    let release = (): void => undefined;
    const port = createFakeUpdatePort();
    const slow = {
      ...port,
      check: () =>
        new Promise<Awaited<ReturnType<typeof port.check>>>((resolve) => {
          release = () => resolve({ ok: true, value: null });
        }),
    };

    render(<UpdateCheck port={slow} version="0.1.0" />);
    await user.click(screen.getByTestId('settings-check-updates'));

    // Disabled and still on screen: a control that vanishes mid-action is a
    // control the user cannot learn.
    expect(screen.getByTestId('settings-check-updates')).toHaveProperty('disabled', true);
    release();
    expect((await screen.findByTestId('settings-update-status')).textContent).toContain('0.1.0');
  });
});

describe('installing', () => {
  it('tells the user to restart when the install lands', async () => {
    const user = userEvent.setup();
    const port = createFakeUpdatePort();
    port.nextCheck({ ok: true, value: AN_UPDATE });
    render(<UpdateCheck port={port} version="0.1.0" />);

    await user.click(screen.getByTestId('settings-check-updates'));
    await user.click(await screen.findByTestId('settings-install-update'));

    expect(
      ((await screen.findByTestId('settings-update-status')).textContent ?? '').toLowerCase(),
    ).toContain('restart');
    expect(port.calls.install).toBe(1);
  });

  it('negative: a failed install says so and leaves the app alone', async () => {
    const user = userEvent.setup();
    const port = createFakeUpdatePort();
    port.nextCheck({ ok: true, value: AN_UPDATE });
    port.nextInstall({ ok: false, error: { message: 'The download stopped halfway.' } });
    render(<UpdateCheck port={port} version="0.1.0" />);

    await user.click(screen.getByTestId('settings-check-updates'));
    await user.click(await screen.findByTestId('settings-install-update'));

    expect((await screen.findByTestId('settings-update-status')).textContent).toContain(
      'The download stopped halfway.',
    );
  });
});
