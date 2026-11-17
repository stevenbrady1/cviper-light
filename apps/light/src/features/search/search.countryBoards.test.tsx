// @vitest-environment jsdom
/**
 * L-422: the job boards Search offers are the chosen country's.
 *
 * The United Kingdom's are the nine it always had. Every other country gets
 * LinkedIn, its own Indeed, and Adzuna's site and Google Jobs where the address
 * was proved (`boards/shippedBoards.proved.contract.test.ts`).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyQuota, type JobProviderId } from '@cviper/job-apis';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';
import { NO_PREFERENCES, type BoardPreferences } from '../boards/model';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';

import { BOARD_CHOICE_STORAGE_KEY } from './boardChoice';
import { COUNTRY_NOT_CHOSEN, COUNTRY_STORAGE_KEY } from './country';
import { EMPTY_FORM } from './model';
import { SAVED_SEARCHES_STORAGE_KEY, type SavedSearch } from './savedSearches';
import { Search } from './Search';
import { createFakeSearchPort, outcomeOf } from './test/fakeSearchPort';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };

/** Copied from main on 17 November 2026, before this change. */
const UK_NINE = [
  'linkedin',
  'indeed',
  'totaljobs',
  'cv-library',
  'reed',
  'adzuna',
  'google-jobs',
  'jobserve',
  'gov-uk-find-a-job',
];

const MY_BOARD = {
  id: 'custom-my-board',
  label: 'My Board',
  urlTemplate: 'https://my-board.invalid/search?q={keyword}&where={location}',
  encoding: 'plus' as const,
};

function renderSearch(prefs: BoardPreferences = NO_PREFERENCES) {
  const user = userEvent.setup();
  const port = createFakeSearchPort();
  port.nextOutcome(outcomeOf([], emptyQuota('2026-08-19')));
  const browser = createFakeBrowserPort();
  render(
    <Search
      port={port}
      browser={browser}
      boardsPort={createFakeBoardPort(prefs)}
      readKeyStates={async () => NO_KEYS}
      now={NOW}
      newId={() => 'generated'}
      onOpenSettings={vi.fn()}
    />,
  );
  return { user, port, browser };
}

/** Every board the "Where to look" list offers, in order, with the fold of extra boards open. */
async function offered(user: ReturnType<typeof userEvent.setup>): Promise<string[]> {
  const list = await screen.findByTestId('keyless-boards');
  const more = screen.queryByTestId('keyless-more');
  if (more !== null && more.getAttribute('aria-expanded') === 'false') await user.click(more);
  return [...list.querySelectorAll('input[data-board]')].map(
    (box) => box.getAttribute('data-board') ?? '',
  );
}

function seed(country: string) {
  localStorage.setItem(COUNTRY_STORAGE_KEY, country);
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('the boards Search offers', () => {
  it('United Kingdom: exactly the nine it always had, in the same order', async () => {
    seed('gb');
    const { user } = renderSearch();
    expect(await offered(user)).toEqual(UK_NINE);
  });

  it('Germany: LinkedIn, Indeed, Adzuna and Google Jobs for Germany, and no UK board', async () => {
    seed('de');
    const { user } = renderSearch();
    expect(await offered(user)).toEqual(['linkedin', 'indeed-de', 'adzuna-de', 'google-jobs-de']);
  });

  it('Canada: no Adzuna site, because its address was not proved', async () => {
    seed('ca');
    const { user } = renderSearch();
    expect(await offered(user)).toEqual(['linkedin', 'indeed-ca', 'google-jobs-ca']);
  });

  it('boundary: “Another country” is offered only the board that works everywhere', async () => {
    seed('other');
    const { user } = renderSearch();
    expect(await offered(user)).toEqual(['linkedin']);
  });

  it('boundary: before a country is chosen, only that board is listed, and it waits', async () => {
    seed(COUNTRY_NOT_CHOSEN);
    const { user } = renderSearch();
    expect(await offered(user)).toEqual(['linkedin']);
    expect((screen.getByTestId('keyless-linkedin') as HTMLInputElement).disabled).toBe(true);
  });

  it('a board the person added themselves is offered in every country', async () => {
    seed('de');
    const { user } = renderSearch({ ...NO_PREFERENCES, custom: [MY_BOARD] });
    expect(await offered(user)).toContain(MY_BOARD.id);
  });

  it('changing the country changes the list at once', async () => {
    seed('gb');
    const { user } = renderSearch();
    expect(await offered(user)).toEqual(UK_NINE);

    fireEvent.change(screen.getByTestId('search-country'), { target: { value: 'ca' } });

    expect(await offered(user)).toEqual(['linkedin', 'indeed-ca', 'google-jobs-ca']);
  });
});

describe('opening the boards', () => {
  it('Germany: Indeed opens Germany’s own site, with the distance in kilometres', async () => {
    seed('de');
    const { user, browser } = renderSearch();
    await offered(user);

    await user.type(screen.getByTestId('search-keywords'), 'data analyst');
    await user.type(screen.getByTestId('search-location'), 'Berlin');
    await user.type(screen.getByTestId('search-distance'), '20');
    await user.click(screen.getByTestId('keyless-indeed-de'));
    await user.click(screen.getByTestId('keyless-adzuna-de'));
    await user.click(screen.getByTestId('search-open-boards'));

    await vi.waitFor(() =>
      expect(browser.opened()).toEqual([
        'https://de.indeed.com/jobs?q=data+analyst&l=Berlin&radius=25',
        'https://www.adzuna.de/search?q=data+analyst&w=Berlin',
      ]),
    );
  });

  it('negative: a tick made for the UK’s Indeed is not a tick on Germany’s', async () => {
    seed('de');
    localStorage.setItem(BOARD_CHOICE_STORAGE_KEY, JSON.stringify(['indeed', 'reed']));
    const { user } = renderSearch();
    await offered(user);

    expect((screen.getByTestId('keyless-indeed-de') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId('search-open-boards').textContent).toBe('Also open in job boards');
  });
});

describe('a saved search runs with the boards of the country it was saved for', () => {
  const GERMAN: SavedSearch = {
    id: 'saved-de',
    name: 'Berlin data',
    form: { ...EMPTY_FORM, keywords: 'data analyst', location: 'Berlin' },
    boards: ['indeed-de', 'reed'],
    country: 'de',
  };
  const BRITISH: SavedSearch = {
    id: 'saved-gb',
    name: 'Leeds data',
    form: { ...EMPTY_FORM, keywords: 'data analyst', location: 'Leeds' },
    boards: ['reed'],
  };

  it('a German search run from a UK screen opens Germany’s Indeed, and drops the UK board it names', async () => {
    seed('gb');
    localStorage.setItem(SAVED_SEARCHES_STORAGE_KEY, JSON.stringify([GERMAN]));
    const { user, browser } = renderSearch();

    await user.click(await screen.findByRole('button', { name: 'Run saved search: Berlin data' }));

    await vi.waitFor(() =>
      expect(browser.opened()).toEqual(['https://de.indeed.com/jobs?q=data+analyst&l=Berlin']),
    );
    expect((screen.getByTestId('search-country') as HTMLSelectElement).value).toBe('de');
    expect(localStorage.getItem(BOARD_CHOICE_STORAGE_KEY)).toBe('["indeed-de"]');
    expect(screen.queryByTestId('search-boards-problem')).toBeNull();
  });

  it('a UK search saved before countries existed, run from a German screen, still opens Reed', async () => {
    seed('de');
    localStorage.setItem(SAVED_SEARCHES_STORAGE_KEY, JSON.stringify([BRITISH]));
    const { user, browser } = renderSearch();

    await user.click(await screen.findByRole('button', { name: 'Run saved search: Leeds data' }));

    await vi.waitFor(() =>
      expect(browser.opened()).toEqual(['https://www.reed.co.uk/jobs/data-analyst-jobs-in-Leeds']),
    );
    expect((screen.getByTestId('search-country') as HTMLSelectElement).value).toBe('gb');
  });
});
