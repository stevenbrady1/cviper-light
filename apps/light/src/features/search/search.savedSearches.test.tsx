// @vitest-environment jsdom
/**
 * L-309 (part of L-219): saved searches on the Search screen.
 *
 *   * "Save this search" names the form and the ticked boards and keeps them.
 *   * One click on a saved search fills the boxes, ticks its boards and runs
 *     Search — the same deliberate press as the Search button.
 *   * Each has its own delete button. None of it touches a search on its own.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyQuota, type JobProviderId } from '@cviper/job-apis';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';
import { NO_PREFERENCES, type BoardPreferences } from '../boards/model';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';

import { EMPTY_FORM } from './model';
import {
  MAX_SAVED_NAME_CHARS,
  MAX_SAVED_SEARCHES,
  SAVED_SEARCHES_STORAGE_KEY,
  readSavedSearches,
  type SavedSearch,
} from './savedSearches';
import { Search } from './Search';
import { createFakeSearchPort, outcomeOf } from './test/fakeSearchPort';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const TODAY = '2026-08-19';
const BOTH_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'configured', reed: 'configured' };

const LONDON: SavedSearch = {
  id: 'saved-1',
  name: 'London testing',
  form: { ...EMPTY_FORM, keywords: 'software tester', location: 'London' },
  boards: ['indeed', 'custom-gone', 'reed'],
};

function seed(list: readonly SavedSearch[]) {
  localStorage.setItem(SAVED_SEARCHES_STORAGE_KEY, JSON.stringify(list));
}

function renderSearch(options: { prefs?: BoardPreferences } = {}) {
  const user = userEvent.setup();
  const port = createFakeSearchPort();
  port.nextOutcome(outcomeOf([], emptyQuota(TODAY)));
  const browser = createFakeBrowserPort();
  let ids = 0;
  const utils = render(
    <Search
      port={port}
      browser={browser}
      boardsPort={createFakeBoardPort(options.prefs ?? NO_PREFERENCES)}
      readKeyStates={async () => BOTH_KEYS}
      now={NOW}
      newId={() => `generated-${(ids += 1)}`}
      onOpenSettings={vi.fn()}
    />,
  );
  return { user, port, browser, ...utils };
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('search-keywords'), 'Tester');
  await user.type(screen.getByTestId('search-location'), 'London');
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('saving a search', () => {
  it('offers a name made of what and where, and Save keeps the form and the ticked boards', async () => {
    const { user, port } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await fillForm(user);
    await user.click(screen.getByTestId('keyless-reed'));

    await user.click(screen.getByRole('button', { name: 'Save this search' }));
    const name = screen.getByRole('textbox', { name: 'Name this search' });
    expect((name as HTMLInputElement).value).toBe('Tester · London');
    await user.click(screen.getByTestId('saved-search-confirm'));

    const chip = screen.getByRole('button', { name: 'Run saved search: Tester · London' });
    expect(chip).toBeTruthy();
    expect(readSavedSearches()).toEqual([
      {
        id: 'generated-1',
        name: 'Tester · London',
        form: { ...EMPTY_FORM, keywords: 'Tester', location: 'London' },
        boards: ['reed'],
      },
    ]);
    expect(screen.getByTestId('saved-search-note').textContent).toBe('Saved “Tester · London”.');
    // Saving is not searching.
    expect(port.calls.search).toBe(0);
    expect(port.calls.browseKeyless).toBe(0);
  });

  it('keyboard: Enter in the name box saves; Escape closes it and saves nothing', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await fillForm(user);

    await user.click(screen.getByRole('button', { name: 'Save this search' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name this search' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Name this search' })).toBeNull();
    // Focus goes back to the button that opened the box.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save this search' }));
    expect(readSavedSearches()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Save this search' }));
    const name = screen.getByRole('textbox', { name: 'Name this search' });
    await user.clear(name);
    await user.type(name, 'Mine{Enter}');
    expect(readSavedSearches().map((entry) => entry.name)).toEqual(['Mine']);
  });

  it('is still there after the screen is opened again', async () => {
    seed([LONDON]);
    const first = renderSearch();
    expect(
      await screen.findByRole('button', { name: 'Run saved search: London testing' }),
    ).toBeTruthy();
    first.unmount();
    renderSearch();
    expect(
      await screen.findByRole('button', { name: 'Run saved search: London testing' }),
    ).toBeTruthy();
  });

  it('negative: a blank name is refused with a reason, and nothing is saved', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Save this search' }));
    const name = screen.getByRole('textbox', { name: 'Name this search' });
    await user.clear(name);
    await user.type(name, '   ');
    await user.click(screen.getByTestId('saved-search-confirm'));

    expect(screen.getByTestId('saved-search-problem').textContent).toBe('Give this search a name.');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(readSavedSearches()).toEqual([]);
  });

  it('negative: a form with a mistake in it is not saved, and the field says what is wrong', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await fillForm(user);
    await user.type(screen.getByTestId('search-salary'), '£45k');
    await user.click(screen.getByRole('button', { name: 'Save this search' }));
    await user.click(screen.getByTestId('saved-search-confirm'));

    expect(screen.getByTestId('search-salary-error').textContent).toContain('whole pounds');
    expect(readSavedSearches()).toEqual([]);
  });

  it(`boundary: a name of ${MAX_SAVED_NAME_CHARS} characters is kept; ${MAX_SAVED_NAME_CHARS + 1} is refused`, async () => {
    const { user } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Save this search' }));
    const name = screen.getByRole('textbox', { name: 'Name this search' });
    await user.clear(name);
    await user.type(name, 'a'.repeat(MAX_SAVED_NAME_CHARS + 1));
    await user.click(screen.getByTestId('saved-search-confirm'));
    expect(screen.getByTestId('saved-search-problem').textContent).toBe(
      `Keep the name to ${MAX_SAVED_NAME_CHARS} characters or fewer.`,
    );

    await user.type(name, '{Backspace}');
    await user.click(screen.getByTestId('saved-search-confirm'));
    expect(readSavedSearches()[0]?.name).toHaveLength(MAX_SAVED_NAME_CHARS);
  });

  it('the same name in another case updates that saved search instead of adding a second', async () => {
    seed([LONDON]);
    const { user } = renderSearch();
    await screen.findByRole('button', { name: 'Run saved search: London testing' });
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Save this search' }));
    const name = screen.getByRole('textbox', { name: 'Name this search' });
    await user.clear(name);
    await user.type(name, 'LONDON TESTING{Enter}');

    expect(readSavedSearches()).toHaveLength(1);
    expect(readSavedSearches()[0]?.form.keywords).toBe('Tester');
    expect(screen.getByTestId('saved-search-note').textContent).toBe('Updated “LONDON TESTING”.');
  });

  it(`boundary: with ${MAX_SAVED_SEARCHES} saved, a new one is refused and says how to make room`, async () => {
    seed(
      Array.from({ length: MAX_SAVED_SEARCHES }, (_, index) => ({
        ...LONDON,
        id: `s${index}`,
        name: `Search ${index}`,
      })),
    );
    const { user } = renderSearch();
    await screen.findByRole('button', { name: 'Run saved search: Search 0' });
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Save this search' }));
    await user.click(screen.getByTestId('saved-search-confirm'));

    expect(screen.getByTestId('saved-search-problem').textContent).toBe(
      `You can keep ${MAX_SAVED_SEARCHES} saved searches. Delete one to save another.`,
    );
    expect(readSavedSearches()).toHaveLength(MAX_SAVED_SEARCHES);
  });
});

describe('running a saved search', () => {
  it('one click fills the boxes, ticks its boards, and runs Search: the search and one tab per board', async () => {
    seed([LONDON]);
    const { user, port, browser } = renderSearch();
    await user.click(
      await screen.findByRole('button', { name: 'Run saved search: London testing' }),
    );

    expect((screen.getByTestId('search-keywords') as HTMLInputElement).value).toBe(
      'software tester',
    );
    expect((screen.getByTestId('search-location') as HTMLInputElement).value).toBe('London');
    expect((screen.getByTestId('keyless-indeed') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('keyless-reed') as HTMLInputElement).checked).toBe(true);

    await vi.waitFor(() => expect(port.calls.search).toBe(1));
    expect(port.requests()[0]?.input.keywords).toBe('software tester');
    expect(port.requests()[0]?.input.location).toBe('London');
    // Board order, and the board that no longer exists is simply not there.
    expect(browser.opened()).toEqual([
      'https://uk.indeed.com/jobs?q=software+tester&l=London',
      'https://www.reed.co.uk/jobs/software-tester-jobs-in-London',
    ]);
  });

  it('a board switched off in Settings since it was saved is not opened', async () => {
    seed([LONDON]);
    const { user, browser } = renderSearch({ prefs: { ...NO_PREFERENCES, disabled: ['indeed'] } });
    await screen.findByTestId('keyless-reed');
    await user.click(screen.getByRole('button', { name: 'Run saved search: London testing' }));
    await vi.waitFor(() =>
      expect(browser.opened()).toEqual([
        'https://www.reed.co.uk/jobs/software-tester-jobs-in-London',
      ]),
    );
  });

  it('negative: a saved search whose form no longer validates runs nothing and shows why', async () => {
    seed([{ ...LONDON, boards: ['reed'], form: { ...LONDON.form, distanceMiles: 'far' } }]);
    const { user, port, browser } = renderSearch();
    await user.click(
      await screen.findByRole('button', { name: 'Run saved search: London testing' }),
    );

    expect(screen.getByTestId('search-distance-error')).toBeTruthy();
    expect(port.calls.search).toBe(0);
    expect(browser.opened()).toEqual([]);
  });
});

describe('deleting a saved search', () => {
  it('removes that one, remembers it, and runs nothing', async () => {
    seed([LONDON, { ...LONDON, id: 'saved-2', name: 'Leeds' }]);
    const { user, port } = renderSearch();
    await user.click(
      await screen.findByRole('button', { name: 'Delete saved search: London testing' }),
    );

    expect(screen.queryByRole('button', { name: 'Run saved search: London testing' })).toBeNull();
    const list = screen.getByTestId('search-saved');
    expect(within(list).getByRole('button', { name: 'Run saved search: Leeds' })).toBeTruthy();
    expect(readSavedSearches().map((entry) => entry.id)).toEqual(['saved-2']);
    expect(screen.getByTestId('saved-search-note').textContent).toBe('Deleted “London testing”.');
    expect(port.calls.search).toBe(0);
  });
});
