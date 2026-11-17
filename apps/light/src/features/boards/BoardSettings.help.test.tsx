// @vitest-environment jsdom
/**
 * The "add your own board" help names no country's money (L-423).
 *
 * `{salaryMin}` carries the number typed on Search, in whatever currency the
 * person searches in. It was described as "in pounds".
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { BoardSettings } from './BoardSettings';
import { createFakeBoardPort } from './test/fakeBoardPort';

afterEach(cleanup);

async function help(): Promise<string> {
  const user = userEvent.setup();
  render(<BoardSettings port={createFakeBoardPort()} />);
  await user.click(await screen.findByTestId('boards-add-open'));
  return (screen.getByTestId('boards-add-placeholders').textContent ?? '').replace(/\s+/g, ' ');
}

describe('the placeholder help, for any country (L-423)', () => {
  it('happy: the salary placeholder is the minimum yearly salary, with no currency', async () => {
    expect(await help()).toContain('{salaryMin} for the minimum yearly salary, and {contract}');
  });

  it('negative: it does not say pounds, £ or GBP', async () => {
    expect(await help()).not.toMatch(/pounds?\b|£|\bGBP\b/i);
  });

  it('boundary: the distance still says its unit, because your own board is sent miles', async () => {
    // A board you add has no unit of its own, so its {radius} is always miles
    // (L-421), whatever unit Search shows. The help must keep saying so.
    expect(await help()).toContain('{radius} for the distance in miles');
  });
});
