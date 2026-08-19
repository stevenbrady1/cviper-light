// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
