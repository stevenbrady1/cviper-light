// @vitest-environment jsdom
/**
 * L-337: Guardian Jobs closed on 2 Sep 2026 and its board link went from
 * `job-boards.json`. People who used the app before that still have the id
 * `guardian` stored in three places, and none of them may break:
 *
 *   * the ticked boards (`cviper.light.searchBoards`, boardChoice.ts),
 *   * a saved search's boards (L-309, savedSearches.ts),
 *   * Settings → Job boards' order and switched-off lists (boards/model.ts).
 *
 * A stale id is ignored: never offered, never opened, never counted in
 * "Also open in N boards", and the user's other ticks are kept.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyQuota, type JobProviderId } from '@cviper/job-apis';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';
import { SHIPPED_BOARDS } from '../boards/defaults';
import { NO_PREFERENCES, mergeBoards, type BoardPreferences } from '../boards/model';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';

import { BOARD_CHOICE_STORAGE_KEY } from './boardChoice';
import { EMPTY_FORM } from './model';
import { SAVED_SEARCHES_STORAGE_KEY, type SavedSearch } from './savedSearches';
import { Search } from './Search';
import { createFakeSearchPort, outcomeOf } from './test/fakeSearchPort';

const NOW = new Date('2026-10-30T09:00:00.000Z');
const TODAY = '2026-10-30';
const BOTH_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'configured', reed: 'configured' };

function renderSearch(options: { prefs?: BoardPreferences } = {}) {
  const user = userEvent.setup();
  const port = createFakeSearchPort();
  port.nextOutcome(outcomeOf([], emptyQuota(TODAY)));
  const browser = createFakeBrowserPort();
  const utils = render(
    <Search
      port={port}
      browser={browser}
      boardsPort={createFakeBoardPort(options.prefs ?? NO_PREFERENCES)}
      readKeyStates={async () => BOTH_KEYS}
      now={NOW}
      newId={() => 'generated'}
      onOpenSettings={vi.fn()}
    />,
  );
  return { user, port, browser, ...utils };
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('a stored "guardian" tick, after the board was retired', () => {
  it('negative: ["guardian","linkedin"] counts one board and opens only LinkedIn', async () => {
    localStorage.setItem(BOARD_CHOICE_STORAGE_KEY, JSON.stringify(['guardian', 'linkedin']));
    const { user, browser } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await vi.waitFor(() =>
      expect(screen.getByTestId('search-open-boards').textContent).toBe('Also open in 1 board'),
    );
    // Never offered, even with every board on show.
    await user.click(screen.getByTestId('keyless-more'));
    expect(screen.queryByTestId('keyless-guardian')).toBeNull();
    // The other tick is kept.
    expect((screen.getByTestId('keyless-linkedin') as HTMLInputElement).checked).toBe(true);

    await user.type(screen.getByTestId('search-keywords'), 'analyst');
    await user.click(screen.getByTestId('search-open-boards'));
    await vi.waitFor(() => expect(browser.opened()).toHaveLength(1));
    expect(browser.opened()[0]).toMatch(/^https:\/\/www\.linkedin\.com\//);
    expect(browser.opened().some((url) => url.includes('theguardian'))).toBe(false);
  });

  it('boundary: ["guardian"] alone is nothing ticked — Also open is disabled and says why', async () => {
    localStorage.setItem(BOARD_CHOICE_STORAGE_KEY, JSON.stringify(['guardian']));
    renderSearch();
    await screen.findByTestId('keyless-bar');
    const open = screen.getByTestId('search-open-boards') as HTMLButtonElement;
    await vi.waitFor(() => expect(open.textContent).toBe('Also open in job boards'));
    expect(open.disabled).toBe(true);
    expect(screen.getByTestId('search-open-boards-reason').textContent).toBe(
      'Tick a job board above to open this search in your browser too.',
    );
  });
});

describe('a saved search that ticked Guardian Jobs', () => {
  const SAVED: SavedSearch = {
    id: 'saved-guardian',
    name: 'Charity jobs',
    form: { ...EMPTY_FORM, keywords: 'fundraiser', location: 'Leeds' },
    boards: ['guardian', 'reed'],
  };

  it('runs without error and opens only its other boards', async () => {
    localStorage.setItem(SAVED_SEARCHES_STORAGE_KEY, JSON.stringify([SAVED]));
    const { user, port, browser } = renderSearch();
    await user.click(await screen.findByRole('button', { name: 'Run saved search: Charity jobs' }));

    await vi.waitFor(() => expect(port.calls.search).toBe(1));
    await vi.waitFor(() =>
      expect(browser.opened()).toEqual(['https://www.reed.co.uk/jobs/fundraiser-jobs-in-Leeds']),
    );
    expect(screen.getByTestId('search-open-boards').textContent).toBe('Also open in 1 board');
    expect(screen.queryByTestId('search-boards-problem')).toBeNull();
    // What is remembered now is the board that still exists.
    expect(localStorage.getItem(BOARD_CHOICE_STORAGE_KEY)).toBe('["reed"]');
  });
});

describe('Settings → Job boards preferences that name "guardian"', () => {
  it('a stale order and switched-off entry are ignored; every other choice holds', () => {
    const boards = mergeBoards(SHIPPED_BOARDS, {
      ...NO_PREFERENCES,
      order: ['guardian', 'reed', 'indeed'],
      disabled: ['guardian', 'totaljobs'],
    });
    expect(boards.some((board) => board.id === 'guardian')).toBe(false);
    expect(boards.slice(0, 2).map((board) => board.id)).toEqual(['reed', 'indeed']);
    expect(boards.find((board) => board.id === 'totaljobs')?.enabled).toBe(false);
    expect(boards).toHaveLength(SHIPPED_BOARDS.length);
  });
});
