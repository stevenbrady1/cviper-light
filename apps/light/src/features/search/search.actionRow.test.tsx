// @vitest-environment jsdom
/**
 * L-433 — Search has ONE action row.
 *
 * It had four places: Search and its reason (L-335), a second row for "Also
 * open" and its reason (L-329), a quiet line for "Found one? Bring it in"
 * (L-324), and a dashed pill for "Save this search" outside the form (L-309).
 * Now they sit in one row, in that order, with a thin divider before the two
 * quiet buttons. A greyed button's reason is on one line UNDER the buttons,
 * inside the same sticky box, and each button points at its own reason.
 *
 * "Save this search" keeps its name box OUTSIDE the search form: the box is a
 * form of its own and forms cannot nest. Only the opener joins the row, as a
 * `type="button"`, so it never submits the search.
 *
 * jsdom draws no layout, so the wrap, the 44px phone height and the sticky
 * place are proved in `e2e/contrast-webkit.spec.ts`.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyQuota, type JobProviderId } from '@cviper/job-apis';

import { QUIET_BUTTON } from '../../app/buttons';
import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';
import { NO_PREFERENCES } from '../boards/model';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';

import { COUNTRY_STORAGE_KEY } from './country';
import { FEED_CHOICE_KEY } from './feedDefaults';
import { Search } from './Search';
import { createFakeSearchPort, outcomeOf } from './test/fakeSearchPort';

const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };

function renderSearch(onOpenReedKey?: () => void) {
  const user = userEvent.setup();
  const port = createFakeSearchPort();
  port.nextOutcome(outcomeOf([], emptyQuota('2026-08-19')));
  const browser = createFakeBrowserPort();
  render(
    <Search
      port={port}
      browser={browser}
      boardsPort={createFakeBoardPort(NO_PREFERENCES)}
      readKeyStates={async () => NO_KEYS}
      now={new Date('2026-08-19T09:00:00.000Z')}
      onOpenSettings={vi.fn()}
      onBringJobIn={vi.fn()}
      onOpenReedKey={onOpenReedKey}
    />,
  );
  return { user, port, browser };
}

const row = () => screen.getByTestId('search-submit-row');
const byId = (id: string) => screen.getByTestId(id) as HTMLButtonElement;
const ROW_BUTTONS = ['search-submit', 'search-open-boards', 'saved-search-open', 'search-bring-in'];

/** Tick a board, so "Also open" is enabled. */
async function tickABoard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId('keyless-reed'));
  await vi.waitFor(() => expect(byId('search-open-boards').disabled).toBe(false));
}

/** The line under the buttons: after the line holding every button, inside the row. */
function reasonLine(): HTMLElement {
  const line = screen.getByTestId('search-reason-area');
  expect(row().contains(line)).toBe(true);
  const buttons = line.previousElementSibling;
  expect(buttons).not.toBeNull();
  for (const id of ROW_BUTTONS) expect(buttons?.contains(byId(id)), id).toBe(true);
  return line;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(COUNTRY_STORAGE_KEY, 'gb');
});
afterEach(cleanup);

describe('one action row (L-433)', () => {
  it('happy: Search, Also open, Save this search, Found one — in that order, all in the row', async () => {
    renderSearch();
    await screen.findByTestId('keyless-bar');
    const inRow = [...row().querySelectorAll('button')].map((b) => b.dataset.testid);
    expect(inRow).toEqual(ROW_BUTTONS);
    expect(screen.getByTestId('search-form').contains(row())).toBe(true);
  });

  it('happy: exactly one blue button; Save and Found one are plain quiet buttons, no dashed edge', async () => {
    renderSearch();
    await screen.findByTestId('keyless-bar');
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
    expect(byId('search-submit').dataset.primary).toBe('true');
    for (const id of ['saved-search-open', 'search-bring-in']) {
      expect(byId(id).className, id).toBe(QUIET_BUTTON);
      expect(byId(id).className, id).not.toMatch(/dashed/);
    }
  });

  it('a thin divider sits before the quiet buttons: hidden from screen readers, and below md:', async () => {
    renderSearch();
    await screen.findByTestId('keyless-bar');
    const divider = screen.getByTestId('search-row-divider');
    expect(divider.getAttribute('aria-hidden')).toBe('true');
    const classes = divider.className.split(' ');
    for (const name of ['hidden', 'md:block', 'w-px', 'h-5', 'bg-line']) {
      expect(classes).toContain(name);
    }
    const order = [byId('search-open-boards'), divider, byId('saved-search-open')];
    expect(order[0]?.compareDocumentPosition(divider)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(divider.compareDocumentPosition(byId('saved-search-open'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('interaction: Save this search opens the name box OUTSIDE the search form, focus in it; Escape returns focus to the opener', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.click(byId('saved-search-open'));

    const box = screen.getByTestId('saved-search-form');
    expect(screen.getByTestId('search-form').contains(box)).toBe(false);
    expect(document.activeElement).toBe(screen.getByTestId('saved-search-name'));
    // The opener stays in the row while the box is open: the row does not jump.
    expect(row().contains(byId('saved-search-open'))).toBe(true);
    expect(byId('saved-search-open').getAttribute('aria-expanded')).toBe('true');

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('saved-search-form')).toBeNull();
    expect(document.activeElement).toBe(byId('saved-search-open'));
    expect(byId('saved-search-open').getAttribute('aria-expanded')).toBe('false');
  });

  it('interaction: pressing the opener again while the box is open goes back into the box and keeps what was typed', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await user.click(byId('saved-search-open'));
    await user.type(screen.getByTestId('saved-search-name'), ' kept');
    const typed = (screen.getByTestId('saved-search-name') as HTMLInputElement).value;

    await user.click(byId('saved-search-open'));
    expect(document.activeElement).toBe(screen.getByTestId('saved-search-name'));
    expect((screen.getByTestId('saved-search-name') as HTMLInputElement).value).toBe(typed);
  });

  it('negative: pressing Also open, Save this search or Found one never submits the search', async () => {
    const { user, port } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await tickABoard(user);
    await vi.waitFor(() => expect(byId('search-submit').disabled).toBe(false));
    const submitted = vi.fn((event: Event) => event.preventDefault());
    screen.getByTestId('search-form').addEventListener('submit', submitted);

    for (const id of ['search-open-boards', 'saved-search-open', 'search-bring-in']) {
      expect(byId(id).getAttribute('type'), id).toBe('button');
      await user.click(byId(id));
    }
    expect(submitted).not.toHaveBeenCalled();
    expect(port.calls.search).toBe(0);
    expect(port.calls.browseKeyless).toBe(0);
  });

  it('negative: nothing ticked — Also open is disabled, not hidden, and its reason is on the line under the row', async () => {
    renderSearch();
    await screen.findByTestId('keyless-bar');
    const also = byId('search-open-boards');
    expect(also.disabled).toBe(true);
    expect(row().contains(also)).toBe(true);
    const reason = screen.getByTestId('search-open-boards-reason');
    expect(reasonLine().contains(reason)).toBe(true);
    expect(reason.id).not.toBe('');
    expect((also.getAttribute('aria-describedby') ?? '').split(/\s+/)).toEqual([reason.id]);
  });

  it('negative: a board ticked — Also open points at nothing, and its reason is gone', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await tickABoard(user);
    expect(screen.queryByTestId('search-open-boards-reason')).toBeNull();
    expect(byId('search-open-boards').hasAttribute('aria-describedby')).toBe(false);
  });

  it('negative: Search grey in London with no key — its reason is under the row and the Reed fix still works', async () => {
    const onOpenReedKey = vi.fn();
    const { user } = renderSearch(onOpenReedKey);
    await screen.findByTestId('keyless-bar');
    await user.type(screen.getByTestId('search-location'), 'London');

    expect(byId('search-submit').disabled).toBe(true);
    const line = reasonLine();
    expect(line.contains(screen.getByTestId('search-reason'))).toBe(true);
    const fix = byId('search-get-reed-key');
    expect(line.contains(fix)).toBe(true);
    await user.click(fix);
    expect(onOpenReedKey).toHaveBeenCalledTimes(1);
  });

  it('negative: Berlin with Arbeitnow unticked — the feed fix in the line under the row ticks it and moves focus to Search', async () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, 'de');
    localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ arbeitnow: false }));
    const { user } = renderSearch();
    await screen.findByTestId('keyless-bar');

    const fix = byId('search-tick-feeds');
    expect(reasonLine().contains(fix)).toBe(true);
    await user.click(fix);
    expect(byId('search-submit').disabled).toBe(false);
    expect(document.activeElement).toBe(byId('search-submit'));
  });

  it('boundary: both buttons grey at once — both reasons on the line, each button pointing at its own', async () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, 'de');
    localStorage.setItem(FEED_CHOICE_KEY, JSON.stringify({ arbeitnow: false }));
    renderSearch();
    await screen.findByTestId('keyless-bar');

    const search = byId('search-submit');
    const also = byId('search-open-boards');
    expect(search.disabled).toBe(true);
    expect(also.disabled).toBe(true);
    const line = reasonLine();
    const searchReason = screen.getByTestId('search-reason');
    const alsoReason = screen.getByTestId('search-open-boards-reason');
    expect(line.contains(searchReason)).toBe(true);
    expect(line.contains(alsoReason)).toBe(true);
    expect(searchReason.id).not.toBe(alsoReason.id);
    expect(search.getAttribute('aria-describedby')).toBe(searchReason.id);
    expect(also.getAttribute('aria-describedby')).toBe(alsoReason.id);
  });

  it('boundary: neither button grey — no reason line at all', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('keyless-bar');
    await tickABoard(user);
    await vi.waitFor(() => expect(byId('search-submit').disabled).toBe(false));
    expect(screen.queryByTestId('search-reason-area')).toBeNull();
  });
});
