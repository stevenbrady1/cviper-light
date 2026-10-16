// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DetailPane } from './DetailPane';

afterEach(() => {
  cleanup();
});

describe('DetailPane', () => {
  it('shows its title, subtitle and contents', () => {
    render(
      <DetailPane title="Quant Developer" subtitle="Jane Street · London" onClose={() => {}}>
        <p>Notes go here</p>
      </DetailPane>,
    );

    expect(screen.getByTestId('detail-pane')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Quant Developer' })).toBeTruthy();
    expect(screen.getByText('Jane Street · London')).toBeTruthy();
    expect(screen.getByText('Notes go here')).toBeTruthy();
  });

  it('closes when the close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DetailPane title="Quant Developer" onClose={onClose}>
        <p>Body</p>
      </DetailPane>,
    );

    await user.click(screen.getByTestId('detail-pane-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape from anywhere on the page', () => {
    const onClose = vi.fn();
    render(
      <DetailPane title="Quant Developer" onClose={onClose}>
        <p>Body</p>
      </DetailPane>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape while a field inside it has focus', async () => {
    // The realistic case: the user is halfway through typing a note and wants
    // out. Escape has to work from inside the pane, not only from the board.
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DetailPane title="Quant Developer" onClose={onClose}>
        <textarea aria-label="Notes" defaultValue="" />
      </DetailPane>,
    );

    await user.click(screen.getByLabelText('Notes'));
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('negative: leaves Escape alone once something nearer has claimed it', () => {
    // How a destructive confirmation keeps Escape for itself: it calls
    // preventDefault, and the pane underneath must not also close — otherwise
    // one Escape cancels the dialog AND throws away the selection.
    const onClose = vi.fn();
    render(
      <DetailPane title="Quant Developer" onClose={onClose}>
        <p>Body</p>
      </DetailPane>,
    );

    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    event.preventDefault();
    document.dispatchEvent(event);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('negative: stands down while a modal dialog is open', () => {
    // REGRESSION. Both listeners live on `document`, so registration order
    // decides which runs first — and the pane always mounts before a dialog
    // inside it, so `preventDefault` from the dialog arrives too late. One
    // Escape then cancelled the dialog AND threw away the selection behind it.
    const onClose = vi.fn();
    render(
      <DetailPane title="Quant Developer" onClose={onClose}>
        <div role="dialog" aria-modal="true">
          Really delete?
        </div>
      </DetailPane>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('takes Escape back once the dialog has gone', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <DetailPane title="Quant Developer" onClose={onClose}>
        <div role="dialog" aria-modal="true">
          Really delete?
        </div>
      </DetailPane>,
    );

    rerender(
      <DetailPane title="Quant Developer" onClose={onClose}>
        <p>Body</p>
      </DetailPane>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('negative: a non-modal dialog does not claim Escape', () => {
    // `aria-modal="true"` is the whole condition. A popover or a non-modal
    // dialog does not stop the rest of the app working, so it must not steal
    // the key either.
    const onClose = vi.fn();
    render(
      <DetailPane title="Quant Developer" onClose={onClose}>
        <div role="dialog">A hint</div>
      </DetailPane>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('negative: ignores every other key', () => {
    const onClose = vi.fn();
    render(
      <DetailPane title="Quant Developer" onClose={onClose}>
        <p>Body</p>
      </DetailPane>,
    );

    for (const key of ['Enter', 'Tab', 'esc', 'Esc', ' ']) {
      fireEvent.keyDown(document, { key });
    }

    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening once it is gone', () => {
    // An unmounted pane that still answers Escape would fire a state update on
    // a component that no longer exists, from every stray keypress for the rest
    // of the session.
    const onClose = vi.fn();
    const { unmount } = render(
      <DetailPane title="Quant Developer" onClose={onClose}>
        <p>Body</p>
      </DetailPane>,
    );

    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('DetailPane on a phone keeps focus while it covers the screen (L-236)', () => {
  /** A `matchMedia` that says the window is phone-narrow or desktop-wide. */
  function installViewport(wide: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: wide,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
  }

  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
          Open card
        </button>
        <button type="button" data-testid="behind">
          Behind
        </button>
        {open ? (
          <DetailPane title="Quant Developer" onClose={() => setOpen(false)}>
            <button type="button" data-testid="inside">
              Inside
            </button>
          </DetailPane>
        ) : null}
      </div>
    );
  }

  it('narrow: focus moves into the pane when it opens', async () => {
    installViewport(false);
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByTestId('opener'));

    expect(screen.getByTestId('detail-pane').contains(document.activeElement)).toBe(true);
  });

  it('narrow: Tab from the last control wraps inside the pane', async () => {
    installViewport(false);
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByTestId('opener'));
    screen.getByTestId('inside').focus();

    await user.tab();

    expect(document.activeElement).toBe(screen.getByTestId('detail-pane-close'));
  });

  it('narrow: closing returns focus to what opened it', async () => {
    installViewport(false);
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByTestId('opener'));

    await user.click(screen.getByTestId('detail-pane-close'));

    expect(document.activeElement).toBe(screen.getByTestId('opener'));
  });

  it('negative, wide: the pane sits beside the view, so Tab may leave it', async () => {
    installViewport(true);
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByTestId('opener'));
    screen.getByTestId('inside').focus();

    await user.tab();

    expect(screen.getByTestId('detail-pane').contains(document.activeElement)).toBe(false);
  });
});
