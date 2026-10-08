// @vitest-environment jsdom
/**
 * The hint (L-215): a short explanation for a symbol, badge or abbreviation,
 * shown on hover, on keyboard focus and on a tap, and always available to a
 * screen reader through `aria-describedby`.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Hint } from './Hint';

afterEach(cleanup);

function tip(): HTMLElement {
  return screen.getByRole('tooltip', { hidden: true });
}

describe('Hint', () => {
  it('describes its symbol to a screen reader before anyone hovers', () => {
    render(<Hint text="This check passed.">✓ OK</Hint>);
    const trigger = screen.getByText('✓ OK');
    const id = trigger.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe('This check passed.');
    expect(tip().hidden).toBe(true);
  });

  it('happy: shows on hover and hides when the pointer leaves', () => {
    render(<Hint text="This check passed.">✓ OK</Hint>);
    fireEvent.mouseEnter(screen.getByText('✓ OK'));
    expect(tip().hidden).toBe(false);
    fireEvent.mouseLeave(screen.getByText('✓ OK'));
    expect(tip().hidden).toBe(true);
  });

  it('keyboard: Tab reaches it and shows it; Escape hides it', async () => {
    const user = userEvent.setup();
    render(<Hint text="This check passed.">✓ OK</Hint>);
    await user.tab();
    expect(document.activeElement?.textContent).toBe('✓ OK');
    expect(tip().hidden).toBe(false);
    await user.keyboard('{Escape}');
    expect(tip().hidden).toBe(true);
  });

  it('negative: leaving with the keyboard hides it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Hint text="This check passed.">✓ OK</Hint>
        <button type="button">next</button>
      </>,
    );
    await user.tab();
    await user.tab();
    expect(tip().hidden).toBe(true);
  });

  it('touch: a tap toggles it', async () => {
    const user = userEvent.setup();
    render(<Hint text="This check passed.">✓ OK</Hint>);
    const trigger = screen.getByText('✓ OK');
    fireEvent.click(trigger);
    expect(tip().hidden).toBe(false);
    fireEvent.click(trigger);
    expect(tip().hidden).toBe(true);
    await user.click(document.body);
  });

  it('an interactive trigger keeps its own click, and gains the description', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Hint text="You moved past this step without doing it.">
        {(trigger) => (
          <button type="button" onClick={onClick} {...trigger}>
            ⊘ Analyse
          </button>
        )}
      </Hint>,
    );
    const button = screen.getByRole('button', { name: '⊘ Analyse' });
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
      'You moved past this step without doing it.',
    );
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    button.focus();
    expect(tip().hidden).toBe(false);
  });

  it('boundary: near the right edge of a phone screen the tip stays on screen', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    render(<Hint text="A long explanation that needs room.">▼ -3</Hint>);
    const trigger = screen.getByText('▼ -3');
    trigger.getBoundingClientRect = () =>
      ({ left: 350, right: 370, top: 100, bottom: 116, width: 20, height: 16 }) as DOMRect;
    tip().getBoundingClientRect = () =>
      ({ left: 0, right: 200, top: 0, bottom: 40, width: 200, height: 40 }) as DOMRect;

    fireEvent.mouseEnter(trigger);

    const left = Number.parseFloat(tip().style.left);
    expect(left + 200).toBeLessThanOrEqual(375 - 8);
    expect(left).toBeGreaterThanOrEqual(8);
  });

  it('two hints never share an id', () => {
    render(
      <>
        <Hint text="one">A</Hint>
        <Hint text="two">B</Hint>
      </>,
    );
    const a = screen.getByText('A').getAttribute('aria-describedby');
    const b = screen.getByText('B').getAttribute('aria-describedby');
    expect(a).not.toBe(b);
  });

  it('focusable={false}: hover and tap still show it, but Tab passes it by', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Hint text="How far this job has got." focusable={false}>
          ●●○○○
        </Hint>
        <button type="button">Continue</button>
      </>,
    );
    await user.tab();
    expect(document.activeElement?.textContent).toBe('Continue');
    fireEvent.mouseEnter(screen.getByText('●●○○○'));
    expect(tip().hidden).toBe(false);
  });
});
