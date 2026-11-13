// @vitest-environment jsdom
/**
 * L-324: a job found on a board that Search opened in the browser has a way
 * back in. One quiet button under "Also open" asks the shell for Tracker with
 * the paste pane open. It runs no search and opens nothing itself.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type JobProviderId } from '@cviper/job-apis';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';

import { Search } from './Search';
import { createFakeSearchPort } from './test/fakeSearchPort';

const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };

function renderSearch(onBringJobIn?: () => void) {
  const user = userEvent.setup();
  const port = createFakeSearchPort();
  const browser = createFakeBrowserPort();
  render(
    <Search
      port={port}
      browser={browser}
      boardsPort={createFakeBoardPort()}
      readKeyStates={async () => NO_KEYS}
      now={new Date('2026-08-19T09:00:00.000Z')}
      onOpenSettings={vi.fn()}
      onBringJobIn={onBringJobIn}
    />,
  );
  return { user, port, browser };
}

const bringIn = () => screen.getByTestId('search-bring-in') as HTMLButtonElement;

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('"Found one? Bring it in"', () => {
  it('pressing it asks the shell once', async () => {
    const open = vi.fn();
    const { user } = renderSearch(open);
    await screen.findByTestId('search-open-boards-row');

    expect(bringIn().textContent).toBe('Found one? Bring it in');
    await user.click(bringIn());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('negative: it is type=button — the form is not submitted and no search is spent', async () => {
    const open = vi.fn();
    const { user, port, browser } = renderSearch(open);
    const submit = (await screen.findByTestId('search-submit')) as HTMLButtonElement;
    // The form could be sent right now, so a submit button here WOULD search.
    await vi.waitFor(() => expect(submit.disabled).toBe(false));
    const submitted = vi.fn((event: Event) => event.preventDefault());
    submit.form?.addEventListener('submit', submitted);

    expect(bringIn().getAttribute('type')).toBe('button');
    await user.click(bringIn());

    expect(submitted).not.toHaveBeenCalled();
    expect(port.calls.search).toBe(0);
    expect(port.calls.browseKeyless).toBe(0);
    expect(browser.opened()).toEqual([]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('boundary: no board ticked — still there and enabled', async () => {
    const open = vi.fn();
    const { user } = renderSearch(open);
    await screen.findByTestId('keyless-bar');
    // Nothing ticked: "Also open" is disabled with its reason…
    expect((screen.getByTestId('search-open-boards') as HTMLButtonElement).disabled).toBe(true);
    // …but a board can be opened other ways, so the way back stays usable.
    expect(bringIn().disabled).toBe(false);
    expect(bringIn().hasAttribute('data-primary')).toBe(false);
    await user.click(bringIn());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('negative: with no handler, nothing is drawn — never a button that does nothing', async () => {
    renderSearch(undefined);
    await screen.findByTestId('search-open-boards-row');
    expect(screen.queryByTestId('search-bring-in')).toBeNull();
    expect(screen.queryByText('Found one? Bring it in')).toBeNull();
  });
});
