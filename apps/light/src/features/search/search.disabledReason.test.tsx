// @vitest-environment jsdom
/**
 * L-335 — a greyed-out Search says why, right beside it, and offers the fix.
 *
 * Found in the owner's real installed app: no job-board key, Guardian Jobs
 * unticked long ago (a remembered choice, kept — no reset), Arbeitnow off for
 * London (L-219). Search was disabled, and its reason was drawn under the
 * button row, below the bottom of the window. The user saw a grey button and
 * nothing else, and the empty page still told them to press it.
 *
 * Now the reason is in the button's own row, the button points at it, and
 * one press ticks the free feed(s) the default would have ticked here.
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

function submit(): HTMLButtonElement {
  return screen.getByTestId('search-submit') as HTMLButtonElement;
}

function stored(): unknown {
  return JSON.parse(localStorage.getItem(FEED_CHOICE_KEY) ?? '{}');
}

/** The owner's machine: Guardian unticked long ago, no key. */
async function ownersCase(location: string) {
  const rendered = renderSearch();
  await screen.findByTestId('keyless-bar');
  if (location !== '') await rendered.user.type(screen.getByTestId('search-location'), location);
  return rendered;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('the reason sits beside the disabled Search button (L-335)', () => {
  it("negative (the owner's case): London, Guardian unticked, no key — the reason is in the button's own row and the button points at it", async () => {
    localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ guardian: false }));
    await ownersCase('London');

    expect(submit().disabled).toBe(true);
    const reason = screen.getByTestId('search-reason');
    // Same row as the button: they share the row element, so whenever the
    // button is on screen its reason is next to it, not a row further down.
    const row = screen.getByTestId('search-submit-row');
    expect(row.contains(submit())).toBe(true);
    expect(row.contains(reason)).toBe(true);
    expect(screen.getByTestId('search-open-boards-row').contains(reason)).toBe(false);
    // And it can sit BESIDE the button: in a wrapping row a long sentence at
    // its natural width is pushed onto a line of its own, under the button —
    // the bug. A flexible, shrinkable item takes the rest of the button's line
    // instead, and only drops under it once the row is narrower than its basis.
    const area = screen.getByTestId('search-reason-area');
    expect(area.parentElement).toBe(row);
    expect(area.contains(reason)).toBe(true);
    const classes = area.className.split(/\s+/);
    for (const name of ['flex-1', 'min-w-0', 'basis-64']) expect(classes).toContain(name);

    const describedBy = (submit().getAttribute('aria-describedby') ?? '').split(/\s+/);
    expect(reason.id).not.toBe('');
    expect(describedBy).toContain(reason.id);
  });

  it('negative: pressing "Tick Guardian Jobs" ticks Guardian only, remembers it, enables Search and moves focus there', async () => {
    localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ guardian: false }));
    const { user, port, browser } = await ownersCase('London');

    const fix = screen.getByTestId('search-tick-feeds');
    expect(fix.textContent).toBe('Tick Guardian Jobs');
    expect(fix.getAttribute('type')).toBe('button');
    expect(screen.getByTestId('search-submit-row').contains(fix)).toBe(true);

    await user.click(fix);

    expect(box('keyless-source-guardian').checked).toBe(true);
    // Never Arbeitnow for a UK location.
    expect(box('keyless-source-arbeitnow').checked).toBe(false);
    expect(stored()).toEqual({ guardian: true });
    expect(submit().disabled).toBe(false);
    expect(screen.queryByTestId('search-reason')).toBeNull();
    expect(screen.queryByTestId('search-tick-feeds')).toBeNull();
    expect(submit().getAttribute('aria-describedby')).toBeNull();
    expect(document.activeElement).toBe(submit());
    // Pressing it did not search.
    expect(port.calls.browseKeyless).toBe(0);

    await user.click(submit());
    await vi.waitFor(() => expect(port.calls.browseKeyless).toBe(1));
    expect(port.browses()[0]?.sources).toEqual(['guardian']);
    expect(port.calls.search).toBe(0);
    expect(browser.opened()).toEqual([]);
  });

  it("remount after pressing it: the tick is the user's own and stays", async () => {
    localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ guardian: false }));
    const first = await ownersCase('London');
    await first.user.click(screen.getByTestId('search-tick-feeds'));
    first.unmount();

    await ownersCase('London');
    expect(box('keyless-source-guardian').checked).toBe(true);
    expect(box('keyless-source-arbeitnow').checked).toBe(false);
    expect(submit().disabled).toBe(false);
    expect(screen.queryByTestId('search-tick-feeds')).toBeNull();
  });

  it.each([['Berlin'], ['']] as const)(
    'boundary: location "%s" with both feeds unticked — "Tick both free feeds" ticks both',
    async (location) => {
      localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ guardian: false, arbeitnow: false }));
      const { user } = await ownersCase(location);

      const fix = screen.getByTestId('search-tick-feeds');
      expect(fix.textContent).toBe('Tick both free feeds');
      await user.click(fix);

      expect(box('keyless-source-guardian').checked).toBe(true);
      expect(box('keyless-source-arbeitnow').checked).toBe(true);
      expect(stored()).toEqual({ guardian: true, arbeitnow: true });
      expect(submit().disabled).toBe(false);
    },
  );

  it.each([
    ['a usable job-board key', BOTH_KEYS, { guardian: false }],
    ['a free feed ticked', NO_KEYS, {}],
  ] as const)(
    'boundary: with %s — Search enabled, no reason, no tick button',
    async (_l, keys, choice) => {
      localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify(choice));
      renderSearch(keys);
      await screen.findByTestId('keyless-bar');
      if (keys === BOTH_KEYS) await screen.findByTestId('provider-adzuna');
      await userEvent.setup().type(screen.getByTestId('search-location'), 'London');

      expect(submit().disabled).toBe(false);
      expect(screen.queryByTestId('search-reason')).toBeNull();
      expect(screen.queryByTestId('search-tick-feeds')).toBeNull();
      expect(submit().getAttribute('aria-describedby')).toBeNull();
    },
  );
});

describe('the empty page never says "press Search" while it cannot be pressed (L-335)', () => {
  it('negative: Search disabled — the empty page gives the fix instead', async () => {
    localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ guardian: false }));
    await ownersCase('London');

    const empty = screen.getByTestId('search-empty').textContent ?? '';
    expect(empty).not.toMatch(/press search/i);
    expect(empty).toMatch(/tick a free feed/i);
  });

  it('happy: Search enabled — the empty page still names the button', async () => {
    await ownersCase('London');
    expect(submit().disabled).toBe(false);
    expect(screen.getByTestId('search-empty').textContent ?? '').toContain('press Search');
  });
});
