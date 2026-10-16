// @vitest-environment jsdom
/**
 * ConfirmDelete keeps focus while it is open (L-236, issue 245): it declared
 * `aria-modal`, but Tab still reached the page behind it, and closing it left
 * focus nowhere.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ConfirmDelete } from './ConfirmDelete';

afterEach(cleanup);

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        Delete
      </button>
      <button type="button" data-testid="behind">
        Behind
      </button>
      {open ? (
        <ConfirmDelete
          title="Quant Developer"
          company="Jane Street"
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          confirmClassName=""
        />
      ) : null}
    </div>
  );
}

describe('ConfirmDelete focus (L-236)', () => {
  it('still lands on "Keep it", not the destructive button', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByTestId('opener'));

    expect(document.activeElement).toBe(screen.getByTestId('confirm-delete-cancel'));
  });

  it('Tab from the last button stays inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByTestId('opener'));
    screen.getByTestId('confirm-delete-confirm').focus();

    await user.tab();

    expect(document.activeElement).toBe(screen.getByTestId('confirm-delete-cancel'));
  });

  it('negative: Shift+Tab from the first button does not reach the page behind', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByTestId('opener'));

    await user.tab({ shift: true });

    expect(document.activeElement).toBe(screen.getByTestId('confirm-delete-confirm'));
  });

  it('returns focus to the opener on Escape', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByTestId('opener'));

    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('confirm-delete')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('opener'));
  });
});
