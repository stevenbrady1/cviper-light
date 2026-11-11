// @vitest-environment jsdom
/**
 * The one pop-up window (L-356). `ConfirmDelete`, `ConsentGate` and
 * `TailorContactDialog` each used to build their own backdrop, dialog markers,
 * focus trap, first focus and Escape. These tests pin the shared part, so the
 * three cannot drift apart again.
 *
 * Their own test files still run unedited: they are the proof that moving onto
 * the shared part changed nothing a user can see or do.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DetailPane } from '../app/DetailPane';

import { Dialog } from './Dialog';

afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

/** A phone-sized window, so the detail pane covers the screen and traps focus too. */
function narrowWindow(): void {
  const list = {
    matches: false,
    media: '(min-width: 48rem)',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => list,
  });
}

interface HostProps {
  /** How many buttons the pop-up holds: 0, 1 or 3. */
  readonly controls?: 0 | 1 | 3;
  readonly onEscape?: () => void;
}

/**
 * A page with an opener and a control behind the pop-up. With three controls,
 * first focus is named as the MIDDLE one, so a pop-up that simply focused its
 * first control would fail.
 */
function Host({ controls = 3, onEscape }: HostProps) {
  const [open, setOpen] = useState(false);
  const middleRef = useRef<HTMLButtonElement>(null);
  const onlyRef = useRef<HTMLButtonElement>(null);
  const nothingRef = useRef<HTMLElement>(null);
  const close = (): void => {
    onEscape?.();
    setOpen(false);
  };
  const initialFocus = controls === 3 ? middleRef : controls === 1 ? onlyRef : nothingRef;

  return (
    <div>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button" data-testid="behind">
        Behind
      </button>
      {open ? (
        <Dialog
          initialFocus={initialFocus}
          onEscape={close}
          labelledBy="test-dialog-title"
          testId="test-dialog"
        >
          <h2 id="test-dialog-title">A question</h2>
          {controls === 3 ? (
            <>
              <button type="button" data-testid="first">
                First
              </button>
              <button ref={middleRef} type="button" data-testid="middle" onClick={() => undefined}>
                Middle
              </button>
              <button type="button" data-testid="last" onClick={() => setOpen(false)}>
                Last
              </button>
            </>
          ) : null}
          {controls === 1 ? (
            <button ref={onlyRef} type="button" data-testid="only">
              Only
            </button>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}

async function open(props: HostProps = {}) {
  const user = userEvent.setup();
  render(<Host {...props} />);
  await user.click(screen.getByTestId('opener'));
  return user;
}

describe('Dialog (L-356)', () => {
  it('puts the dialog markers on the element that holds the controls', async () => {
    await open();

    const dialog = screen.getByTestId('test-dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('test-dialog-title');
    expect(dialog.contains(screen.getByTestId('middle'))).toBe(true);
    expect(screen.getByRole('dialog', { name: 'A question' })).toBe(dialog);
  });

  it('first focus lands on the control the caller named, not the first one', async () => {
    await open();

    expect(document.activeElement).toBe(screen.getByTestId('middle'));
  });

  it('Tab from the last control wraps forward to the first', async () => {
    const user = await open();
    screen.getByTestId('last').focus();

    await user.tab();

    expect(document.activeElement).toBe(screen.getByTestId('first'));
  });

  it('Shift+Tab from the first control wraps backward to the last', async () => {
    const user = await open();
    screen.getByTestId('first').focus();

    await user.tab({ shift: true });

    expect(document.activeElement).toBe(screen.getByTestId('last'));
  });

  it('negative: Tab never reaches the page behind', async () => {
    const user = await open();

    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(screen.getByTestId('test-dialog').contains(document.activeElement)).toBe(true);
    }
  });

  it('returns focus to the opener when Escape closes it', async () => {
    const user = await open();

    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('test-dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('opener'));
  });

  it('returns focus to the opener when one of its own buttons closes it', async () => {
    const user = await open();

    await user.click(screen.getByTestId('last'));

    expect(screen.queryByTestId('test-dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('opener'));
  });

  it('Escape closes it exactly once', async () => {
    const onEscape = vi.fn();
    const user = await open({ onEscape });

    await user.keyboard('{Escape}');

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('Escape claims the key, so nothing underneath also acts on it', async () => {
    const user = await open();
    const seen: boolean[] = [];
    const late = (event: KeyboardEvent): void => {
      seen.push(event.defaultPrevented);
    };
    document.addEventListener('keydown', late);

    await user.keyboard('{Escape}');
    document.removeEventListener('keydown', late);

    expect(seen).toEqual([true]);
  });

  it('negative: Enter does not close it', async () => {
    const onEscape = vi.fn();
    const user = await open({ onEscape });

    await user.keyboard('{Enter}');

    expect(onEscape).not.toHaveBeenCalled();
    expect(screen.getByTestId('test-dialog')).toBeTruthy();
  });

  it('negative: a click on the backdrop does not close it', async () => {
    const onEscape = vi.fn();
    const user = await open({ onEscape });
    const backdrop = screen.getByTestId('test-dialog').parentElement;
    expect(backdrop).not.toBeNull();

    await user.click(backdrop as HTMLElement);

    expect(onEscape).not.toHaveBeenCalled();
    expect(screen.getByTestId('test-dialog')).toBeTruthy();
  });

  it('boundary: one focusable control — focus lands on it and Tab stays on it', async () => {
    const user = await open({ controls: 1 });
    expect(document.activeElement).toBe(screen.getByTestId('only'));

    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId('only'));

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByTestId('only'));
  });

  it('boundary: no focusable control — Tab does not reach the page, Escape still closes', async () => {
    const onEscape = vi.fn();
    const user = await open({ controls: 0, onEscape });

    await user.tab();
    expect(document.activeElement).not.toBe(screen.getByTestId('behind'));

    await user.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('test-dialog')).toBeNull();
  });

  describe('inside the detail pane, on a phone-sized window', () => {
    function PaneHost({ onPaneClose }: { readonly onPaneClose: () => void }) {
      return (
        <DetailPane title="Quant Developer" onClose={onPaneClose}>
          <Host />
        </DetailPane>
      );
    }

    it('Escape closes the pop-up and NOT the pane', async () => {
      narrowWindow();
      const onPaneClose = vi.fn();
      const user = userEvent.setup();
      render(<PaneHost onPaneClose={onPaneClose} />);
      await user.click(screen.getByTestId('opener'));

      await user.keyboard('{Escape}');

      expect(screen.queryByTestId('test-dialog')).toBeNull();
      expect(onPaneClose).not.toHaveBeenCalled();
      expect(screen.getByTestId('detail-pane')).toBeTruthy();
    });

    it('the pane takes Escape back once the pop-up has gone', async () => {
      narrowWindow();
      const onPaneClose = vi.fn();
      const user = userEvent.setup();
      render(<PaneHost onPaneClose={onPaneClose} />);
      await user.click(screen.getByTestId('opener'));

      await user.keyboard('{Escape}');
      await user.keyboard('{Escape}');

      expect(onPaneClose).toHaveBeenCalledTimes(1);
    });

    it('Tab wraps inside the pop-up, not the pane around it', async () => {
      narrowWindow();
      const user = userEvent.setup();
      render(<PaneHost onPaneClose={() => undefined} />);
      await user.click(screen.getByTestId('opener'));
      screen.getByTestId('last').focus();

      await user.tab();

      expect(document.activeElement).toBe(screen.getByTestId('first'));
    });
  });
});
