// @vitest-environment jsdom
/**
 * L-398: "Where to look" folds, and its summary line says what is ticked.
 *
 * The box held the keyed boards, the free feed and nine job-board ticks, and
 * at the smallest window it pushed Search, its reason and the results down
 * past the bottom edge. Now it is a native fold, closed on every visit and
 * never remembered, and the line you see when it is closed names what Search
 * will look at and counts the boards "Also open" will open — so nothing is
 * chosen out of sight.
 *
 * jsdom draws a closed fold's content and lets it be clicked, so these tests
 * read `details.open` for the fold itself; whether the content is really out
 * of reach when closed is proved in WebKit (`e2e/contrast-webkit.spec.ts`).
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyQuota, type JobProviderId } from '@cviper/job-apis';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';
import { NO_PREFERENCES } from '../boards/model';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';

import { whereToLookSummary } from './boardChoice';
import { EMPTY_FORM } from './model';
import { SAVED_SEARCHES_STORAGE_KEY, type SavedSearch } from './savedSearches';
import { Search } from './Search';
import { createFakeSearchPort, outcomeOf } from './test/fakeSearchPort';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const TODAY = '2026-08-19';
const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };
const BOTH_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'configured', reed: 'configured' };

function renderSearch(keys: Record<JobProviderId, KeyState> = NO_KEYS) {
  const user = userEvent.setup();
  const port = createFakeSearchPort();
  port.nextOutcome(outcomeOf([], emptyQuota(TODAY)));
  render(
    <Search
      port={port}
      browser={createFakeBrowserPort()}
      boardsPort={createFakeBoardPort(NO_PREFERENCES)}
      readKeyStates={async () => keys}
      now={NOW}
      newId={() => 'generated'}
      onOpenSettings={vi.fn()}
    />,
  );
  return { user, port };
}

const fold = () => screen.getByTestId('search-where-fold') as HTMLDetailsElement;
const summaryLine = () => screen.getByTestId('search-where-summary').textContent;

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('"Where to look" is a fold (L-398)', () => {
  it('folded on arrival', async () => {
    renderSearch();
    await screen.findByTestId('search-empty');
    expect(fold().tagName).toBe('DETAILS');
    expect(fold().open).toBe(false);
  });

  it('negative: an earlier visit that opened it is not remembered', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');
    await user.click(fold().querySelector('summary') as HTMLElement);
    expect(fold().open).toBe(true);
    cleanup();

    renderSearch();
    await screen.findByTestId('search-empty');
    expect(fold().open).toBe(false);
    // Nothing about the fold was written anywhere.
    expect(Object.keys(localStorage).filter((key) => /where|fold/i.test(key))).toEqual([]);
  });

  it('keeps its region name and test id, and the heading sits in the summary line', async () => {
    renderSearch();
    const region = await screen.findByRole('region', { name: 'Where to look' });
    expect(region.dataset.testid).toBe('search-where');
    const summary = fold().querySelector('summary');
    expect(summary?.querySelector('h2')?.textContent).toBe('Where to look');
    // A button inside the summary would be a button inside a button.
    expect(summary?.querySelector('button, a, input')).toBeNull();
  });

  it('the summary names what is ticked: "Arbeitnow · 2 job boards ticked"', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');
    await user.click(screen.getByTestId('keyless-linkedin'));
    await user.click(screen.getByTestId('keyless-indeed'));
    expect(summaryLine()).toBe('Arbeitnow · 2 job boards ticked');
  });

  it('boundary: nothing ticked → "Nothing ticked"', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');
    await user.click(screen.getByTestId('keyless-source-arbeitnow'));
    expect(summaryLine()).toBe('Nothing ticked');
  });

  it('boundary: one board → "1 job board ticked"', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');
    await user.click(screen.getByTestId('keyless-source-arbeitnow'));
    await user.click(screen.getByTestId('keyless-reed'));
    expect(summaryLine()).toBe('1 job board ticked');
  });

  it('edge: a ticked board behind "More boards" is counted', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');
    await user.click(screen.getByTestId('keyless-more'));
    await user.click(screen.getByTestId('keyless-jobserve'));
    await user.click(screen.getByTestId('keyless-more'));
    expect(summaryLine()).toBe('Arbeitnow · 1 job board ticked');
  });

  it('negative: a keyed board with no key is not named', async () => {
    renderSearch({ adzuna: 'configured', reed: 'missing' });
    await screen.findByTestId('provider-toggles');
    expect((screen.getByTestId('provider-reed') as HTMLInputElement).disabled).toBe(true);
    expect(summaryLine()).toBe('Adzuna · Arbeitnow');
    expect(summaryLine()).not.toContain('Reed');
  });

  it('edge: after a saved search runs, the summary follows its ticks', async () => {
    const saved: SavedSearch = {
      id: 'saved-1',
      name: 'London testing',
      form: { ...EMPTY_FORM, keywords: 'software tester', location: 'London' },
      boards: ['indeed', 'reed'],
    };
    localStorage.setItem(SAVED_SEARCHES_STORAGE_KEY, JSON.stringify([saved]));
    const { user, port } = renderSearch(BOTH_KEYS);
    await screen.findByTestId('provider-toggles');
    expect(summaryLine()).toBe('Adzuna · Reed · Arbeitnow');

    await user.click(screen.getByRole('button', { name: 'Run saved search: London testing' }));
    await vi.waitFor(() => expect(port.calls.search).toBe(1));
    // London: the free feed is off for a UK location; the saved boards are ticked.
    expect(summaryLine()).toBe('Adzuna · Reed · 2 job boards ticked');
  });

  it('closing and opening the fold keeps every tick', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');
    await user.click(screen.getByTestId('keyless-linkedin'));
    await user.click(screen.getByTestId('keyless-source-arbeitnow'));
    const summary = fold().querySelector('summary') as HTMLElement;

    await user.click(summary);
    expect(fold().open).toBe(true);
    await user.click(summary);
    expect(fold().open).toBe(false);
    await user.click(summary);
    expect(fold().open).toBe(true);

    expect((screen.getByTestId('keyless-linkedin') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('keyless-source-arbeitnow') as HTMLInputElement).checked).toBe(
      false,
    );
    expect(summaryLine()).toBe('1 job board ticked');
  });
});

describe('whereToLookSummary (L-398)', () => {
  it('happy: the free feed and two boards', () => {
    expect(whereToLookSummary([], ['arbeitnow'], 2)).toBe('Arbeitnow · 2 job boards ticked');
  });

  it('boundary: nothing at all', () => {
    expect(whereToLookSummary([], [], 0)).toBe('Nothing ticked');
  });

  it('boundary: one board, nothing else', () => {
    expect(whereToLookSummary([], [], 1)).toBe('1 job board ticked');
  });

  it('many boards', () => {
    expect(whereToLookSummary([], [], 9)).toBe('9 job boards ticked');
  });

  it('the free feed alone has no count after it', () => {
    expect(whereToLookSummary([], ['arbeitnow'], 0)).toBe('Arbeitnow');
  });

  it('keyed boards, then feeds, then the count', () => {
    expect(whereToLookSummary(['adzuna', 'reed'], ['arbeitnow'], 3)).toBe(
      'Adzuna · Reed · Arbeitnow · 3 job boards ticked',
    );
  });
});
