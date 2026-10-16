// @vitest-environment jsdom
/**
 * The row of board checkboxes, driven entirely by the board list it is given
 * (L-219 part 4: ticked here, opened by the page's Search through `openBoards`).
 *
 * Every board used below is INVENTED. Not one of them is in
 * `job-boards.json`, which is the point: if this component knew any board's
 * name, host or order, these tests could not pass. It is the counterpart to
 * `noHardCodedBoards.test.ts`, which scans the source for the same claim.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type Board } from '../boards/model';

import { openBoards, tickedBoards } from './boardChoice';
import { KeylessBar } from './KeylessBar';
import { EMPTY_FORM, boardSearchInput, type SearchForm } from './model';

const MADE_UP: readonly Board[] = [
  {
    id: 'first-board',
    label: 'First Board',
    urlTemplate: 'https://first.invalid/jobs?q={keyword}&where={location}',
    encoding: 'plus',
    enabled: true,
    userAdded: false,
  },
  {
    id: 'second-board',
    label: 'Second Board',
    urlTemplate: 'https://second.invalid/{keyword}-jobs-in-{location}',
    encoding: 'hyphen',
    enabled: true,
    userAdded: false,
  },
  {
    id: 'third-board',
    label: 'Third Board',
    urlTemplate: 'https://third.invalid/jobs?q={keyword}',
    encoding: 'plus',
    enabled: false,
    userAdded: true,
  },
];

const FORM: SearchForm = { ...EMPTY_FORM, keywords: 'business analyst', location: 'Milton Keynes' };

function renderBar(boards: readonly Board[], ticked: readonly string[] = []) {
  const onToggle = vi.fn<(id: string, on: boolean) => void>();
  render(<KeylessBar boards={boards} ticked={new Set(ticked)} onToggle={onToggle} />);
  return { onToggle, user: userEvent.setup() };
}

/** What a Search opens for these boards, ticked as given: the page's own path. */
async function openFor(
  ids: readonly string[],
  form: SearchForm = FORM,
): Promise<readonly string[]> {
  const browser = createFakeBrowserPort();
  await openBoards(browser, tickedBoards(MADE_UP, ids), boardSearchInput(form));
  return browser.opened();
}

afterEach(() => {
  cleanup();
});

describe('the keyless board checkboxes', () => {
  it('renders one checkbox per ENABLED board, in the order it was given', () => {
    renderBar(MADE_UP);

    const labels = screen.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent);

    expect(labels).toEqual(['First Board', 'Second Board']);
  });

  it('ticking a board tells the page which one, and nothing is opened by the tick', async () => {
    const { onToggle, user } = renderBar(MADE_UP);

    await user.click(screen.getByTestId('keyless-second-board'));

    expect(onToggle).toHaveBeenCalledWith('second-board', true);
  });

  it('shows what is ticked', () => {
    renderBar(MADE_UP, ['second-board']);
    expect((screen.getByTestId('keyless-second-board') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('keyless-first-board') as HTMLInputElement).checked).toBe(false);
  });

  it('opens the exact URL for the board that was ticked', async () => {
    expect(await openFor(['second-board'])).toEqual([
      'https://second.invalid/business-analyst-jobs-in-Milton-Keynes',
    ]);
  });

  it('uses the same form state the real search would', async () => {
    expect(await openFor(['first-board'])).toEqual([
      'https://first.invalid/jobs?q=business+analyst&where=Milton+Keynes',
    ]);
  });

  it('negative: a board that is switched off has no checkbox, and is never opened', async () => {
    renderBar(MADE_UP);

    expect(screen.queryByTestId('keyless-third-board')).toBeNull();
    expect(await openFor(['third-board'])).toEqual([]);
  });

  it('negative: never adds anything to the link', async () => {
    expect((await openFor(['first-board']))[0]).not.toMatch(/utm_|cviper|affiliate/i);
  });

  it('boundary: with every board switched off it says so, rather than showing nothing', () => {
    // An empty box with no explanation reads as a broken screen. It also has to
    // say WHERE the switch is, because the user is looking at the search view.
    renderBar(MADE_UP.map((board) => ({ ...board, enabled: false })));

    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.getByTestId('keyless-none').textContent).toContain('Settings');
  });

  it('boundary: a board opens before a single character is typed', async () => {
    // No dangling connector, and still a URL the browser port will accept.
    expect(await openFor(['second-board'], EMPTY_FORM)).toEqual(['https://second.invalid/jobs']);
  });

  it('boundary: an empty board list is not a crash', () => {
    renderBar([]);

    expect(screen.getByTestId('keyless-none')).toBeDefined();
  });
});
