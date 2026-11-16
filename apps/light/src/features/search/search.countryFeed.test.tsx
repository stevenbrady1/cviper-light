// @vitest-environment jsdom
/**
 * The free feed and the Reed hints follow the Country setting (L-419).
 *
 * Search used to guess "is this a UK place?" from the words in Location. It
 * no longer does: a United Kingdom search with a place typed has the free feed
 * off, and every other search has it on.
 *
 * The one change a United Kingdom user can see is the first test: a place
 * outside the UK ("Berlin") in a United Kingdom search now starts with the
 * feed unticked, and one tick turns it on.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type JobProviderId } from '@cviper/job-apis';

import { NO_PREFERENCES } from '../boards/model';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';
import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';

import { COUNTRY_STORAGE_KEY, type CountryChoice } from './country';
import { FEED_CHOICE_KEY } from './feedDefaults';
import { Search } from './Search';
import { SAVED_SEARCHES_STORAGE_KEY } from './savedSearches';
import { createFakeSearchPort, type FakeSearchPort } from './test/fakeSearchPort';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };
const BOTH_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'configured', reed: 'configured' };

const UK_NOTE = 'Off for a UK location. Tick it to include it.';
const REED_REASON =
  'A free Reed key, set up in Settings, adds UK jobs here. ' +
  'Job sites you tick open in your browser with “Also open”.';
const REED_EMPTY = 'A free Reed key, set up in Settings, shows UK adverts here.';

async function renderSearch(
  country: CountryChoice,
  keys: Record<JobProviderId, KeyState> = NO_KEYS,
): Promise<{ user: ReturnType<typeof userEvent.setup>; port: FakeSearchPort }> {
  localStorage.setItem(COUNTRY_STORAGE_KEY, country);
  const user = userEvent.setup();
  const port = createFakeSearchPort();
  render(
    <Search
      port={port}
      browser={createFakeBrowserPort()}
      boardsPort={createFakeBoardPort(NO_PREFERENCES)}
      readKeyStates={async () => keys}
      now={NOW}
      onOpenSettings={vi.fn()}
      onOpenReedKey={vi.fn()}
    />,
  );
  await screen.findByTestId('search-empty');
  (screen.getByTestId('search-where-fold') as HTMLDetailsElement).open = true;
  return { user, port };
}

const feed = () => screen.getByTestId('keyless-source-arbeitnow') as HTMLInputElement;
const submit = () => screen.getByTestId('search-submit') as HTMLButtonElement;
const place = () => screen.getByTestId('search-location') as HTMLInputElement;

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('a United Kingdom search with a place typed: the free feed starts off', () => {
  it.each(['Berlin', 'Skegness', 'London'])(
    'regression: "%s" — unticked, with the note and the Reed reason (the old list knew only London)',
    async (location) => {
      const { user } = await renderSearch('gb');

      await user.type(place(), location);

      expect(feed().checked).toBe(false);
      expect(screen.getByTestId('keyless-arbeitnow-uk').textContent).toBe(UK_NOTE);
      expect(submit().disabled).toBe(true);
      expect(screen.getByTestId('search-reason').textContent).toContain(REED_REASON);
      expect(screen.getByTestId('search-get-reed-key')).toBeTruthy();
      expect(screen.getByTestId('search-empty').textContent).toContain(REED_EMPTY);
    },
  );

  it('happy: one tick turns it on, is remembered, and Search then reads the feed', async () => {
    const { user, port } = await renderSearch('gb');
    await user.type(place(), 'Berlin');

    await user.click(feed());

    expect(feed().checked).toBe(true);
    expect(screen.queryByTestId('keyless-arbeitnow-uk')).toBeNull();
    expect(JSON.parse(localStorage.getItem(FEED_CHOICE_KEY) ?? '{}')).toEqual({ arbeitnow: true });
    expect(submit().disabled).toBe(false);

    await user.click(submit());
    await vi.waitFor(() => expect(port.calls.browseKeyless).toBe(1));
  });
});

describe('a United Kingdom search with no place typed: the free feed stays on', () => {
  it('happy: an empty Location — ticked, no note, no Reed reason, Search can run', async () => {
    await renderSearch('gb');

    expect(feed().checked).toBe(true);
    expect(screen.queryByTestId('keyless-arbeitnow-uk')).toBeNull();
    expect(screen.queryByTestId('search-reason')).toBeNull();
    expect(screen.queryByTestId('search-get-reed-key')).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it('boundary: a place of only spaces counts as no place', async () => {
    const { user } = await renderSearch('gb');

    await user.type(place(), '   ');

    expect(feed().checked).toBe(true);
    expect(screen.queryByTestId('keyless-arbeitnow-uk')).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it('boundary: clearing the place turns the default back on', async () => {
    const { user } = await renderSearch('gb');
    await user.type(place(), 'Leeds');
    expect(feed().checked).toBe(false);

    await user.clear(place());

    expect(feed().checked).toBe(true);
  });
});

describe('any other country: the free feed is on, and Reed is never suggested', () => {
  it.each<[CountryChoice, string]>([
    ['de', 'Berlin'],
    ['us', 'York'],
    ['au', 'Perth'],
    ['other', 'London, UK'],
  ])('negative: a "%s" search of "%s" keeps the feed on', async (country, location) => {
    const { user } = await renderSearch(country);

    await user.type(place(), location);

    expect(feed().checked).toBe(true);
    expect(screen.queryByTestId('keyless-arbeitnow-uk')).toBeNull();
    expect(screen.queryByTestId('search-get-reed-key')).toBeNull();
    expect(screen.queryByText(/free Reed key/)).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it('negative: with the feed unticked by hand, a German user is told to tick it, not to get a Reed key', async () => {
    localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ arbeitnow: false }));
    const { user } = await renderSearch('de');
    await user.type(place(), 'Berlin');

    expect(submit().disabled).toBe(true);
    expect(screen.getByTestId('search-reason').textContent).toContain('Tick the free feed');
    expect(screen.queryByText(/free Reed key/)).toBeNull();
    expect(screen.queryByTestId('search-get-reed-key')).toBeNull();
    expect(screen.getByTestId('search-tick-feeds').textContent).toBe('Tick Arbeitnow');
  });
});

describe('the user’s own tick wins in every country', () => {
  it.each<CountryChoice>(['gb', 'de', 'us', 'other'])(
    'edge: unticked by hand stays unticked in "%s", with or without a place',
    async (country) => {
      localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ arbeitnow: false }));
      const { user } = await renderSearch(country);

      expect(feed().checked).toBe(false);
      await user.type(place(), 'Berlin');
      expect(feed().checked).toBe(false);
      // Their own choice is not "off for a UK location": the note is the default's.
      expect(screen.queryByTestId('keyless-arbeitnow-uk')).toBeNull();
    },
  );

  it.each<CountryChoice>(['gb', 'de', 'us', 'other'])(
    'edge: ticked by hand stays ticked in "%s", with a UK place typed',
    async (country) => {
      localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ arbeitnow: true }));
      const { user } = await renderSearch(country);

      await user.type(place(), 'London');

      expect(feed().checked).toBe(true);
      expect(screen.queryByTestId('keyless-arbeitnow-uk')).toBeNull();
    },
  );
});

describe('a saved search runs with its own country’s rule', () => {
  const FORM = {
    keywords: 'data analyst',
    location: 'Berlin',
    distanceMiles: '',
    salaryMin: '',
    contractType: 'any',
  };

  it('a United Kingdom one naming a place does not read the free feed', async () => {
    localStorage.setItem(
      SAVED_SEARCHES_STORAGE_KEY,
      JSON.stringify([{ id: 'uk', name: 'Berlin from the UK', form: FORM, boards: [] }]),
    );
    const { user, port } = await renderSearch('de', BOTH_KEYS);

    await user.click(screen.getByText('Berlin from the UK'));
    await vi.waitFor(() => expect(port.calls.search).toBe(1));

    expect(port.calls.browseKeyless).toBe(0);
    expect(feed().checked).toBe(false);
  });

  it('a German one naming the same place does', async () => {
    localStorage.setItem(
      SAVED_SEARCHES_STORAGE_KEY,
      JSON.stringify([
        { id: 'de', name: 'Berlin analysts', form: FORM, boards: [], country: 'de' },
      ]),
    );
    const { user, port } = await renderSearch('gb', BOTH_KEYS);

    await user.click(screen.getByText('Berlin analysts'));
    await vi.waitFor(() => expect(port.calls.browseKeyless).toBe(1));

    expect(feed().checked).toBe(true);
  });
});
