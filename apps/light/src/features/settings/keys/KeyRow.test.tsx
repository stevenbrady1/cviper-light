// @vitest-environment jsdom
/**
 * L-390 — one key card as a short row that opens on click.
 *
 * The row is the browser's own fold (`<details>`), like the four other folds in
 * the app. These tests pin what jsdom can see: that it IS a fold, what its
 * closed title holds, and that it is opened only once, at first draw.
 *
 * What jsdom CANNOT see (measured while writing this, L-390): it keeps a closed
 * fold's content in the DOM, styled as visible, reachable by role, clickable,
 * focusable from code AND by Tab — and it does not open a fold on Enter or
 * Space. So "Enter opens it" and "the key box is visible once open" are proved
 * in a real engine, in `e2e/contrast-webkit.spec.ts` ("Settings key rows").
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { StatusPill } from '../../../ui';

import { KeyRow } from './KeyRow';

afterEach(() => {
  cleanup();
});

function Row({ startOpen, model }: { startOpen?: boolean; model?: string | null }) {
  return (
    <KeyRow
      cardTestId="probe-card"
      rowTestId="probe-row"
      name="Acme AI"
      model={model}
      startOpen={startOpen}
      pill={
        <StatusPill tone="neutral" data-testid="probe-pill">
          Not set up
        </StatusPill>
      }
    >
      <label htmlFor="probe-input">API key</label>
      <input id="probe-input" data-testid="probe-input" />
    </KeyRow>
  );
}

function row(): HTMLDetailsElement {
  return screen.getByTestId('probe-row') as HTMLDetailsElement;
}

function title(): HTMLElement {
  const summary = row().querySelector('summary');
  if (summary === null) throw new Error('the row has no title');
  return summary;
}

describe('a key row (L-390)', () => {
  it('is a fold, closed at first draw, its title holds the name as a heading and the pill', () => {
    render(<Row />);

    expect(row().tagName).toBe('DETAILS');
    expect(row().open).toBe(false);
    // The card keeps its name: the heading labels it, as it did before.
    const heading = within(title()).getByRole('heading', { level: 3, name: 'Acme AI' });
    expect(screen.getByTestId('probe-card').getAttribute('aria-labelledby')).toBe(heading.id);
    expect(title().contains(screen.getByTestId('probe-pill'))).toBe(true);
    // Everything else is inside, not in the title.
    expect(title().contains(screen.getByTestId('probe-input'))).toBe(false);
    expect(row().contains(screen.getByTestId('probe-input'))).toBe(true);
  });

  it('a click on the title opens it, a second click closes it', async () => {
    const user = userEvent.setup();
    render(<Row />);

    await user.click(title());
    expect(row().open).toBe(true);
    await user.click(title());
    expect(row().open).toBe(false);
  });

  it('shows the quiet extra (the model) in the title only when given one', () => {
    const { rerender } = render(<Row model="gpt-5.4-mini" />);
    expect(title().textContent).toContain('gpt-5.4-mini');

    rerender(<Row model={null} />);
    expect(title().textContent).toBe('Acme AINot set up');
  });

  // NEGATIVE — a button inside a fold's title is a button inside a button.
  it('negative: the title holds no button, link or field', () => {
    render(<Row model="gpt-5.4-mini" />);

    expect(title().querySelectorAll('button, a, input, select, textarea')).toHaveLength(0);
  });

  // BOUNDARY — the L-338 rule: opened by a request once, then the user's own.
  it('boundary: started open, a re-render with start-open now false does not close it', () => {
    const { rerender } = render(<Row startOpen />);
    expect(row().open).toBe(true);

    rerender(<Row startOpen={false} />);
    expect(row().open).toBe(true);
  });

  it('boundary: started closed, a re-render asking to start open does not open it', () => {
    const { rerender } = render(<Row />);

    rerender(<Row startOpen />);
    expect(row().open).toBe(false);
  });

  // EDGE — closing is not cancelling: nothing typed is thrown away.
  it('edge: what was typed in a row is still there after closing and opening it', async () => {
    const user = userEvent.setup();
    render(<Row />);

    await user.click(title());
    await user.type(screen.getByTestId('probe-input'), 'half a key');
    await user.click(title());
    await user.click(title());

    expect((screen.getByTestId('probe-input') as HTMLInputElement).value).toBe('half a key');
  });
});
