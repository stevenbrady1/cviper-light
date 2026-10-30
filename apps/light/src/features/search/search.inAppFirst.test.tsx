// @vitest-environment jsdom
/**
 * L-329 — Search runs the search in the app; opening job boards is its own
 * button.
 *
 * The blue button used to do two jobs: open every ticked job board in the
 * browser, then run CViper's own search. With no key and the free feeds
 * unticked, the second job had nothing to run, so the tabs opened and the
 * results still said "Nothing looked at yet." — it looked as if Search did
 * nothing. Now Search only searches here, and "Also open in N boards" opens
 * the ticked boards with the same filters.
 *
 * Since L-336 (Guardian Jobs closed on 2 Sep 2026) the free feed is Arbeitnow
 * alone. It is off by default for a UK location (L-219), and an untick the
 * user made is kept (no reset).
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyQuota, type JobProviderId } from '@cviper/job-apis';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';
import { NO_PREFERENCES } from '../boards/model';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';

import { FEED_CHOICE_KEY } from './feedDefaults';
import { Search } from './Search';
import { createFakeSearchPort, outcomeOf } from './test/fakeSearchPort';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };
const BOTH_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'configured', reed: 'configured' };

function renderSearch(keys: Record<JobProviderId, KeyState> = NO_KEYS) {
  const user = userEvent.setup();
  const port = createFakeSearchPort();
  port.nextOutcome(outcomeOf([], emptyQuota('2026-08-19')));
  const browser = createFakeBrowserPort();
  const utils = render(
    <Search
      port={port}
      browser={browser}
      boardsPort={createFakeBoardPort(NO_PREFERENCES)}
      readKeyStates={async () => keys}
      now={NOW}
      newId={() => 'generated'}
      onOpenSettings={vi.fn()}
    />,
  );
  return { user, port, browser, ...utils };
}

function box(id: string): HTMLInputElement {
  return screen.getByTestId(id) as HTMLInputElement;
}

function openBoardsButton(): HTMLButtonElement {
  return screen.getByTestId('search-open-boards') as HTMLButtonElement;
}

function submit(): HTMLButtonElement {
  return screen.getByTestId('search-submit') as HTMLButtonElement;
}

/**
 * The screen's text with the job-board links taken out. The Guardian Jobs
 * BOARD link is a different thing from the closed feed and leaves in L-337;
 * everything else on the screen must already be free of the name.
 */
function textOutsideTheBoardLinks(): string {
  const copy = document.body.cloneNode(true) as HTMLElement;
  copy.querySelector('[data-testid="keyless-bar"]')?.remove();
  const titles = [...copy.querySelectorAll('[title]')].map((node) => node.getAttribute('title'));
  return `${copy.textContent ?? ''} ${titles.join(' ')}`;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('the free feed on the Search screen — the default is unchanged, a stored untick is kept', () => {
  it('happy: London, no job-board key, nothing stored — Arbeitnow is off and there is no Guardian feed', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.type(screen.getByTestId('search-location'), 'London');

    // Arbeitnow is off for the UK (L-219), which is what this does NOT change.
    expect(box('keyless-source-arbeitnow').checked).toBe(false);
    expect(screen.queryByTestId('keyless-source-guardian')).toBeNull();
  });

  it('negative: an untick the user made stays off — after a re-render and after a remount', async () => {
    const first = renderSearch();
    await screen.findByTestId('keyless-bar');
    await first.user.type(screen.getByTestId('search-location'), 'Berlin');
    await first.user.click(box('keyless-source-arbeitnow'));
    expect(box('keyless-source-arbeitnow').checked).toBe(false);

    // A re-render: the location changes, and the untick does not come back.
    await first.user.type(screen.getByTestId('search-location'), ' Mitte');
    expect(box('keyless-source-arbeitnow').checked).toBe(false);
    expect(JSON.parse(localStorage.getItem(FEED_CHOICE_KEY) ?? '{}')).toEqual({
      arbeitnow: false,
    });
    first.unmount();

    const second = renderSearch();
    await screen.findByTestId('keyless-bar');
    await second.user.type(screen.getByTestId('search-location'), 'Berlin');
    expect(box('keyless-source-arbeitnow').checked).toBe(false);
  });

  it.each([
    ['Berlin', true],
    ['', true],
  ] as const)(
    'boundary: location "%s" — Arbeitnow on (the existing rule)',
    async (location, arbeitnow) => {
      const { user } = renderSearch();
      await screen.findByTestId('keyless-bar');
      if (location !== '') await user.type(screen.getByTestId('search-location'), location);

      expect(box('keyless-source-arbeitnow').checked).toBe(arbeitnow);
    },
  );
});

describe('the blue Search button searches here and opens no tabs', () => {
  it('with three boards ticked it says just "Search", opens nothing, and browses the ticked feeds', async () => {
    const { user, port, browser } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.type(screen.getByTestId('search-location'), 'Berlin');
    await user.click(box('keyless-reed'));
    await user.click(box('keyless-indeed'));
    await user.click(box('keyless-linkedin'));

    const submit = screen.getByTestId('search-submit') as HTMLButtonElement;
    expect(submit.textContent).toBe('Search');
    await user.click(submit);

    await vi.waitFor(() => expect(port.calls.browseKeyless).toBe(1));
    expect(port.browses()[0]?.sources).toEqual(['arbeitnow']);
    expect(browser.opened()).toEqual([]);
  });

  it('with keys and boards ticked it runs the keyed search, and still opens no tabs', async () => {
    const { user, port, browser } = renderSearch(BOTH_KEYS);
    await screen.findByTestId('provider-adzuna');
    await user.type(screen.getByTestId('search-keywords'), 'analyst');
    await user.click(box('keyless-reed'));
    await user.click(screen.getByTestId('search-submit'));

    await vi.waitFor(() => expect(port.calls.search).toBe(1));
    expect(browser.opened()).toEqual([]);
  });

  it('negative: only boards ticked — no key, no feed — Search is disabled and says why', async () => {
    const { user, browser } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.click(box('keyless-source-arbeitnow'));
    await user.click(box('keyless-reed'));

    expect((screen.getByTestId('search-submit') as HTMLButtonElement).disabled).toBe(true);
    const reason = screen.getByTestId('search-reason').textContent ?? '';
    expect(reason).toContain('no key');
    // The reason no longer sends the user to tick a job site to make Search work.
    expect(reason).not.toContain('tick a job site');
    expect(browser.opened()).toEqual([]);
    // The boards are still one press away, on their own button.
    expect(openBoardsButton().disabled).toBe(false);
  });
});

describe('"Also open in N boards" — its own button', () => {
  it('boundary: no board ticked — the button stays, disabled, with the reason beside it', async () => {
    renderSearch();
    await screen.findByTestId('keyless-bar');
    const button = openBoardsButton();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('type')).toBe('button');
    expect(button.hasAttribute('data-primary')).toBe(false);
    expect(screen.getByTestId('search-open-boards-reason').textContent).toContain(
      'Tick a job board',
    );
  });

  it('one board: singular; three boards: plural — and the reason goes away', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.click(box('keyless-reed'));
    expect(openBoardsButton().textContent).toBe('Also open in 1 board');
    expect(screen.queryByTestId('search-open-boards-reason')).toBeNull();
    await user.click(box('keyless-indeed'));
    await user.click(box('keyless-linkedin'));
    expect(openBoardsButton().textContent).toBe('Also open in 3 boards');
    expect(openBoardsButton().disabled).toBe(false);
  });

  it('opens each ticked board once, in board order, with the filters — and runs no search here', async () => {
    const { user, port, browser } = renderSearch(BOTH_KEYS);
    await screen.findByTestId('provider-adzuna');
    await user.type(screen.getByTestId('search-keywords'), 'software tester');
    await user.type(screen.getByTestId('search-location'), 'London');
    await user.click(box('keyless-reed'));
    await user.click(box('keyless-indeed'));
    await user.click(openBoardsButton());

    await vi.waitFor(() => expect(browser.opened()).toHaveLength(2));
    expect(browser.opened()).toEqual([
      'https://uk.indeed.com/jobs?q=software+tester&l=London',
      'https://www.reed.co.uk/jobs/software-tester-jobs-in-London',
    ]);
    expect(port.calls.search).toBe(0);
    expect(port.calls.browseKeyless).toBe(0);
  });

  it('negative: an invalid form opens nothing, and the field says what is wrong', async () => {
    const { user, browser, port } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.type(screen.getByTestId('search-salary'), '45k');
    await user.click(box('keyless-reed'));
    await user.click(openBoardsButton());

    expect(await screen.findByTestId('search-salary-error')).toBeDefined();
    expect(browser.opened()).toEqual([]);
    expect(port.calls.browseKeyless).toBe(0);
  });
});

/*
  L-336 — Guardian Jobs closed on 2 Sep 2026, and its feed went with it. For
  a UK location with no job-board key the Guardian feed was the only thing the
  app itself could read (Arbeitnow is off for the UK, L-219), so Search is now
  disabled there, and its reason has to be the true one: a free Reed key, set
  up in Settings, adds results here, and ticked job boards open with "Also
  open". Outside the UK nothing changes.
*/
describe('L-336: a UK location with no job-board key', () => {
  it('Search is disabled, and the reason is a free Reed key and "Also open"', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.type(screen.getByTestId('search-location'), 'London');

    expect(submit().disabled).toBe(true);
    const reason = screen.getByTestId('search-reason').textContent ?? '';
    expect(reason).toContain('Reed');
    expect(reason).toContain('Settings');
    expect(reason).toContain('Also open');
    expect(reason).not.toMatch(/free feeds?/i);
  });

  it('negative: the closed feed is nowhere on the screen', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.type(screen.getByTestId('search-location'), 'London');

    expect(screen.queryByTestId('keyless-source-guardian')).toBeNull();
    expect(textOutsideTheBoardLinks()).not.toMatch(/guardian/i);
  });

  it('negative: pressing the disabled button browses nothing', async () => {
    const { user, port } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.type(screen.getByTestId('search-location'), 'Manchester');
    await user.click(submit());

    expect(port.calls.browseKeyless).toBe(0);
    expect(port.calls.search).toBe(0);
  });
});

describe('L-336: outside the UK nothing changes', () => {
  it('boundary: Berlin with no key — Arbeitnow is ticked and Search is enabled', async () => {
    const { user, port } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.type(screen.getByTestId('search-location'), 'Berlin');

    expect((screen.getByTestId('keyless-source-arbeitnow') as HTMLInputElement).checked).toBe(true);
    expect(submit().disabled).toBe(false);
    expect(screen.queryByTestId('search-reason')).toBeNull();

    await user.click(submit());
    await vi.waitFor(() => expect(port.calls.browseKeyless).toBe(1));
    expect(port.browses()[0]?.sources).toEqual(['arbeitnow']);
  });

  it('boundary: a blank location reads the one free feed, Arbeitnow', async () => {
    renderSearch();
    await screen.findByTestId('keyless-bar');

    const feeds = screen.getByTestId('keyless-feeds');
    expect(feeds.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    expect((screen.getByTestId('keyless-source-arbeitnow') as HTMLInputElement).checked).toBe(true);
    expect(submit().disabled).toBe(false);
  });
});
