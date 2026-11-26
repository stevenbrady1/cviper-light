// @vitest-environment jsdom
/**
 * "Best match first" wears the house tick box (L-462): the blue `size-4
 * accent-blue` the "Where to look" ticks use, on a label that is a whole 44px
 * touch target on a phone and shrinks to its line from `md` up. Still a real
 * tick box, so the keyboard and screen readers work as before.
 */
import { emptyQuota } from '@cviper/job-apis';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchResultsHeader, type SearchResultsHeaderProps } from './SearchResultsHeader';

afterEach(cleanup);

function renderHeader(props: Partial<SearchResultsHeaderProps> = {}) {
  const onBestFirst = vi.fn();
  render(
    <SearchResultsHeader
      cvText="A CV"
      rankable
      bestFirst={false}
      onBestFirst={onBestFirst}
      quota={emptyQuota('2026-08-19')}
      keyStates={{ reed: 'missing', adzuna: 'missing' }}
      {...props}
    />,
  );
  return { onBestFirst, user: userEvent.setup() };
}

function tick(): HTMLInputElement {
  return screen.getByTestId('search-sort-best') as HTMLInputElement;
}

describe('"Best match first" tick box (L-462)', () => {
  it('happy: the house tick style, on a 44px phone label that shrinks from md up', () => {
    renderHeader();
    expect(tick().type).toBe('checkbox');
    expect(tick().className.split(' ')).toEqual(expect.arrayContaining(['size-4', 'accent-blue']));
    const label = tick().closest('label')!;
    expect(label.className.split(' ')).toEqual(expect.arrayContaining(['min-h-11', 'md:min-h-0']));
  });

  it('negative: the name is unchanged, and it is not a blue button', () => {
    renderHeader();
    expect(screen.getByRole('checkbox', { name: 'Best match first' })).toBe(tick());
    expect(tick().closest('[data-primary]')).toBeNull();
  });

  it('boundary: with nothing to rank against there is no tick box, only the hint', () => {
    renderHeader({ rankable: false });
    expect(screen.queryByTestId('search-sort-best')).toBeNull();
    expect(screen.getByTestId('search-rank-hint')).toBeTruthy();
  });

  it('interaction: a press on the words ticks it, and a press on a ticked box unticks it', async () => {
    const { onBestFirst, user } = renderHeader();
    await user.click(screen.getByText('Best match first'));
    expect(onBestFirst).toHaveBeenCalledWith(true);

    cleanup();
    const ticked = renderHeader({ bestFirst: true });
    await ticked.user.click(tick());
    expect(ticked.onBestFirst).toHaveBeenCalledWith(false);
  });
});
