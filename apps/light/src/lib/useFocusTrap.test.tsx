// @vitest-environment jsdom
/**
 * The focus trap every modal surface shares (L-236, issue 245).
 *
 * WCAG 2.4.3: while a modal is open, Tab must not reach the page behind it,
 * and when it closes, focus goes back to whatever opened it.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useFocusTrap } from './useFocusTrap';

afterEach(cleanup);

function Modal({ onClose, buttons = 2 }: { onClose: () => void; buttons?: number | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div ref={ref} role="dialog" aria-modal="true" data-testid="modal">
      {buttons >= 1 ? (
        <button type="button" data-testid="first" onClick={onClose}>
          First
        </button>
      ) : null}
      {buttons >= 2 ? (
        <button type="button" data-testid="last">
          Last
        </button>
      ) : null}
    </div>
  );
}

function Page({
  buttons,
  removeOpener = false,
}: {
  buttons?: number | undefined;
  removeOpener?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      {removeOpener && open ? null : (
        <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
          Open
        </button>
      )}
      <button type="button" data-testid="behind">
        Behind
      </button>
      {open ? <Modal buttons={buttons} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

async function openModal(props: { buttons?: number; removeOpener?: boolean } = {}) {
  const user = userEvent.setup();
  render(<Page {...props} />);
  await user.click(screen.getByTestId('opener'));
  return user;
}

describe('useFocusTrap', () => {
  it('Tab from the last control wraps to the first, inside the dialog', async () => {
    const user = await openModal();
    screen.getByTestId('last').focus();

    await user.tab();

    expect(document.activeElement).toBe(screen.getByTestId('first'));
  });

  it('boundary: Shift+Tab from the first control wraps to the last', async () => {
    const user = await openModal();
    screen.getByTestId('first').focus();

    await user.tab({ shift: true });

    expect(document.activeElement).toBe(screen.getByTestId('last'));
  });

  it('negative: Tab never reaches the page behind the dialog', async () => {
    const user = await openModal();
    screen.getByTestId('first').focus();

    for (let i = 0; i < 5; i += 1) {
      await user.tab();
      expect(screen.getByTestId('modal').contains(document.activeElement)).toBe(true);
    }
  });

  it('pulls focus back in when it has escaped behind the dialog', async () => {
    const user = await openModal();
    screen.getByTestId('behind').focus();

    await user.tab();

    expect(document.activeElement).toBe(screen.getByTestId('first'));
  });

  it('returns focus to the opener when the dialog closes', async () => {
    const user = await openModal();

    await user.click(screen.getByTestId('first'));

    expect(screen.queryByTestId('modal')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('opener'));
  });

  it('boundary: one control only, Tab stays on it', async () => {
    const user = await openModal({ buttons: 1 });
    screen.getByTestId('first').focus();

    await user.tab();

    expect(document.activeElement).toBe(screen.getByTestId('first'));
  });

  it('negative: an opener that has gone is not refocused, and nothing throws', async () => {
    const user = await openModal({ removeOpener: true });

    await user.click(screen.getByTestId('first'));

    // The opener on screen now is a new element; the one that opened the
    // dialog is gone, so focus is left alone rather than forced anywhere.
    expect(document.activeElement).toBe(document.body);
  });
});
