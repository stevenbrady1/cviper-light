// @vitest-environment jsdom
/**
 * The row of browser buttons, driven entirely by the board list it is given.
 *
 * Every board used below is INVENTED. Not one of them is in
 * `job-boards.json`, which is the point: if this component knew any board's
 * name, host or order, these tests could not pass. It is the counterpart to
 * `noHardCodedBoards.test.ts`, which scans the source for the same claim.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type Board } from '../boards/model';

import { KeylessBar } from './KeylessBar';
import { EMPTY_FORM, type SearchForm } from './model';

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

function renderBar(boards: readonly Board[], form: SearchForm = FORM) {
  const browser = createFakeBrowserPort();
  render(<KeylessBar form={form} browser={browser} boards={boards} />);
  return { browser, user: userEvent.setup() };
}

afterEach(() => {
  cleanup();
});

describe('the keyless button row', () => {
  it('renders one button per ENABLED board, in the order it was given', () => {
    renderBar(MADE_UP);

    const labels = [...screen.getByTestId('keyless-bar').querySelectorAll('button')].map(
      (button) => button.textContent,
    );

    expect(labels).toEqual(['First Board', 'Second Board']);
  });

  it('hands the browser the exact URL for the board that was pressed', async () => {
    const { browser, user } = renderBar(MADE_UP);

    await user.click(screen.getByTestId('keyless-second-board'));

    expect(browser.opened()).toEqual([
      'https://second.invalid/business-analyst-jobs-in-Milton-Keynes',
    ]);
  });

  it('uses the same form state the real search would', async () => {
    const { browser, user } = renderBar(MADE_UP);

    await user.click(screen.getByTestId('keyless-first-board'));

    expect(browser.opened()).toEqual([
      'https://first.invalid/jobs?q=business+analyst&where=Milton+Keynes',
    ]);
  });

  it('negative: a board that is switched off has no button at all', () => {
    renderBar(MADE_UP);

    expect(screen.queryByTestId('keyless-third-board')).toBeNull();
  });

  it('negative: never adds anything to the link', async () => {
    const { browser, user } = renderBar(MADE_UP);

    await user.click(screen.getByTestId('keyless-first-board'));

    expect(browser.opened()[0]).not.toMatch(/utm_|cviper|affiliate/i);
  });

  it('boundary: with every board switched off it says so, rather than showing nothing', () => {
    // An empty box with no explanation reads as a broken screen. It also has to
    // say WHERE the switch is, because the user is looking at the search view.
    renderBar(MADE_UP.map((board) => ({ ...board, enabled: false })));

    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.getByTestId('keyless-none').textContent).toContain('Settings');
  });

  it('boundary: the buttons work before a single character is typed', async () => {
    const { browser, user } = renderBar(MADE_UP, EMPTY_FORM);

    await user.click(screen.getByTestId('keyless-second-board'));

    // No dangling connector, and still a URL the browser port will accept.
    expect(browser.opened()).toEqual(['https://second.invalid/jobs']);
  });

  it('boundary: an empty board list is not a crash', () => {
    renderBar([]);

    expect(screen.getByTestId('keyless-none')).toBeDefined();
  });
});
