// @vitest-environment jsdom
/**
 * The grey hint in the Location box follows the country (L-423).
 *
 * "e.g. London" is the right example for a United Kingdom search and the wrong
 * one for Germany. Everywhere else the box says what goes in it: a city or town.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type JobProviderId } from '@cviper/job-apis';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';

import { COUNTRY_NOT_CHOSEN, COUNTRY_STORAGE_KEY } from './country';
import { Search } from './Search';
import { createFakeSearchPort } from './test/fakeSearchPort';

const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

async function locationHint(stored: string | null): Promise<string> {
  if (stored !== null) localStorage.setItem(COUNTRY_STORAGE_KEY, stored);
  render(
    <Search
      port={createFakeSearchPort()}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => NO_KEYS}
      now={new Date('2026-11-17T09:00:00.000Z')}
      onOpenSettings={vi.fn()}
    />,
  );
  return (await screen.findByTestId('search-location')).getAttribute('placeholder') ?? '';
}

describe('the Location hint follows the country (L-423)', () => {
  it('happy: the United Kingdom keeps its example', async () => {
    expect(await locationHint('gb')).toBe('e.g. London');
  });

  it.each(['de', 'us', 'other'])('happy: %s says what goes in the box', async (country) => {
    expect(await locationHint(country)).toBe('City or town');
  });

  it.each([
    ['a new install that has not been asked', COUNTRY_NOT_CHOSEN],
    ['nothing stored at all', null],
    ['a stored value that is not a country', 'atlantis'],
  ])('boundary: %s says what goes in the box', async (_name, stored) => {
    expect(await locationHint(stored)).toBe('City or town');
  });

  it('negative: outside the United Kingdom the hint never names London', async () => {
    expect(await locationHint('de')).not.toMatch(/London/i);
  });

  it('changing the country changes the hint at once', async () => {
    const user = userEvent.setup();
    expect(await locationHint('gb')).toBe('e.g. London');
    await user.selectOptions(screen.getByTestId('search-country'), 'de');
    expect(screen.getByTestId('search-location').getAttribute('placeholder')).toBe('City or town');
    await user.selectOptions(screen.getByTestId('search-country'), 'gb');
    expect(screen.getByTestId('search-location').getAttribute('placeholder')).toBe('e.g. London');
  });
});
