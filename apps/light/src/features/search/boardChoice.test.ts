// @vitest-environment jsdom
/**
 * Which job boards are ticked, remembered, and opened together (L-219 part 4).
 *
 * Every board here is invented (`.invalid` hosts), like `KeylessBar.test.tsx`:
 * nothing in this model may know a real board's name or address.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type Board } from '../boards/model';

import {
  BOARD_CHOICE_STORAGE_KEY,
  openBoards,
  openBoardsDisabledReason,
  openBoardsLabel,
  readBoardChoice,
  tickedBoards,
  toggleBoard,
} from './boardChoice';
import { EMPTY_FORM, boardSearchInput } from './model';

const BOARDS: readonly Board[] = [
  {
    id: 'first',
    label: 'First Board',
    urlTemplate: 'https://first.invalid/jobs?q={keyword}&where={location}',
    encoding: 'plus',
    enabled: true,
    userAdded: false,
  },
  {
    id: 'second',
    label: 'Second Board',
    urlTemplate: 'https://second.invalid/{keyword}-jobs-in-{location}',
    encoding: 'hyphen',
    enabled: true,
    userAdded: false,
  },
  {
    id: 'off',
    label: 'Switched Off',
    urlTemplate: 'https://off.invalid/jobs?q={keyword}',
    encoding: 'plus',
    enabled: false,
    userAdded: false,
  },
  {
    id: 'mine',
    label: 'My Board',
    urlTemplate: 'https://mine.invalid/search?q={keyword}',
    encoding: 'plus',
    enabled: true,
    userAdded: true,
  },
];

const INPUT = boardSearchInput({ ...EMPTY_FORM, keywords: 'business analyst', location: 'Leeds' });

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('remembering the ticked boards', () => {
  it('starts with nothing ticked', () => {
    expect(readBoardChoice()).toEqual([]);
  });

  it('is stored under the app prefix, so "Delete everything" clears it', () => {
    expect(BOARD_CHOICE_STORAGE_KEY.startsWith('cviper.light.')).toBe(true);
    toggleBoard([], 'first', true, BOARDS);
    expect(localStorage.getItem(BOARD_CHOICE_STORAGE_KEY)).toBe('["first"]');
    expect(readBoardChoice()).toEqual(['first']);
  });

  it('toggling off removes it; toggling twice is a no-op', () => {
    const on = toggleBoard([], 'second', true, BOARDS);
    expect(toggleBoard(on, 'second', true, BOARDS)).toEqual(['second']);
    expect(toggleBoard(on, 'second', false, BOARDS)).toEqual([]);
  });

  it('boundary: an id that no longer exists, or is switched off, drops out silently', () => {
    localStorage.setItem(BOARD_CHOICE_STORAGE_KEY, '["gone","off","first"]');
    expect(tickedBoards(BOARDS, readBoardChoice()).map((board) => board.id)).toEqual(['first']);
    // And the next write leaves them behind.
    expect(toggleBoard(readBoardChoice(), 'mine', true, BOARDS)).toEqual(['first', 'mine']);
  });

  it('negative: garbage in storage reads as nothing ticked', () => {
    localStorage.setItem(BOARD_CHOICE_STORAGE_KEY, '{not json');
    expect(readBoardChoice()).toEqual([]);
    localStorage.setItem(BOARD_CHOICE_STORAGE_KEY, '[1, null, "first"]');
    expect(readBoardChoice()).toEqual(['first']);
  });
});

describe('which boards a Search opens', () => {
  it('the ticked, enabled boards, in the board list’s order — not the order they were ticked', () => {
    expect(tickedBoards(BOARDS, ['mine', 'first']).map((board) => board.id)).toEqual([
      'first',
      'mine',
    ]);
  });
});

describe('the button says what will happen', () => {
  // L-329: the count is on the boards' own button now; Search is just "Search".
  it('no count with nothing ticked, and the count when boards are', () => {
    expect(openBoardsLabel(0)).toBe('Also open in job boards');
    expect(openBoardsLabel(1)).toBe('Also open in 1 board');
    expect(openBoardsLabel(3)).toBe('Also open in 3 boards');
  });

  it('boundary: says why it cannot be pressed with none ticked, and nothing with one', () => {
    expect(openBoardsDisabledReason(0)).toContain('Tick a job board');
    expect(openBoardsDisabledReason(1)).toBeNull();
  });
});

describe('opening the boards', () => {
  it('one call per board, in order, each with that board’s pre-filled link', async () => {
    const browser = createFakeBrowserPort();
    const failed = await openBoards(browser, tickedBoards(BOARDS, ['mine', 'first']), INPUT);

    expect(failed).toEqual([]);
    expect(browser.opened()).toEqual([
      'https://first.invalid/jobs?q=business+analyst&where=Leeds',
      'https://mine.invalid/search?q=business+analyst',
    ]);
  });

  it('negative: one that will not open is named, and the rest still open', async () => {
    const browser = createFakeBrowserPort();
    browser.failNext();
    const failed = await openBoards(browser, tickedBoards(BOARDS, ['first', 'second']), INPUT);

    expect(failed).toEqual(['First Board']);
    expect(browser.opened()).toEqual(['https://second.invalid/business-analyst-jobs-in-Leeds']);
  });

  it('boundary: nothing ticked opens nothing', async () => {
    const browser = createFakeBrowserPort();
    expect(await openBoards(browser, [], INPUT)).toEqual([]);
    expect(browser.opened()).toEqual([]);
  });
});
