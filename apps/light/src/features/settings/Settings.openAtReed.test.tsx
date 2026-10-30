// @vitest-environment jsdom
/**
 * L-338: Settings opened from Search's "Get a free Reed key" opens the folded
 * job-board keys and lands on the Reed card — scrolled to within the screen's
 * own scroll area, focus on the card's own "Get a free Reed key" button —
 * once, and only when asked.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeBoardPort } from '../boards/test/fakeBoardPort';
import { createFakeFilePort } from '../../platform/test/fakeFilePort';

import { createFakeKeyPort } from './keys/test/fakeKeyPort';
import { Settings, type SettingsProps } from './Settings';
import { createFakeBackupPort } from './test/fakePort';

const NOW = new Date('2026-08-19T09:00:00.000Z');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSettings(props: Pick<SettingsProps, 'openAt' | 'onOpened'>) {
  // jsdom has no element scrolling. Record who is asked to scroll, and that
  // the window never is (L-216).
  const scrolled = vi.fn();
  HTMLElement.prototype.scrollTo = scrolled as unknown as HTMLElement['scrollTo'];
  const windowScrolled = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  const ports = {
    port: createFakeBackupPort(),
    filePort: createFakeFilePort(),
    boardsPort: createFakeBoardPort(),
    keyPort: createFakeKeyPort(),
  };
  const { rerender } = render(<Settings {...ports} now={NOW} {...props} />);
  const again = (next: Pick<SettingsProps, 'openAt' | 'onOpened'>) =>
    rerender(<Settings {...ports} now={NOW} {...next} />);
  return { scrolled, windowScrolled, focus, again };
}

function advanced(): HTMLDetailsElement {
  return screen.getByTestId('settings-advanced') as HTMLDetailsElement;
}

describe('Settings opened at the Reed key', () => {
  it('opens the job-board keys, scrolls to the Reed card, focuses its signup button, and says so', async () => {
    const onOpened = vi.fn();
    const { scrolled, windowScrolled, focus } = renderSettings({ openAt: 'reed-key', onOpened });
    const card = await screen.findByTestId('key-card-reed');

    expect(advanced().open).toBe(true);
    expect(advanced().contains(card)).toBe(true);
    const signup = screen.getByTestId('key-signup-reed');
    expect(card.contains(signup)).toBe(true);
    await vi.waitFor(() => expect(document.activeElement).toBe(signup));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    // The screen's own scroll area moves, to the Reed card — never the window.
    const area = scrolled.mock.contexts[0] as HTMLElement | undefined;
    expect(area?.contains(card)).toBe(true);
    expect(area?.className).toContain('overflow-y-auto');
    expect(windowScrolled).not.toHaveBeenCalled();
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  it('negative: opened normally, the keys stay folded and nothing moves', async () => {
    const onOpened = vi.fn();
    const { scrolled } = renderSettings({ onOpened });
    await screen.findByTestId('key-card-reed');

    expect(advanced().open).toBe(false);
    expect(document.activeElement).not.toBe(screen.getByTestId('key-signup-reed'));
    expect(scrolled).not.toHaveBeenCalled();
    expect(onOpened).not.toHaveBeenCalled();
  });

  it('negative: opened at Job boards, the keys stay folded and the Reed card is not focused', async () => {
    renderSettings({ openAt: 'job-boards', onOpened: vi.fn() });
    const section = await screen.findByTestId('boards-settings');
    await vi.waitFor(() => expect(document.activeElement).toBe(section));

    expect(advanced().open).toBe(false);
    expect(document.activeElement).not.toBe(screen.getByTestId('key-signup-reed'));
  });

  it('boundary: once the shell forgets the request, a re-render neither refolds, reopens nor refocuses', async () => {
    const onOpened = vi.fn();
    const { again, scrolled } = renderSettings({ openAt: 'reed-key', onOpened });
    const signup = await screen.findByTestId('key-signup-reed');
    await vi.waitFor(() => expect(document.activeElement).toBe(signup));
    // The user folds the keys away again by hand, and moves on.
    advanced().open = false;
    signup.blur();
    const scrolls = scrolled.mock.calls.length;

    // The shell has cleared the request, as App does on `onOpened`.
    again({ onOpened });
    await screen.findByTestId('key-card-reed');

    expect(advanced().open).toBe(false);
    expect(document.activeElement).not.toBe(signup);
    expect(scrolled.mock.calls.length).toBe(scrolls);
    expect(onOpened).toHaveBeenCalledTimes(1);
  });
});
