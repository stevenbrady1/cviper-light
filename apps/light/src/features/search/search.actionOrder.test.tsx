// @vitest-environment jsdom
/**
 * L-313 — the Search button comes after every choice that changes it.
 *
 * It said "Search (opens 3 boards)" while the boards it would open were
 * ticked BELOW it: the button was placed in L-219 part 2, when it only ran
 * CViper's own sources, and part 4 (PR 298) made the ticks below it change what
 * it does without moving it. A form is read top to bottom and its button is
 * pressed at the end, so a person either pressed it before choosing, or
 * chose and then scrolled back up.
 *
 * Now: the fields, then one "Where to look" box (job boards with a key, free
 * feeds, boards opened in the browser), then the button, then "Save this
 * search", which saves the same choices.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type JobProviderId } from '@cviper/job-apis';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';
import { SHIPPED_BOARDS } from '../boards/defaults';
import { NO_PREFERENCES, type BoardPreferences } from '../boards/model';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';

import { Search } from './Search';
import { createFakeSearchPort } from './test/fakeSearchPort';

const BOTH_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'configured', reed: 'configured' };
const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };

function renderSearch(
  keys: Record<JobProviderId, KeyState>,
  prefs: BoardPreferences = NO_PREFERENCES,
) {
  render(
    <Search
      port={createFakeSearchPort()}
      browser={createFakeBrowserPort()}
      boardsPort={createFakeBoardPort(prefs)}
      readKeyStates={async () => keys}
      now={new Date('2026-08-19T09:00:00.000Z')}
      onOpenSettings={vi.fn()}
    />,
  );
}

/** `a` comes before `b` in the page. */
function before(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** Every control in the search form that changes what Search does. */
function choices(): Element[] {
  return [...screen.getByTestId('search-form').querySelectorAll('input, select, textarea')];
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('the Search button comes after every choice that changes it (L-313)', () => {
  it.each([
    ['no job-board keys', NO_KEYS],
    ['both job-board keys', BOTH_KEYS],
  ] as const)('no field, tick or box follows the button — %s', async (_label, keys) => {
    renderSearch(keys);
    await screen.findByTestId('keyless-boards');
    if (keys === BOTH_KEYS) await screen.findByTestId('provider-adzuna');
    const submit = screen.getByTestId('search-submit');

    const all = choices();
    // The board ticks are among them: they are what the button's count is about.
    expect(all).toContain(screen.getByTestId('keyless-reed'));
    expect(all).toContain(screen.getByTestId('keyless-source-guardian'));
    expect(all.length).toBeGreaterThan(10);
    for (const control of all) expect(before(control, submit)).toBe(true);
  });

  it('feeds, keyed boards and browser boards are one "Where to look" box, between the fields and the button', async () => {
    renderSearch(BOTH_KEYS);
    const where = await screen.findByRole('region', { name: 'Where to look' });
    await within(where).findByTestId('provider-adzuna');
    expect(within(where).getByTestId('keyless-source-arbeitnow')).toBeTruthy();
    expect(within(where).getByTestId('keyless-boards')).toBeTruthy();
    expect(before(screen.getByTestId('search-contract'), where)).toBe(true);
    expect(before(where, screen.getByTestId('search-submit'))).toBe(true);
  });

  it('"Save this search" — which saves those same choices — comes straight after the button', async () => {
    renderSearch(NO_KEYS);
    const submit = await screen.findByTestId('search-submit');
    const save = screen.getByRole('button', { name: 'Save this search' });
    expect(before(submit, save)).toBe(true);
    // Before the shortcuts and results, so the two actions sit together.
    expect(before(save, screen.getByTestId('search-results-header'))).toBe(true);
    // And outside the search form: its name box is a form of its own.
    expect(screen.getByTestId('search-form').contains(save)).toBe(false);
  });

  it('boundary: every board switched off — the box still says why, and the button still follows it', async () => {
    const off = { ...NO_PREFERENCES, disabled: SHIPPED_BOARDS.map((board) => board.id) };
    renderSearch(NO_KEYS, off);
    const none = await screen.findByTestId('keyless-none');
    const where = screen.getByRole('region', { name: 'Where to look' });
    expect(where.contains(none)).toBe(true);
    expect(before(where, screen.getByTestId('search-submit'))).toBe(true);
  });

  it('negative: still exactly one blue button, and pressing a box button does not submit the form', async () => {
    renderSearch(NO_KEYS);
    await screen.findByTestId('keyless-boards');
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
    // A button inside a form submits it unless it says otherwise.
    const form = screen.getByTestId('search-form');
    for (const button of form.querySelectorAll('button')) {
      if (button.getAttribute('data-testid') === 'search-submit') continue;
      expect(button.getAttribute('type')).toBe('button');
    }
  });
});
