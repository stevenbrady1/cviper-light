// @vitest-environment jsdom
/**
 * L-310 (part of L-219): from Search, one button goes to Settings → Job
 * boards, where the user picks which boards appear, their order, and adds
 * their own. Before, the route was a sentence at the bottom of the board bar.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type JobProviderId } from '@cviper/job-apis';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';
import { SHIPPED_BOARDS } from '../boards/defaults';
import { NO_PREFERENCES, type BoardPreferences } from '../boards/model';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';

import { Search } from './Search';
import { createFakeSearchPort } from './test/fakeSearchPort';

const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };

function renderSearch(onOpenJobBoards?: () => void, prefs: BoardPreferences = NO_PREFERENCES) {
  const user = userEvent.setup();
  render(
    <Search
      port={createFakeSearchPort()}
      browser={createFakeBrowserPort()}
      boardsPort={createFakeBoardPort(prefs)}
      readKeyStates={async () => NO_KEYS}
      now={new Date('2026-08-19T09:00:00.000Z')}
      onOpenSettings={vi.fn()}
      onOpenJobBoards={onOpenJobBoards}
    />,
  );
  return { user };
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('Manage job boards', () => {
  it('is a button in the board bar, and pressing it asks the shell for Settings → Job boards', async () => {
    const open = vi.fn();
    const { user } = renderSearch(open);
    const bar = await screen.findByTestId('keyless-bar');
    const button = within(bar).getByRole('button', { name: 'Manage job boards' });

    await user.click(button);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('keyboard: Enter on the focused button does the same', async () => {
    const open = vi.fn();
    const { user } = renderSearch(open);
    (await screen.findByRole('button', { name: 'Manage job boards' })).focus();
    await user.keyboard('{Enter}');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('boundary: with every board switched off, the button is still there, beside the reason', async () => {
    const open = vi.fn();
    const everyBoardOff = { ...NO_PREFERENCES, disabled: SHIPPED_BOARDS.map((board) => board.id) };
    const { user } = renderSearch(open, everyBoardOff);
    await screen.findByTestId('keyless-none');
    await user.click(screen.getByRole('button', { name: 'Manage job boards' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('negative: with nowhere to go, no button is drawn — never one that does nothing', async () => {
    renderSearch(undefined);
    await screen.findByTestId('keyless-bar');
    expect(screen.queryByRole('button', { name: 'Manage job boards' })).toBeNull();
  });
});
