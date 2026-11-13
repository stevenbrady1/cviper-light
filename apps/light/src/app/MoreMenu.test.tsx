// @vitest-environment jsdom
/**
 * The small "…" menu (L-392): a button that shows and hides a short list of
 * buttons — the disclosure pattern, not a pop-up window and not a full ARIA
 * menu. Every test presses or types, then checks what happened.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MoreMenu, type MoreMenuItem } from './MoreMenu';

afterEach(cleanup);

function items(onFirst = vi.fn(), onSecond = vi.fn()): MoreMenuItem[] {
  return [
    { label: 'First thing', onSelect: onFirst, testId: 'item-first' },
    { label: 'Second thing', onSelect: onSecond, testId: 'item-second' },
  ];
}

function trigger(name = 'More actions: A job'): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name });
}

describe('MoreMenu', () => {
  it('happy: a click opens it, aria-expanded is true, and the first item has focus', async () => {
    const user = userEvent.setup();
    render(<MoreMenu label="More actions: A job" items={items()} testId="more" />);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('item-first')).toBeNull();

    await user.click(trigger());

    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(screen.getByTestId('item-first'));
    expect(screen.getByTestId('item-second').textContent).toBe('Second thing');
  });

  it('happy: choosing an item runs it once, closes the list, and puts focus back on the trigger', async () => {
    const user = userEvent.setup();
    const onFirst = vi.fn();
    render(<MoreMenu label="More actions: A job" items={items(onFirst)} />);

    await user.click(trigger());
    await user.click(screen.getByTestId('item-first'));

    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('item-first')).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });

  it('negative: Escape closes it and puts focus back on the trigger', async () => {
    const user = userEvent.setup();
    const onFirst = vi.fn();
    render(<MoreMenu label="More actions: A job" items={items(onFirst)} />);

    await user.click(trigger());
    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('item-first')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(onFirst).not.toHaveBeenCalled();
  });

  it('negative: a click outside closes it and runs nothing', async () => {
    const user = userEvent.setup();
    const onFirst = vi.fn();
    render(
      <>
        <p data-testid="elsewhere">Somewhere else on the page</p>
        <MoreMenu label="More actions: A job" items={items(onFirst)} />
      </>,
    );

    await user.click(trigger());
    await user.click(screen.getByTestId('elsewhere'));

    expect(screen.queryByTestId('item-first')).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(onFirst).not.toHaveBeenCalled();
  });

  it('negative: Tab past the last item closes it, and focus moves on', async () => {
    const user = userEvent.setup();
    render(
      <>
        <MoreMenu label="More actions: A job" items={items()} />
        <button type="button">Next on the page</button>
      </>,
    );

    await user.click(trigger());
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId('item-second'));
    await user.tab();

    expect(screen.queryByTestId('item-first')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next on the page' }));
  });

  it('negative: a disabled item is shown disabled, not hidden, and pressing it runs nothing', async () => {
    const user = userEvent.setup();
    const onFirst = vi.fn();
    render(
      <MoreMenu
        label="More actions: A job"
        items={[
          { label: 'Cannot do this now', onSelect: onFirst, disabled: true, testId: 'item-off' },
          { label: 'Second thing', onSelect: vi.fn(), testId: 'item-second' },
        ]}
      />,
    );

    await user.click(trigger());
    const off = screen.getByTestId<HTMLButtonElement>('item-off');
    expect(off.disabled).toBe(true);
    expect(off.textContent).toBe('Cannot do this now');
    fireEvent.click(off);

    expect(onFirst).not.toHaveBeenCalled();
    // Focus skips a disabled item: it lands on the first one that can be pressed.
    expect(document.activeElement).toBe(screen.getByTestId('item-second'));
  });

  it('boundary: one item only still opens, focuses it and runs it', async () => {
    const user = userEvent.setup();
    const onOnly = vi.fn();
    render(
      <MoreMenu
        label="More actions: A job"
        items={[{ label: 'Only thing', onSelect: onOnly, testId: 'item-only' }]}
      />,
    );

    await user.click(trigger());
    expect(document.activeElement).toBe(screen.getByTestId('item-only'));
    await user.keyboard('{Enter}');

    expect(onOnly).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('item-only')).toBeNull();
  });

  it('edge: inside a form, neither the trigger nor an item submits it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <MoreMenu label="More actions: A job" items={items()} />
      </form>,
    );

    await user.click(trigger());
    await user.click(screen.getByTestId('item-first'));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('edge: opening a second menu closes the first', async () => {
    const user = userEvent.setup();
    render(
      <>
        <MoreMenu
          label="More actions: One"
          items={[{ label: 'A', onSelect: vi.fn(), testId: 'one-a' }]}
        />
        <MoreMenu
          label="More actions: Two"
          items={[{ label: 'B', onSelect: vi.fn(), testId: 'two-b' }]}
        />
      </>,
    );

    await user.click(trigger('More actions: One'));
    await user.click(trigger('More actions: Two'));

    expect(screen.queryByTestId('one-a')).toBeNull();
    expect(trigger('More actions: One').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('two-b')).toBeTruthy();
  });

  it('the trigger draws the "…" icon with a spoken name, or shows its words when asked', () => {
    render(
      <>
        <MoreMenu label="More actions: A job" items={items()} testId="icon-trigger" />
        <MoreMenu label="More formats" showLabel items={items()} testId="word-trigger" />
      </>,
    );

    const icon = screen.getByTestId('icon-trigger');
    expect(icon.getAttribute('aria-label')).toBe('More actions: A job');
    expect(icon.textContent).toBe('');
    expect(icon.querySelector('svg')).not.toBeNull();

    const word = screen.getByTestId('word-trigger');
    expect(word.textContent).toBe('More formats');
    expect(word.hasAttribute('aria-label')).toBe(false);
    expect(word.querySelector('svg')).toBeNull();
    expect(screen.getByRole('button', { name: 'More formats' })).toBe(word);
  });

  it('has no axe problems with the list open, and makes no pop-up window', async () => {
    const user = userEvent.setup();
    const { container } = render(<MoreMenu label="More actions: A job" items={items()} />);
    await user.click(trigger());

    const result = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      resultTypes: ['violations'],
    });

    expect(result.violations.map((v) => v.id)).toEqual([]);
    expect(container.querySelector('[role="dialog"], [aria-modal]')).toBeNull();
  });
});
