// @vitest-environment jsdom
/**
 * L-219 part 4: tick job boards, press the boards' button, and each ticked
 * board opens in the browser with the search filled in. Since L-329 that is
 * "Also open in N boards", its own button: Search itself only searches here.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyQuota, type JobProviderId } from '@cviper/job-apis';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';
import { NO_PREFERENCES, type BoardPreferences } from '../boards/model';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';

import { BOARD_CHOICE_STORAGE_KEY } from './boardChoice';
import { Search } from './Search';
import { createFakeSearchPort, outcomeOf } from './test/fakeSearchPort';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const TODAY = '2026-08-19';
const BOTH_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'configured', reed: 'configured' };
const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };

const MY_BOARD = {
  id: 'custom-my-board',
  label: 'My Board',
  urlTemplate: 'https://my-board.invalid/search?q={keyword}&where={location}',
  encoding: 'plus' as const,
};

function renderSearch(
  options: {
    keys?: Record<JobProviderId, KeyState>;
    prefs?: BoardPreferences;
    browser?: ReturnType<typeof createFakeBrowserPort>;
  } = {},
) {
  const user = userEvent.setup();
  const port = createFakeSearchPort();
  port.nextOutcome(outcomeOf([], emptyQuota(TODAY)));
  const browser = options.browser ?? createFakeBrowserPort();
  const keys = options.keys ?? BOTH_KEYS;
  const utils = render(
    <Search
      port={port}
      browser={browser}
      boardsPort={createFakeBoardPort(options.prefs ?? NO_PREFERENCES)}
      readKeyStates={async () => keys}
      now={NOW}
      newId={() => 'generated'}
      onOpenSettings={vi.fn()}
    />,
  );
  return { user, port, browser, ...utils };
}

/** Untick the free feed, so only what the test ticks runs. */
async function untickFeeds(user: ReturnType<typeof userEvent.setup>) {
  for (const id of ['keyless-source-arbeitnow']) {
    const box = screen.getByTestId(id) as HTMLInputElement;
    if (box.checked) await user.click(box);
  }
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('ticking boards', () => {
  it('nothing is ticked on first use, and the button just says Search', async () => {
    renderSearch();
    await screen.findByTestId('keyless-bar');
    const boxes = within(screen.getByTestId('keyless-boards')).getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect((box as HTMLInputElement).checked).toBe(false);
    await vi.waitFor(() => expect(screen.getByTestId('search-submit').textContent).toBe('Search'));
  });

  it('a fieldset with a legend, each checkbox named by its board', async () => {
    renderSearch();
    const group = await screen.findByRole('group', { name: 'Job boards to open' });
    expect(within(group).getByRole('checkbox', { name: 'Reed' })).toBe(
      screen.getByTestId('keyless-reed'),
    );
  });

  it('ticking updates the button’s count; unticking takes it back', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.click(screen.getByTestId('keyless-reed'));
    expect(screen.getByTestId('search-open-boards').textContent).toBe('Also open in 1 board');
    await user.click(screen.getByTestId('keyless-indeed'));
    expect(screen.getByRole('button', { name: 'Also open in 2 boards' })).toBe(
      screen.getByTestId('search-open-boards'),
    );
    await user.click(screen.getByTestId('keyless-reed'));
    expect(screen.getByTestId('search-open-boards').textContent).toBe('Also open in 1 board');
    // L-329: the count is never on Search, which opens no tabs.
    expect(screen.getByTestId('search-submit').textContent).toBe('Search');
  });

  it('keyboard: Space ticks a focused board', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('keyless-bar');
    screen.getByTestId('keyless-indeed').focus();
    await user.keyboard(' ');
    expect((screen.getByTestId('keyless-indeed') as HTMLInputElement).checked).toBe(true);
  });
});

describe('pressing "Also open in N boards"', () => {
  it('opens each ticked board once, in board order; Search runs the normal search on its own', async () => {
    const { user, port, browser } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.type(screen.getByTestId('search-keywords'), 'software tester');
    await user.type(screen.getByTestId('search-location'), 'London');
    // Ticked out of order: they still open in the list's order.
    await user.click(screen.getByTestId('keyless-reed'));
    await user.click(screen.getByTestId('keyless-indeed'));
    await user.click(screen.getByTestId('search-open-boards'));

    await vi.waitFor(() => expect(browser.opened()).toHaveLength(2));
    expect(browser.opened()).toEqual([
      'https://uk.indeed.com/jobs?q=software+tester&l=London',
      'https://www.reed.co.uk/jobs/software-tester-jobs-in-London',
    ]);
    // And the normal search runs from Search (L-329), which opens no more tabs.
    expect(port.calls.search).toBe(0);
    await user.click(screen.getByTestId('search-submit'));
    await vi.waitFor(() => expect(port.calls.search).toBe(1));
    expect(browser.opened()).toHaveLength(2);
  });

  it('a custom board from Settings is a checkbox and opens its own link', async () => {
    const { user, browser } = renderSearch({ prefs: { ...NO_PREFERENCES, custom: [MY_BOARD] } });
    const box = await screen.findByTestId('keyless-custom-my-board');
    expect(screen.getByRole('checkbox', { name: 'My Board' })).toBe(box);
    await user.type(screen.getByTestId('search-keywords'), 'analyst');
    await user.click(box);
    await user.click(screen.getByTestId('search-open-boards'));

    await vi.waitFor(() =>
      expect(browser.opened()).toEqual(['https://my-board.invalid/search?q=analyst']),
    );
  });

  it('negative: nothing ticked opens nothing', async () => {
    const { user, browser, port } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.type(screen.getByTestId('search-keywords'), 'analyst');
    await user.click(screen.getByTestId('search-submit'));
    await vi.waitFor(() => expect(port.calls.search).toBe(1));
    expect(browser.opened()).toEqual([]);
  });

  it('negative: an invalid form opens nothing', async () => {
    const { user, browser } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.type(screen.getByTestId('search-keywords'), 'analyst');
    await user.type(screen.getByTestId('search-salary'), '45k');
    await user.click(screen.getByTestId('keyless-reed'));
    await user.click(screen.getByTestId('search-open-boards'));

    expect(await screen.findByTestId('search-salary-error')).toBeDefined();
    expect(browser.opened()).toEqual([]);
  });

  it('negative: a switched-off board is not offered', async () => {
    renderSearch({ prefs: { ...NO_PREFERENCES, disabled: ['reed'] } });
    await vi.waitFor(() => expect(screen.queryByTestId('keyless-reed')).toBeNull());
  });

  it('negative: a board that will not open is named, and the others still open', async () => {
    const browser = createFakeBrowserPort();
    const { user } = renderSearch({ browser });
    await screen.findByTestId('keyless-bar');
    await user.type(screen.getByTestId('search-keywords'), 'analyst');
    await user.click(screen.getByTestId('keyless-linkedin'));
    await user.click(screen.getByTestId('keyless-indeed'));
    browser.failNext();
    await user.click(screen.getByTestId('search-open-boards'));

    const problem = await screen.findByTestId('search-boards-problem');
    expect(problem.textContent).toContain('LinkedIn');
    expect(problem.textContent).not.toContain('Indeed');
    expect(browser.opened()).toEqual(['https://uk.indeed.com/jobs?q=analyst']);
  });

  it('boundary: only boards ticked — no feed, no key — still opens them', async () => {
    const { user, browser, port } = renderSearch({ keys: NO_KEYS });
    await screen.findByTestId('keyless-bar');
    await untickFeeds(user);
    await user.click(screen.getByTestId('keyless-reed'));

    const open = screen.getByTestId('search-open-boards') as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    expect(screen.queryByTestId('search-open-boards-reason')).toBeNull();
    // L-329: nothing for Search to look at here, so it is disabled and says why.
    expect((screen.getByTestId('search-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('search-reason')).toBeDefined();
    await user.click(open);

    // An empty search, exactly as the single-board button used to send it.
    await vi.waitFor(() => expect(browser.opened()).toHaveLength(1));
    expect(browser.opened()[0]).toMatch(/^https:\/\/www\.reed\.co\.uk\//);
    expect(port.calls.search).toBe(0);
    expect(port.calls.browseKeyless).toBe(0);
  });

  it('boundary: every board ticked opens every enabled board, once each', async () => {
    const { user, browser } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.type(screen.getByTestId('search-keywords'), 'analyst');
    await user.click(screen.getByTestId('keyless-more'));
    const boxes = within(screen.getByTestId('keyless-boards')).getAllByRole('checkbox');
    for (const box of boxes) await user.click(box);
    await user.click(screen.getByTestId('search-open-boards'));

    await vi.waitFor(() => expect(browser.opened()).toHaveLength(boxes.length));
    expect(new Set(browser.opened()).size).toBe(boxes.length);
  });
});

describe('remembered between visits', () => {
  it('the ticked set survives a remount', async () => {
    const first = renderSearch();
    await screen.findByTestId('keyless-bar');
    await first.user.click(screen.getByTestId('keyless-totaljobs'));
    first.unmount();

    renderSearch();
    await screen.findByTestId('keyless-bar');
    expect((screen.getByTestId('keyless-totaljobs') as HTMLInputElement).checked).toBe(true);
    expect(localStorage.getItem(BOARD_CHOICE_STORAGE_KEY)).toBe('["totaljobs"]');
  });

  it('boundary: a remembered board that no longer exists is ignored', async () => {
    localStorage.setItem(BOARD_CHOICE_STORAGE_KEY, '["gone-board","reed"]');
    renderSearch();
    await screen.findByTestId('keyless-bar');
    await vi.waitFor(() =>
      expect(screen.getByTestId('search-open-boards').textContent).toBe('Also open in 1 board'),
    );
  });
});

describe('on a phone', () => {
  it('each board checkbox is a full-size tap target, compact on a wide screen', async () => {
    renderSearch();
    await screen.findByTestId('keyless-bar');
    for (const id of ['keyless-linkedin', 'keyless-reed']) {
      const classes = (screen.getByTestId(id).closest('label')?.className ?? '').split(/\s+/);
      expect(classes, id).toContain('min-h-11');
      expect(classes, id).toContain('md:min-h-0');
    }
  });
});
