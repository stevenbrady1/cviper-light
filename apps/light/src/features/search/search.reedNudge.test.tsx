// @vitest-environment jsdom
/**
 * L-338 — a UK location with no job-board key has no in-app source since
 * Guardian Jobs closed (L-336), so Search is grey and the reason beside it
 * names the free Reed key. That reason now carries its own one-press fix:
 * "Get a free Reed key", which hands the user to Settings at the Reed card.
 *
 * The rule the cases below pin: the Reed button appears exactly when the Reed
 * reason does — never beside another reason, never beside an enabled Search.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyQuota, type JobProviderId } from '@cviper/job-apis';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';
import { NO_PREFERENCES } from '../boards/model';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';
import { keyProvider } from '../settings/keys/model';

import { FEED_CHOICE_KEY } from './feedDefaults';
import { Search } from './Search';
import { createFakeSearchPort, outcomeOf } from './test/fakeSearchPort';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };
const REED_KEY: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'configured' };
const REED_LABEL = 'Get a free Reed key';

async function renderSearch(location: string, keys: Record<JobProviderId, KeyState> = NO_KEYS) {
  const user = userEvent.setup();
  const port = createFakeSearchPort();
  port.nextOutcome(outcomeOf([], emptyQuota('2026-08-19')));
  const onOpenReedKey = vi.fn();
  const onOpenSettings = vi.fn();
  render(
    <Search
      port={port}
      browser={createFakeBrowserPort()}
      boardsPort={createFakeBoardPort(NO_PREFERENCES)}
      readKeyStates={async () => keys}
      now={NOW}
      newId={() => 'generated'}
      onOpenSettings={onOpenSettings}
      onOpenReedKey={onOpenReedKey}
    />,
  );
  await screen.findByTestId('keyless-bar');
  if (keys !== NO_KEYS) await screen.findByTestId('provider-reed');
  if (location !== '') await user.type(screen.getByTestId('search-location'), location);
  return { user, port, onOpenReedKey, onOpenSettings };
}

function submit(): HTMLButtonElement {
  return screen.getByTestId('search-submit') as HTMLButtonElement;
}

function reedButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: REED_LABEL });
}

/** The Reed button is shown if, and only if, the reason shown names Reed. */
function expectButtonMatchesReason() {
  const reason = screen.queryByTestId('search-reason')?.textContent ?? null;
  const namesReed = reason !== null && reason.includes('Reed key');
  expect(reedButton() !== null).toBe(namesReed);
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('"Get a free Reed key" beside the grey Search for the UK (L-338)', () => {
  it('the label is the Reed card’s own, not a second copy', () => {
    expect(keyProvider('reed').signupLabel).toBe(REED_LABEL);
  });

  it('happy: London, no key — the button sits beside Search, with the Reed reason', async () => {
    await renderSearch('London');

    expect(submit().disabled).toBe(true);
    const fix = reedButton();
    expect(fix).not.toBeNull();
    expect(fix?.getAttribute('type')).toBe('button');
    expect(screen.getByTestId('search-reason-area').contains(fix)).toBe(true);
    expect(screen.getByTestId('search-reason').textContent).toContain('A free Reed key');
    // Not a feed tick: the L-336 guard "no tick button for the UK" still holds.
    expect(screen.queryByTestId('search-tick-feeds')).toBeNull();
    expectButtonMatchesReason();
  });

  it('interaction: pressing it asks the shell for the Reed key, and searches nothing', async () => {
    const { user, port, onOpenReedKey, onOpenSettings } = await renderSearch('London');

    await user.click(reedButton() as HTMLElement);

    expect(onOpenReedKey).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).not.toHaveBeenCalled();
    expect(port.calls.search).toBe(0);
    expect(port.calls.browseKeyless).toBe(0);
  });

  it('negative: a Reed key is set — Search is enabled and there is no Reed button', async () => {
    await renderSearch('London', REED_KEY);

    expect(submit().disabled).toBe(false);
    expect(screen.queryByTestId('search-reason')).toBeNull();
    expect(reedButton()).toBeNull();
  });

  it('negative: Berlin with nothing ticked — the fix is "Tick Arbeitnow", not the Reed one', async () => {
    localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ arbeitnow: false }));
    await renderSearch('Berlin');

    expect(submit().disabled).toBe(true);
    expect(screen.getByTestId('search-tick-feeds').textContent).toBe('Tick Arbeitnow');
    expect(reedButton()).toBeNull();
    expectButtonMatchesReason();
  });

  it.each([[''], ['   ']] as const)(
    'boundary: location "%s" (blank) — not the UK, so never the Reed button',
    async (location) => {
      await renderSearch(location);
      // Arbeitnow is on by default away from the UK: Search can be pressed.
      expect(submit().disabled).toBe(false);
      expect(reedButton()).toBeNull();
      expectButtonMatchesReason();
    },
  );

  it.each([[''], ['   ']] as const)(
    'boundary: location "%s" with Arbeitnow unticked — the Tick fix, never the Reed one',
    async (location) => {
      localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ arbeitnow: false }));
      await renderSearch(location);

      expect(submit().disabled).toBe(true);
      expect(screen.getByTestId('search-tick-feeds').textContent).toBe('Tick Arbeitnow');
      expect(reedButton()).toBeNull();
      expectButtonMatchesReason();
    },
  );

  it('boundary: London with Arbeitnow ticked by the user — Search enabled, no reason, no Reed button', async () => {
    localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ arbeitnow: true }));
    await renderSearch('London');

    expect(submit().disabled).toBe(false);
    expect(screen.queryByTestId('search-reason')).toBeNull();
    expect(reedButton()).toBeNull();
    expectButtonMatchesReason();
  });
});
