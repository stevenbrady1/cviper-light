// @vitest-environment jsdom
/**
 * L-310: Settings opened from Search's "Manage job boards" lands on the Job
 * boards section — scrolled to and focused — once, and only when asked.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeBoardPort } from '../boards/test/fakeBoardPort';
import { createFakeFilePort } from '../../platform/test/fakeFilePort';

import { Settings } from './Settings';
import { createFakeBackupPort } from './test/fakePort';

const NOW = new Date('2026-08-19T09:00:00.000Z');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSettings(props: { openAt?: 'job-boards'; onOpened?: () => void }) {
  // jsdom has no element scrolling. Record who is asked to scroll, and that
  // the window never is (L-216).
  const scrolled = vi.fn();
  HTMLElement.prototype.scrollTo = scrolled as unknown as HTMLElement['scrollTo'];
  const windowScrolled = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  render(
    <Settings
      port={createFakeBackupPort()}
      filePort={createFakeFilePort()}
      boardsPort={createFakeBoardPort()}
      now={NOW}
      {...props}
    />,
  );
  return { scrolled, windowScrolled, focus };
}

describe('Settings opened at Job boards', () => {
  it('moves focus to the Job boards section, scrolls it into view, and says it has', async () => {
    const onOpened = vi.fn();
    const { scrolled, windowScrolled, focus } = renderSettings({ openAt: 'job-boards', onOpened });
    const section = await screen.findByTestId('boards-settings');

    await vi.waitFor(() => expect(document.activeElement).toBe(section));
    // Focus does not scroll on its own; the screen's scroll area does, and
    // only that area: the window is never moved.
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    const area = scrolled.mock.contexts[0] as HTMLElement | undefined;
    expect(area?.contains(section)).toBe(true);
    expect(area?.className).toContain('overflow-y-auto');
    expect(windowScrolled).not.toHaveBeenCalled();
    expect(onOpened).toHaveBeenCalledTimes(1);
    // A focused region is named, so a screen reader says where the user is.
    expect(section.getAttribute('aria-labelledby')).not.toBeNull();
    expect(
      document.getElementById(section.getAttribute('aria-labelledby') ?? '')?.textContent,
    ).toBe('Job boards');
  });

  it('negative: opened normally, focus and scroll are left alone', async () => {
    const onOpened = vi.fn();
    const { scrolled } = renderSettings({ onOpened });
    const section = await screen.findByTestId('boards-settings');
    expect(document.activeElement).not.toBe(section);
    expect(scrolled).not.toHaveBeenCalled();
    expect(onOpened).not.toHaveBeenCalled();
  });
});
