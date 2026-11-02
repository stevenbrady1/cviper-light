// @vitest-environment jsdom
/**
 * L-342 — the submit row is pinned from `md:` up, and only from `md:` up.
 *
 * jsdom does no layout, so whether the row really stays on screen is proved in
 * `e2e/contrast-webkit.spec.ts`. This is the cheap half: phones stay out of it,
 * since an on-screen keyboard plus a tall wrapped row would cover the fields,
 * and moving focus to Search never scrolls the form it is pinned over.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';

import { Search } from './Search';
import { SearchSubmitRow } from './SearchSubmitRow';
import { createFakeSearchPort } from './test/fakeSearchPort';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the pinned submit row (L-342)', () => {
  it('is sticky from md: up, and nothing about it is unconditional', () => {
    render(<SearchSubmitRow running={false} disabledReason={null} fix={null} />);
    const classes = screen.getByTestId('search-submit-row').className.split(' ');
    expect(classes).toContain('md:sticky');
    expect(classes).toContain('md:bg-canvas');
    // The phone's spacing, as it always was.
    expect(classes).toContain('mt-4');
    for (const phoneChange of ['sticky', 'bg-canvas', '-bottom-5', 'pt-4', 'pb-3']) {
      expect(classes).not.toContain(phoneChange);
    }
  });

  it('gives the scroll area room to keep a focused tick clear of it, from md: up', async () => {
    render(
      <Search
        port={createFakeSearchPort()}
        browser={createFakeBrowserPort()}
        readKeyStates={async () => ({ adzuna: 'missing', reed: 'missing' })}
        now={new Date('2026-08-19T09:00:00.000Z')}
        onOpenSettings={vi.fn()}
      />,
    );
    const form = await screen.findByTestId('search-form');
    const area = form.closest('.overflow-y-auto');
    expect(area?.className.split(' ')).toContain('md:scroll-pb-40');
    expect(area?.className).not.toMatch(/(^|\s)scroll-pb-/);
  });

  it('moves focus to Search without scrolling, once the fix has enabled it', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const fix = { label: 'Tick the free feed', onFix: vi.fn() };
    const user = userEvent.setup();
    const { rerender } = render(
      <SearchSubmitRow running={false} disabledReason="Nothing is ticked." fix={fix} />,
    );

    await user.click(screen.getByRole('button', { name: 'Tick the free feed' }));
    expect(fix.onFix).toHaveBeenCalledOnce();
    rerender(<SearchSubmitRow running={false} disabledReason={null} fix={null} />);

    expect(screen.getByTestId('search-submit')).toHaveProperty('disabled', false);
    expect(document.activeElement).toBe(screen.getByTestId('search-submit'));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  // NEGATIVE — no fix pressed, so nothing takes focus just because the reason went.
  it('leaves focus alone when the button is enabled some other way', () => {
    const { rerender } = render(
      <SearchSubmitRow running={false} disabledReason="Nothing is ticked." fix={null} />,
    );
    rerender(<SearchSubmitRow running={false} disabledReason={null} fix={null} />);
    expect(document.activeElement).not.toBe(screen.getByTestId('search-submit'));
  });
});
