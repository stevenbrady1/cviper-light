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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyQuota, type JobProviderId } from '@cviper/job-apis';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';
import { SHIPPED_BOARDS } from '../boards/defaults';
import { NO_PREFERENCES } from '../boards/model';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';

import { Search } from './Search';
import { createFakeSearchPort, outcomeOf } from './test/fakeSearchPort';

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

/*
  L-398: "Where to look" folds, so every line that said "above" pointed at a
  closed box, and two lines pointed at board buttons the screen has not had
  since L-329. Each row below is the approved wording, exactly.
*/
const BOTH_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'configured', reed: 'configured' };

function renderApproved(
  options: { keys?: Record<JobProviderId, KeyState>; boardsOff?: boolean } = {},
) {
  const user = userEvent.setup();
  const port = createFakeSearchPort();
  port.nextOutcome(outcomeOf([], emptyQuota('2026-08-19')));
  render(
    <Search
      port={port}
      browser={createFakeBrowserPort()}
      boardsPort={createFakeBoardPort(
        options.boardsOff === true
          ? { ...NO_PREFERENCES, disabled: SHIPPED_BOARDS.map((board) => board.id) }
          : NO_PREFERENCES,
      )}
      readKeyStates={async () => options.keys ?? NO_KEYS}
      now={NOW}
      newId={() => 'generated'}
    />,
  );
  return { user, port };
}

/** The whole text of every paragraph inside `root`, so a row is matched end to end. */
function paragraphs(root: HTMLElement): string[] {
  return [...root.querySelectorAll('p')].map((p) => p.textContent ?? '');
}

/** Every board off, then a search the keyed boards answer with nothing. */
async function searchWithEveryBoardOff() {
  const harness = renderApproved({ keys: BOTH_KEYS, boardsOff: true });
  await screen.findByTestId('keyless-none');
  await harness.user.click(screen.getByTestId('keyless-source-arbeitnow'));
  await harness.user.type(screen.getByTestId('search-keywords'), 'lighthouse keeper');
  await harness.user.click(screen.getByTestId('search-submit'));
  await vi.waitFor(() => expect(harness.port.calls.search).toBe(1));
  return screen.findByTestId('search-no-results');
}

describe('each wording row as approved (L-398)', () => {
  it('row 1: the summary line is the heading and what is ticked', async () => {
    renderApproved();
    await screen.findByTestId('search-empty');
    const summary = screen.getByTestId('search-where-fold').querySelector('summary');
    expect(summary?.querySelector('h2')?.textContent).toBe('Where to look');
    expect(screen.getByTestId('search-where-summary').textContent).toBe('Arbeitnow');
  });

  it('row 2: the job boards heading', async () => {
    renderApproved();
    const bar = await screen.findByTestId('keyless-bar');
    expect(bar.querySelector('h3')?.textContent).toBe('Job boards to open in your browser');
  });

  it('row 3: the instruction under it, middle sentence cut', async () => {
    renderApproved();
    expect(paragraphs(await screen.findByTestId('keyless-bar'))).toContain(
      'Tick the boards you want, then press “Also open” under Search. Point at, or tab to, a ' +
        'board to see which filters it takes.',
    );
  });

  it('row 4: the note at the foot of the boards, second sentence cut', async () => {
    renderApproved();
    expect(paragraphs(await screen.findByTestId('keyless-bar'))).toContain(
      'CViper adds nothing to the link.',
    );
  });

  it('row 5: why "Also open" is grey', async () => {
    renderApproved();
    expect((await screen.findByTestId('search-open-boards-reason')).textContent).toBe(
      'Tick a job board in “Where to look” first.',
    );
  });

  it('row 6: why Search is grey, outside the UK', async () => {
    const { user } = renderApproved();
    await screen.findByTestId('search-empty');
    await user.click(screen.getByTestId('keyless-source-arbeitnow'));
    expect(screen.getByTestId('search-reason').textContent).toBe(
      'Nothing is ticked for CViper to look at. Tick the free feed in “Where to look” — it ' +
        'needs no key. Job sites you tick open in your browser with the button below.',
    );
  });

  it('rows 7 and 8: the empty page while Search is grey, outside the UK', async () => {
    const { user } = renderApproved();
    await screen.findByTestId('search-empty');
    await user.click(screen.getByTestId('keyless-source-arbeitnow'));
    expect(paragraphs(screen.getByTestId('search-empty'))).toContain(
      'Tick a free feed in “Where to look” to see the newest adverts here — it needs no key. ' +
        'Or tick job boards in “Where to look” and press “Also open”.',
    );
  });

  it('row 8: the empty page while Search can be pressed', async () => {
    renderApproved();
    expect(paragraphs(await screen.findByTestId('search-empty'))).toContain(
      'Type a job title and press Search to see the newest adverts from the free feed. ' +
        'Or tick job boards in “Where to look” and press “Also open”.',
    );
  });

  it('row 9: no results with every board switched off', async () => {
    const line = await searchWithEveryBoardOff();
    expect(line.textContent).toBe(
      'No adverts matched that. Try broader keywords or a wider radius.',
    );
  });
});

describe('the privacy sentence, and pointers that pointed nowhere (L-398)', () => {
  it('"CViper adds nothing to the link." is still there, word for word', async () => {
    renderApproved();
    const bar = await screen.findByTestId('keyless-bar');
    expect(bar.textContent).toContain('CViper adds nothing to the link.');
  });

  it('negative: nothing on the page says "buttons above"', async () => {
    const { user } = renderApproved();
    await screen.findByTestId('search-empty');
    expect(document.body.textContent).not.toMatch(/buttons above/i);
    // Search grey: the empty page's other sentence.
    await user.click(screen.getByTestId('keyless-source-arbeitnow'));
    expect(document.body.textContent).not.toMatch(/buttons above/i);
    cleanup();

    await searchWithEveryBoardOff();
    expect(document.body.textContent).not.toMatch(/buttons above/i);
  });

  it('negative: every board off, the no-results line does not send you to job boards', async () => {
    const line = await searchWithEveryBoardOff();
    expect(line.textContent).not.toMatch(/job board|browser|button/i);
  });
});
