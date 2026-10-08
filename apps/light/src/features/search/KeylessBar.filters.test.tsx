// @vitest-environment jsdom
/**
 * L-219: a job-board button opens the board with EVERY filter on the form that
 * the board can take — distance, minimum salary and contract type as well as
 * the keyword and location — and nothing for a filter left empty.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type Board } from '../boards/model';

import { KeylessBar } from './KeylessBar';
import { EMPTY_FORM, boardSearchInput, type SearchForm } from './model';

const BOARD: Board = {
  id: 'full',
  label: 'Full Board',
  urlTemplate:
    'https://full.invalid/jobs?q={keyword}&l={location}&r={radius}&min={salaryMin}&t={contract}',
  encoding: 'plus',
  filters: { contract: { permanent: 'perm', contract: 'cont' } },
  enabled: true,
  userAdded: false,
};

const FILLED: SearchForm = {
  keywords: 'software tester',
  location: 'London',
  distanceMiles: '10',
  salaryMin: '£60,000',
  contractType: 'Permanent',
};

afterEach(cleanup);

async function opened(form: SearchForm): Promise<Record<string, string>> {
  const browser = createFakeBrowserPort();
  render(<KeylessBar form={form} browser={browser} boards={[BOARD]} />);
  await userEvent.setup().click(screen.getByTestId('keyless-full'));
  const url = browser.opened().at(-1);
  if (url === undefined) throw new Error('nothing was opened');
  return Object.fromEntries(new URL(url).searchParams.entries());
}

describe('boardSearchInput (L-219)', () => {
  it('carries every field of the form', () => {
    expect(boardSearchInput(FILLED)).toEqual({
      keywords: 'software tester',
      location: 'London',
      distanceMiles: '10',
      salaryMin: '£60,000',
      contract: 'permanent',
    });
  });

  it.each([
    ['any', 'any'],
    ['Permanent', 'permanent'],
    ['Contract', 'contract'],
  ] as const)('contract type %s → %s', (choice, expected) => {
    expect(boardSearchInput({ ...FILLED, contractType: choice }).contract).toBe(expected);
  });
});

describe('the job-board buttons (L-219)', () => {
  it('happy: every filter on the form reaches the board', async () => {
    expect(await opened(FILLED)).toEqual({
      q: 'software tester',
      l: 'London',
      r: '10',
      min: '60000',
      t: 'perm',
    });
  });

  it('negative: an empty form sends no filter at all', async () => {
    expect(await opened(EMPTY_FORM)).toEqual({});
  });

  it('boundary: a salary typo or a nonsense distance is left out, the rest still goes', async () => {
    expect(await opened({ ...FILLED, distanceMiles: 'ten', salaryMin: '60k60' })).toEqual({
      q: 'software tester',
      l: 'London',
      t: 'perm',
    });
  });

  it('Contract and Any: the board’s word, or nothing', async () => {
    expect((await opened({ ...FILLED, contractType: 'Contract' }))['t']).toBe('cont');
    cleanup();
    expect(await opened({ ...FILLED, contractType: 'any' })).not.toHaveProperty('t');
  });
});
