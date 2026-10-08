// @vitest-environment jsdom
/**
 * L-219: adding your own board — the help names the filter placeholders, and
 * a board saved with them opens with your filters from the Search screen.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { buildBoardUrl } from '@cviper/job-apis';

import { BoardSettings } from './BoardSettings';
import { SHIPPED_BOARDS } from './defaults';
import { createFakeBoardPort } from './test/fakeBoardPort';

afterEach(cleanup);

async function openAddForm() {
  const user = userEvent.setup();
  const port = createFakeBoardPort();
  render(<BoardSettings port={port} />);
  await screen.findByTestId(`board-row-${SHIPPED_BOARDS[0]?.id ?? ''}`);
  await user.click(screen.getByTestId('boards-add-open'));
  return { user, port };
}

describe('the filter placeholders, for your own board (L-219)', () => {
  it('the help names each placeholder and what goes in it', async () => {
    await openAddForm();
    const help = screen.getByTestId('boards-add-placeholders').textContent ?? '';
    expect(help).toContain('{radius}');
    expect(help).toContain('miles');
    expect(help).toContain('{salaryMin}');
    expect(help).toContain('{contract}');
    expect(help).toContain('permanent');
  });

  it('happy: a board saved with them carries the filters', async () => {
    const { user, port } = await openAddForm();
    await user.type(screen.getByTestId('boards-new-label'), 'My Board');
    await user.click(screen.getByTestId('boards-new-template'));
    await user.paste(
      'https://www.example.com/jobs?q={keyword}&r={radius}&min={salaryMin}&t={contract}',
    );
    await user.click(screen.getByTestId('boards-add-submit'));

    const saved = port.saved().custom[0];
    expect(saved).toBeDefined();
    expect(
      buildBoardUrl(saved!, {
        keywords: 'tester',
        location: '',
        distanceMiles: '10',
        salaryMin: '£60k',
        contract: 'contract',
      }),
    ).toBe('https://www.example.com/jobs?q=tester&r=10&min=60000&t=contract');
  });

  it('negative: a placeholder in the site’s name is refused, with a reason', async () => {
    const { user } = await openAddForm();
    await user.type(screen.getByTestId('boards-new-label'), 'Bad');
    await user.click(screen.getByTestId('boards-new-template'));
    await user.paste('https://{contract}.example.com/jobs?q={keyword}');
    await user.click(screen.getByTestId('boards-add-submit'));
    expect(screen.getByTestId('boards-new-template-error').textContent).toContain('site');
  });
});
