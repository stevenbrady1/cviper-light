// @vitest-environment jsdom
/**
 * L-219: the Search page around one search.
 *
 *   * One blue button, always "Search".
 *   * "Search job boards with these filters" directly under the fields (in
 *     the "Where to look" box, before the button since L-313): the
 *     first five boards, the rest under More, each saying which filters its
 *     link carries.
 *   * After a search that finds fewer than five jobs, the same boards are
 *     offered above the results — one click, one tab, nothing opened alone.
 *   * Bookkeeping (sort, today's requests) sits with the results.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok } from '@cviper/core-types';
import {
  emptyQuota,
  jobApiError,
  type JobProviderId,
  type KeylessFetchTransport,
} from '@cviper/job-apis';

import ARBEITNOW_PAGE from '../../../../../packages/job-apis/src/fixtures/arbeitnow-page1.json';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';
import { SHIPPED_BOARDS } from '../boards/defaults';
import { NO_PREFERENCES } from '../boards/model';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';

import { mainBoards } from './KeylessBar';
import { Search } from './Search';
import { createFakeSearchPort, outcomeOf } from './test/fakeSearchPort';
import { entry } from './test/fixtures';
import { expectSpoken } from '../../app/test/spoken';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const TODAY = '2026-08-19';
const BOTH_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'configured', reed: 'configured' };
const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };
/** The keyed-board row only shows once a key exists (L-276); one is enough. */
const ONE_KEY: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'configured' };

const DEFAULT_FIVE = ['linkedin', 'indeed', 'totaljobs', 'cv-library', 'reed'];

function renderSearch(keys: Record<JobProviderId, KeyState> = BOTH_KEYS) {
  const user = userEvent.setup();
  const port = createFakeSearchPort();
  const browser = createFakeBrowserPort();
  let counter = 0;
  render(
    <Search
      port={port}
      browser={browser}
      readKeyStates={async () => keys}
      now={NOW}
      newId={() => `generated-${(counter += 1)}`}
      onOpenSettings={vi.fn()}
    />,
  );
  return { user, port, browser };
}

function jobs(count: number) {
  return Array.from({ length: count }, (_, index) =>
    entry({
      id: `job-${index}`,
      source: 'adzuna',
      external_id: `adz-${index}`,
      title: `Tester ${index}`,
    }),
  );
}

/** Search the keyed boards only, so the result count is exactly the fake's. */
async function searchFor(count: number) {
  const harness = renderSearch();
  harness.port.nextOutcome(outcomeOf(jobs(count), emptyQuota(TODAY)));
  await screen.findByTestId('search-empty');
  await harness.user.click(screen.getByTestId('keyless-source-arbeitnow'));
  await harness.user.type(screen.getByTestId('search-keywords'), 'software tester');
  await harness.user.type(screen.getByTestId('search-salary'), '60000');
  await harness.user.click(screen.getByTestId('search-submit'));
  await vi.waitFor(() => expect(screen.queryByTestId('search-empty')).toBeNull());
  return harness;
}

function boardIds(container: HTMLElement): string[] {
  // Checkboxes in the boards box since L-219 part 4; still buttons in the
  // few-results offer. Both carry `data-board`.
  return [...container.querySelectorAll('[data-board]')]
    .map((element) => element.getAttribute('data-board') ?? '')
    .filter((id) => id !== '');
}

function describedBy(element: Element): string {
  const id = element.getAttribute('aria-describedby');
  return id === null ? '' : (document.getElementById(id)?.textContent ?? '');
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('one search (L-219)', () => {
  it.each([
    ['no keys', NO_KEYS],
    ['both keys', BOTH_KEYS],
  ] as const)('the one blue button says "Search" — %s', async (_label, keys) => {
    renderSearch(keys);
    const submit = await screen.findByTestId('search-submit');
    await vi.waitFor(() => expect(submit.textContent).toBe('Search'));
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
  });
});

describe('job boards, right under the fields (L-219, L-313)', () => {
  it('sit in the form under the fields, before the Search button, recent searches and results', async () => {
    renderSearch();
    const form = await screen.findByTestId('search-form');
    const boards = screen.getByTestId('keyless-bar');
    const submit = screen.getByTestId('search-submit');
    const quota = await screen.findByTestId('search-quota');
    // Inside the form since L-313: the button that opens them comes after them.
    expect(form.contains(boards)).toBe(true);
    expect(boards.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(boards.compareDocumentPosition(quota) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(boards).getByRole('heading').textContent).toBe(
      'Search job boards with these filters',
    );
  });

  it('shows the five main boards; More shows the rest and hides them again', async () => {
    const { user } = renderSearch();
    const bar = await screen.findByTestId('keyless-bar');
    expect(boardIds(bar)).toEqual(DEFAULT_FIVE);

    const more = screen.getByTestId('keyless-more');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.textContent).toContain('4');
    await user.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(boardIds(bar)).toHaveLength(9);
    await user.click(more);
    expect(boardIds(bar)).toEqual(DEFAULT_FIVE);
  });

  it('each board says which of your filters its link carries', async () => {
    renderSearch();
    await screen.findByTestId('keyless-bar');
    const reed = describedBy(screen.getByTestId('keyless-reed'));
    expect(reed).toContain('job title, location, distance, minimum salary and contract type');
    const indeed = describedBy(screen.getByTestId('keyless-indeed'));
    expect(indeed).toContain('job title, location and distance');
    expect(indeed).toContain('minimum salary and contract type');
    expect(indeed).toContain('set those on the site');
  });

  it('a ticked board opens with the form’s filters when "Also open in 1 board" is pressed', async () => {
    const { user, browser } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.type(screen.getByTestId('search-keywords'), 'software tester');
    await user.type(screen.getByTestId('search-location'), 'London');
    await user.type(screen.getByTestId('search-distance'), '10');
    await user.type(screen.getByTestId('search-salary'), '60000');
    await user.selectOptions(screen.getByTestId('search-contract'), 'Permanent');
    await user.click(screen.getByTestId('keyless-reed'));
    // Its own button since L-329; Search itself only searches here.
    await user.click(screen.getByTestId('search-open-boards'));
    await vi.waitFor(() =>
      expect(browser.opened()).toEqual([
        'https://www.reed.co.uk/jobs/software-tester-jobs-in-London?proximity=10&salaryFrom=60000&perm=true',
      ]),
    );
  });
});

describe('fewer than five results: the boards are offered (L-219)', () => {
  it('boundary: none before anything is searched', async () => {
    renderSearch();
    await screen.findByTestId('search-empty');
    expect(screen.queryByTestId('search-few-results')).toBeNull();
  });

  it('0 results: says so and offers the five boards, opening nothing on its own', async () => {
    const { browser } = await searchFor(0);
    const few = await screen.findByTestId('search-few-results');
    expect(few.textContent).toContain('No matches');
    // Read out by a screen reader, from a region already on the page (L-238).
    expectSpoken(
      few,
      'No matches in CViper’s sources. Try broader words or a wider distance, or run the same search on a job board.',
    );
    expect(boardIds(few)).toEqual(DEFAULT_FIVE);
    expect(browser.opened()).toEqual([]);
  });

  it('4 results: "Only 4", and a click opens one board with the filters', async () => {
    const { user, browser } = await searchFor(4);
    const few = await screen.findByTestId('search-few-results');
    expect(few.textContent).toContain('Only 4 matches');
    expectSpoken(few, 'Only 4 matches in CViper’s sources. Try the same search on a job board.');
    await user.click(within(few).getByRole('button', { name: /Totaljobs/ }));
    expect(browser.opened()).toEqual([
      'https://www.totaljobs.com/jobs/software-tester?salary=60000&salarytypeid=1',
    ]);
  });

  it('boundary: 5 results — no message', async () => {
    await searchFor(5);
    await screen.findByTestId('search-results');
    expect(screen.queryByTestId('search-few-results')).toBeNull();
    // Nothing to say, so nothing is spoken either.
    const spoken = screen.queryAllByRole('status').map((region) => region.textContent ?? '');
    expect(spoken.some((text) => text.includes('in CViper’s sources'))).toBe(false);
  });
});

describe('Arbeitnow and a UK location (L-219)', () => {
  const arbeitnow = () => screen.getByTestId<HTMLInputElement>('keyless-source-arbeitnow');

  it('London: Arbeitnow goes off, and the screen says why', async () => {
    const { user } = renderSearch(NO_KEYS);
    await screen.findByTestId('search-empty');
    expect(arbeitnow().checked).toBe(true);
    await user.type(screen.getByTestId('search-location'), 'London');
    expect(arbeitnow().checked).toBe(false);
    expect(screen.getByTestId('keyless-arbeitnow-uk').textContent).toContain('UK location');
  });

  it('negative: Berlin keeps it on, with no note', async () => {
    const { user } = renderSearch(NO_KEYS);
    await screen.findByTestId('search-empty');
    await user.type(screen.getByTestId('search-location'), 'Berlin');
    expect(arbeitnow().checked).toBe(true);
    expect(screen.queryByTestId('keyless-arbeitnow-uk')).toBeNull();
  });

  it('the user’s own tick wins for a UK location, and is remembered next time', async () => {
    const { user } = renderSearch(NO_KEYS);
    await screen.findByTestId('search-empty');
    await user.type(screen.getByTestId('search-location'), 'Leeds');
    await user.click(arbeitnow());
    expect(arbeitnow().checked).toBe(true);
    expect(screen.queryByTestId('keyless-arbeitnow-uk')).toBeNull();

    cleanup();
    const again = renderSearch(NO_KEYS);
    await screen.findByTestId('search-empty');
    await again.user.type(screen.getByTestId('search-location'), 'Leeds');
    expect(arbeitnow().checked).toBe(true);
  });
});

describe('the sources take one line each (L-219)', () => {
  it('a board with no key is one short link, its reason a description', async () => {
    renderSearch(ONE_KEY);
    const link = await screen.findByTestId('provider-settings-adzuna');
    expect(link.textContent).toBe('set up in Settings');
    expect(describedBy(link)).toContain('Settings');
  });

  it('the free feeds say what they are in one sentence, the rest on hover', async () => {
    renderSearch(NO_KEYS);
    const intro = await screen.findByTestId('keyless-intro');
    const mark = intro.querySelector('[aria-describedby]');
    expect(mark).not.toBeNull();
    expect(describedBy(mark!)).toContain('narrows it down on your computer');
  });
});

describe('results are complete and shown as found (L-219)', () => {
  it.each([1, 4, 7])(
    '%i jobs found: exactly %i cards, each once, in the results list',
    async (count) => {
      await searchFor(count);
      const list = await screen.findByTestId('search-results');
      const cards = [...list.querySelectorAll('[data-testid^="result-job-"]')].filter((card) =>
        /^result-job-\d+$/.test(card.getAttribute('data-testid') ?? ''),
      );
      expect(cards.map((card) => card.getAttribute('data-testid'))).toEqual(
        Array.from({ length: count }, (_, index) => `result-job-${index}`),
      );
      for (let index = 0; index < count; index += 1) {
        expect(within(list).getByText(`Tester ${index}`)).toBeTruthy();
      }
    },
  );
});

describe('mainBoards (L-219)', () => {
  const shipped = (id: string) => ({
    id,
    label: id,
    urlTemplate: `https://${id}.invalid/?q={keyword}`,
    encoding: 'plus' as const,
    enabled: true,
    userAdded: false,
  });

  it('the first five shipped boards, plus every board the user added; the rest behind More', () => {
    const mine = { ...shipped('mine'), userAdded: true };
    const { main, rest } = mainBoards([...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(shipped), mine]);
    expect(main.map((board) => board.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'mine']);
    expect(rest.map((board) => board.id)).toEqual(['f', 'g']);
  });

  it('boundary: five or fewer boards — nothing behind More', () => {
    const { rest } = mainBoards(['a', 'b', 'c', 'd', 'e'].map(shipped));
    expect(rest).toEqual([]);
  });
});

describe('phone pass (L-219, part 3)', () => {
  it('the few-results offer comes before the source credit and the cards', async () => {
    await searchFor(2);
    const few = await screen.findByTestId('search-few-results');
    const credit = screen.getByTestId('adzuna-attribution');
    const list = screen.getByTestId('search-results');
    expect(few.compareDocumentPosition(credit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(credit.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('every source row is a full-size tap target on a phone, compact on a wide screen', async () => {
    renderSearch(ONE_KEY);
    await screen.findByTestId('provider-toggles');
    for (const id of ['provider-adzuna', 'provider-reed', 'keyless-source-arbeitnow']) {
      const label = screen.getByTestId(id).closest('label');
      const classes = (label?.className ?? '').split(/\s+/);
      expect(classes, id).toContain('min-h-11');
      expect(classes, id).toContain('md:min-h-0');
    }
  });

  it('the empty page names the button it means', async () => {
    renderSearch(NO_KEYS);
    const empty = await screen.findByTestId('search-empty');
    expect(empty.textContent).toContain('press Search');
    expect(empty.textContent).toContain('job board');
  });
});

/*
  L-352: after a search that found nothing, the page says so ONCE.

  The few-results panel arrived (L-219) after the "No adverts matched that"
  line, and the line's list of reasons to stay quiet was never told about it:
  keyed boards that found nothing showed the panel AND the line under it. And
  when a free feed's own counted line already said none of its jobs matched,
  the panel said "No matches" a second time in other words.
*/
const FEED_NOW = new Date('2026-09-13T09:00:00.000Z');
const FEED_TODAY = '2026-09-13';

/** Arbeitnow answering with the page it really sent on 2026-09-13. */
const FEED_ANSWERS: KeylessFetchTransport = {
  fetch: async () => ok({ status: 200, body: JSON.stringify(ARBEITNOW_PAGE) }),
};

const ZERO_STATES = [
  'keyed boards found none',
  'the free feed matched none',
  'both found none',
  'every board switched off',
  'a board failed',
] as const;
type ZeroState = (typeof ZERO_STATES)[number];

/** Search for something nothing has, in one of the ways a search can find nothing. */
async function searchNothing(state: ZeroState) {
  const user = userEvent.setup();
  const feed = state === 'the free feed matched none' || state === 'both found none';
  const port = createFakeSearchPort([], feed ? FEED_ANSWERS : undefined);
  const failed =
    state === 'a board failed'
      ? [
          {
            provider: 'reed' as const,
            jobs: [],
            error: jobApiError('reed', 'server', 'Reed is having trouble at their end.', 503),
          },
        ]
      : [];
  port.nextOutcome(outcomeOf([], emptyQuota(FEED_TODAY), failed));
  const prefs =
    state === 'every board switched off'
      ? { ...NO_PREFERENCES, disabled: SHIPPED_BOARDS.map((board) => board.id) }
      : NO_PREFERENCES;
  render(
    <Search
      port={port}
      browser={createFakeBrowserPort()}
      boardsPort={createFakeBoardPort(prefs)}
      readKeyStates={async () => (state === 'the free feed matched none' ? NO_KEYS : BOTH_KEYS)}
      now={FEED_NOW}
      newId={() => 'generated'}
      onOpenSettings={vi.fn()}
    />,
  );
  await screen.findByTestId('search-empty');
  if (state === 'every board switched off') await screen.findByTestId('keyless-none');
  // The keyed states search the keyed boards only, so the feed adds nothing.
  if (!feed) await user.click(screen.getByTestId('keyless-source-arbeitnow'));
  await user.type(screen.getByTestId('search-keywords'), 'lighthouse keeper');
  await user.click(screen.getByTestId('search-submit'));
  await vi.waitFor(() => expect(port.calls.search + port.calls.browseKeyless).toBeGreaterThan(0));
  // Settled: whatever the state, something on the page now says what happened.
  await vi.waitFor(() =>
    expect(
      screen.queryByTestId('search-few-results') ?? screen.queryByTestId('search-no-results'),
    ).not.toBeNull(),
  );
  if (feed) await screen.findByTestId('keyless-nothing-matched-arbeitnow');
  if (state === 'a board failed') await screen.findByTestId('search-error-reed');
  return { port };
}

/**
 * Every element outside the screen-reader region whose own words say nothing
 * matched. The status region is the panel's words spoken (L-238), so it is
 * not a second sentence on the page.
 */
function nothingMatchedSentences(): string[] {
  return [...document.body.querySelectorAll('*')]
    .filter((element) => element.closest('[role="status"]') === null)
    .map((element) =>
      [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join('')
        .trim(),
    )
    .filter((text) => /^(no matches|no adverts matched)|none of them matched/i.test(text));
}

function spokenText(): string {
  return screen
    .queryAllByRole('status')
    .map((region) => region.textContent ?? '')
    .join(' ');
}

describe('a search that found nothing says so once (L-352)', () => {
  it('0 results: the page says there are no matches once', async () => {
    await searchNothing('keyed boards found none');
    const few = await screen.findByTestId('search-few-results');
    expect(few.textContent).toContain('No matches');
    expect(screen.queryByTestId('search-no-results')).toBeNull();
    // The hint the line used to carry now lives in the panel.
    expect(few.textContent).toContain('Try broader words or a wider distance');
  });

  it('boundary: every board switched off — the line is still said, and there is no panel', async () => {
    await searchNothing('every board switched off');
    expect(screen.getByTestId('search-no-results').textContent).toContain('No adverts matched');
    expect(screen.queryByTestId('search-few-results')).toBeNull();
  });

  it('negative: a board that failed — no "no matches" sentence beside its error', async () => {
    await searchNothing('a board failed');
    expect(screen.queryByTestId('search-no-results')).toBeNull();
    expect(nothingMatchedSentences()).toEqual([]);
    expect(spokenText()).not.toMatch(/no matches/i);
    // The boards are still offered: they work whatever happened to Reed.
    expect(screen.getByTestId('search-few-results').textContent).toContain(
      'Try the same search on a job board:',
    );
  });

  it('the free feed matched none: its counted line says it, and the panel does not repeat it', async () => {
    await searchNothing('the free feed matched none');
    const few = screen.getByTestId('search-few-results');
    expect(within(few).getByText('Try the same search on a job board:')).toBeTruthy();
    expect(few.textContent).not.toMatch(/no matches/i);
    expectSpoken(few, 'Try the same search on a job board.');
    expect(spokenText()).not.toMatch(/no matches/i);
  });

  it.each(ZERO_STATES)(
    'forbidden in every zero-result state — %s: the panel and the line together, or "nothing matched" said twice',
    async (state) => {
      await searchNothing(state);
      const both =
        screen.queryByTestId('search-few-results') !== null &&
        screen.queryByTestId('search-no-results') !== null;
      expect(both, 'the panel and the "No adverts matched" line on one page').toBe(false);
      expect(nothingMatchedSentences().length).toBeLessThanOrEqual(1);
    },
  );
});
