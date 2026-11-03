// @vitest-environment jsdom
/**
 * L-323: wording the owner flagged on the Search screen on 29 Oct 2026.
 *
 *   1. Arbeitnow was explained twice, one sentence above the other, as soon as
 *      a UK location was typed. The facts stay; they are said once.
 *   2. "Point at a board" read as mouse-only, when a hint opens on keyboard
 *      focus as well. The wording now says so, and a test below presses Tab
 *      on the real checkbox, so the sentence cannot promise something the
 *      screen does not do.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type JobProviderId } from '@cviper/job-apis';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';

import { Search } from './Search';
import { createFakeSearchPort } from './test/fakeSearchPort';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };

function renderSearch() {
  const user = userEvent.setup();
  render(
    <Search
      port={createFakeSearchPort()}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => NO_KEYS}
      now={NOW}
      newId={() => 'generated'}
    />,
  );
  return { user };
}

/** How many times the feed's own section tells the reader where its jobs are. */
function timesEuropeIsExplained(): number {
  const text = screen.getByTestId('keyless-feeds').textContent ?? '';
  return text.match(/europe/gi)?.length ?? 0;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('Arbeitnow is explained once (L-323)', () => {
  it('regression: a UK location does not say it a second time beside the first', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');
    await user.type(screen.getByTestId('search-location'), 'London');

    expect(screen.getByTestId('keyless-arbeitnow-uk')).toBeTruthy();
    expect(timesEuropeIsExplained()).toBe(1);
  });

  it('the note still says exactly why the box is empty, and how to change that', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');
    await user.type(screen.getByTestId('search-location'), 'London');

    expect(screen.getByTestId('keyless-arbeitnow-uk').textContent).toBe(
      'Off for a UK location. Tick it to include it.',
    );
  });

  it('keeps every fact a reader needs, on screen without a hover', async () => {
    renderSearch();

    expect((await screen.findByTestId('keyless-intro')).textContent).toBe(
      'Arbeitnow is mostly Germany and the rest of Europe. It is read here and narrowed on your ' +
        'computer, so it shows recent jobs, not the whole market.',
    );
  });

  it('negative: with no UK location there is no note, and the one explanation stays', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');
    await user.type(screen.getByTestId('search-location'), 'Berlin');

    expect(screen.queryByTestId('keyless-arbeitnow-uk')).toBeNull();
    expect(timesEuropeIsExplained()).toBe(1);
  });

  it('boundary: ticking the box for a UK location takes the note away and nothing else', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');
    await user.type(screen.getByTestId('search-location'), 'Leeds');
    await user.click(screen.getByTestId('keyless-source-arbeitnow'));

    expect(screen.queryByTestId('keyless-arbeitnow-uk')).toBeNull();
    expect(timesEuropeIsExplained()).toBe(1);
  });
});

describe('the board hint says a keyboard works too (L-323)', () => {
  const SENTENCE = 'Point at, or tab to, a board to see which filters it takes.';

  it('names both ways in', async () => {
    renderSearch();
    expect((await screen.findByTestId('keyless-bar')).textContent).toContain(SENTENCE);
  });

  it('negative: "point" never stands alone', async () => {
    renderSearch();
    const bar = await screen.findByTestId('keyless-bar');
    expect(bar.textContent).not.toMatch(/point at a board/i);
  });

  it('keeps its promise: Tab onto a board and its hint opens', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');
    const board = screen.getByTestId('keyless-linkedin');
    const tip = () =>
      document.getElementById(board.getAttribute('aria-describedby') ?? '') as HTMLElement;
    expect(tip().hidden).toBe(true);

    // The real key from the top of the page, so this cannot pass on a `focus()`
    // call that no keyboard could have made.
    for (let presses = 0; presses < 40 && document.activeElement !== board; presses += 1) {
      await user.tab();
    }

    expect(document.activeElement).toBe(board);
    expect(tip().hidden).toBe(false);
    expect(tip().textContent).toContain('LinkedIn');
  });
});
