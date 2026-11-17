// @vitest-environment jsdom
/**
 * L-422: Settings → Job boards lists the chosen country's boards, and says so.
 *
 * The two sentences are the owner's words (17 November 2026), pinned whole.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { COUNTRY_NOT_CHOSEN, COUNTRY_STORAGE_KEY } from '../search/country';

import { BoardSettings } from './BoardSettings';
import { NO_PREFERENCES } from './model';
import { createFakeBoardPort, type FakeBoardPort } from './test/fakeBoardPort';

/** Copied from main on 17 November 2026, before this change. */
const UK_NINE = [
  'linkedin',
  'indeed',
  'totaljobs',
  'cv-library',
  'reed',
  'adzuna',
  'google-jobs',
  'jobserve',
  'gov-uk-find-a-job',
];

const NOT_CHOSEN_LINE =
  'No country is chosen yet, so only the boards that work everywhere are listed. Choose a country on Search to see the rest.';

const OTHER_COUNTRY_LINE =
  'There are no built-in boards for your country yet, so only the boards that work everywhere are listed. You can add your own below.';

const OWN_BOARD = {
  id: 'custom-efinancialcareers',
  label: 'eFinancialCareers',
  urlTemplate: 'https://www.example.com/jobs?q={keyword}',
  encoding: 'plus',
} as const;

async function open(country: string | null, port: FakeBoardPort = createFakeBoardPort()) {
  if (country !== null) localStorage.setItem(COUNTRY_STORAGE_KEY, country);
  const user = userEvent.setup();
  render(<BoardSettings port={port} />);
  await screen.findByTestId('board-row-linkedin');
  return { user, port };
}

function rows(): string[] {
  return [...document.querySelectorAll('[data-testid^="board-row-"]')].map(
    (row) => row.getAttribute('data-testid')?.replace('board-row-', '') ?? '',
  );
}

const line = () => screen.queryByTestId('boards-country')?.textContent ?? null;

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('which country’s boards are listed', () => {
  it('United Kingdom: the nine it always had, in the same order, and the line names it', async () => {
    await open('gb');

    expect(rows()).toEqual(UK_NINE);
    expect(line()).toBe(
      'These are the boards for United Kingdom. To change the country, go to Search.',
    );
  });

  it('Germany: its four boards, and the line names Germany', async () => {
    await open('de');

    expect(rows()).toEqual(['linkedin', 'indeed-de', 'adzuna-de', 'google-jobs-de']);
    expect(line()).toBe('These are the boards for Germany. To change the country, go to Search.');
  });

  it('Canada: LinkedIn, Indeed and Google Jobs, and no UK-only board', async () => {
    await open('ca');

    expect(rows()).toEqual(['linkedin', 'indeed-ca', 'google-jobs-ca']);
    expect(line()).toBe('These are the boards for Canada. To change the country, go to Search.');
  });

  it('boundary: no country chosen yet — only the worldwide board, and the line says what to do', async () => {
    await open(COUNTRY_NOT_CHOSEN);

    expect(rows()).toEqual(['linkedin']);
    expect(line()).toBe(NOT_CHOSEN_LINE);
  });

  it('boundary: nothing stored at all reads as not chosen', async () => {
    await open(null);

    expect(rows()).toEqual(['linkedin']);
    expect(line()).toBe(NOT_CHOSEN_LINE);
  });

  it('negative: a stored value that is not a country reads as not chosen, never as a country', async () => {
    await open('atlantis');

    expect(rows()).toEqual(['linkedin']);
    expect(line()).toBe(NOT_CHOSEN_LINE);
  });

  it('“Another country”: only the worldwide board, and its own line, which points at Add', async () => {
    await open('other');

    expect(rows()).toEqual(['linkedin']);
    expect(line()).toBe(OTHER_COUNTRY_LINE);
    // “below” is true: the button that adds a board comes after the list.
    const list = screen.getByTestId('boards-list');
    const add = screen.getByTestId('boards-add-open');
    expect(list.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('negative: “Another country” is told neither that no country is chosen nor that these are its boards', async () => {
    await open('other');

    expect(line()).not.toContain('No country is chosen yet');
    expect(line()).not.toContain('These are the boards for');
  });

  it.each(['gb', 'de', 'ca', COUNTRY_NOT_CHOSEN, 'atlantis', null])(
    'negative: the “no built-in boards” line is not shown for %s',
    async (country) => {
      await open(country);

      expect(line()).not.toBeNull();
      expect(line()).not.toContain('no built-in boards');
    },
  );

  it('the line sits between the introduction and the list, and is not an alert', async () => {
    await open('de');

    const shown = screen.getByTestId('boards-country');
    const list = screen.getByTestId('boards-list');
    expect(shown.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shown.getAttribute('role')).toBeNull();
  });
});

describe('a person’s own choices, country by country', () => {
  it('a board they added is listed in every country, marked as theirs', async () => {
    await open('de', createFakeBoardPort({ ...NO_PREFERENCES, custom: [OWN_BOARD] }));

    expect(rows()).toEqual(['linkedin', 'indeed-de', 'adzuna-de', 'google-jobs-de', OWN_BOARD.id]);
    expect(screen.getByTestId(`board-remove-${OWN_BOARD.id}`)).toBeTruthy();
  });

  it('switching Germany’s Indeed off stores Germany’s id, and leaves the UK’s Indeed on', async () => {
    const { user, port } = await open('de');

    await user.click(screen.getByTestId('board-toggle-indeed-de'));
    expect(port.saved().disabled).toEqual(['indeed-de']);

    cleanup();
    await open('gb', port);
    expect((screen.getByTestId('board-toggle-indeed') as HTMLInputElement).checked).toBe(true);
    expect(rows()).toEqual(UK_NINE);
  });

  it('a UK user’s switched-off boards and order are read exactly as before', async () => {
    await open(
      'gb',
      createFakeBoardPort({ disabled: ['totaljobs'], order: ['reed', 'linkedin'], custom: [] }),
    );

    expect(rows().slice(0, 3)).toEqual(['reed', 'linkedin', 'indeed']);
    expect((screen.getByTestId('board-toggle-totaljobs') as HTMLInputElement).checked).toBe(false);
  });

  it('moving a board in Germany does not lose the order the UK list was in', async () => {
    const port = createFakeBoardPort({
      disabled: [],
      order: ['reed', 'indeed', 'linkedin'],
      custom: [],
    });
    const { user } = await open('de', port);

    await user.click(screen.getByTestId('board-up-adzuna-de'));
    expect(rows()).toEqual(['linkedin', 'adzuna-de', 'indeed-de', 'google-jobs-de']);

    cleanup();
    await open('gb', port);
    expect(rows().indexOf('reed')).toBeLessThan(rows().indexOf('indeed'));
  });
});
