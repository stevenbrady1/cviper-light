// @vitest-environment jsdom
/**
 * The hint (L-215): a short explanation for a symbol, badge or abbreviation,
 * shown on hover, on keyboard focus and on a tap, and always available to a
 * screen reader through `aria-describedby`.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  // Changed on purpose (L-384): Tab used to land on the words; it lands on the "i".
  it('keyboard: Tab reaches the i button, it has the accessible name What this means; the tip shows; Escape hides it and focus stays on the button', async () => {
    const user = userEvent.setup();
    render(<Hint text="This check passed.">✓ OK</Hint>);
    await user.tab();
    const button = screen.getByRole('button', { name: 'What this means' });
    expect(document.activeElement).toBe(button);
    expect(document.getElementById(button.getAttribute('aria-describedby')!)).toBe(tip());
    expect(tip().hidden).toBe(false);
    await user.keyboard('{Escape}');
    expect(tip().hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it('keyboard: Enter on the i shows the tip after Escape hid it, and a second Enter hides it', async () => {
    const user = userEvent.setup();
    render(<Hint text="This check passed.">✓ OK</Hint>);
    await user.tab();
    await user.keyboard('{Escape}');
    await user.keyboard('{Enter}');
    expect(tip().hidden).toBe(false);
    await user.keyboard('{Enter}');
    expect(tip().hidden).toBe(true);
  });

  it('tap: a click on the i opens it, a second closes it; a click on the words does the same', () => {
    render(<Hint text="This check passed.">✓ OK</Hint>);
    const button = screen.getByRole('button', { name: 'What this means' });
    fireEvent.click(button);
    expect(tip().hidden).toBe(false);
    fireEvent.click(button);
    expect(tip().hidden).toBe(true);
    const words = screen.getByText('✓ OK');
    fireEvent.click(words);
    expect(tip().hidden).toBe(false);
    fireEvent.click(words);
    expect(tip().hidden).toBe(true);
  });

  // A tap on a touch screen makes up a hover and a focus before its click, so
  // the tip opened on the hover and the click shut it again (seen in WebKit).
  it('touch: a hover or focus straight before the click does not make the click close it', () => {
    render(<Hint text="This check passed.">✓ OK</Hint>);
    const button = screen.getByRole('button', { name: 'What this means' });
    fireEvent.mouseEnter(button);
    fireEvent.focus(button);
    fireEvent.click(button);
    expect(tip().hidden).toBe(false);
    fireEvent.mouseEnter(button);
    fireEvent.click(button);
    expect(tip().hidden).toBe(true);
  });

  it('mouse: a real click on the i, hovered first, opens it; a second click closes it', async () => {
    const user = userEvent.setup();
    render(<Hint text="This check passed.">✓ OK</Hint>);
    const button = screen.getByRole('button', { name: 'What this means' });
    await user.click(button);
    expect(tip().hidden).toBe(false);
    await user.click(button);
    expect(tip().hidden).toBe(true);
  });

  it('negative: the words are no longer underlined and no longer a Tab stop', () => {
    render(<Hint text="This check passed.">✓ OK</Hint>);
    const words = screen.getByText('✓ OK');
    expect(words.className).not.toMatch(/underline|decoration-/);
    expect(words.hasAttribute('tabindex')).toBe(false);
    expect(words.className).toContain('cursor-help');
    expect(words.getAttribute('aria-describedby')).toBe(tip().id);
  });

  it('the i is a real button drawing the info icon, after the words, in their colour', () => {
    render(
      <Hint text="This check passed." className="text-ink-faint">
        ✓ OK
      </Hint>,
    );
    const words = screen.getByText('✓ OK');
    const button = screen.getByRole('button', { name: 'What this means' });
    expect(button.getAttribute('type')).toBe('button');
    // Inside the words' own element, last, with nothing added to their text.
    expect(words.lastElementChild?.contains(button)).toBe(true);
    expect(words.textContent).toBe('✓ OK');
    expect(words.lastElementChild?.className).not.toMatch(/(^|\s)text-/);
    expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(button.querySelector('[data-mark]')).toBeNull();
    // No colour of its own, so it takes the colour of its words.
    expect(button.className).not.toMatch(/(^|\s)text-(ink|teal|gold|blue|navy|danger)/);
  });

  it('negative: a hint on an existing button (render-function form) draws no i', () => {
    render(
      <Hint text="You moved past this step without doing it.">
        {(trigger) => (
          <button type="button" {...trigger}>
            ⊘ Analyse
          </button>
        )}
      </Hint>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'What this means' })).toBeNull();
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

  it('boundary: an i near the right edge of a 375px window keeps the tip at least 8px inside both edges', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    render(<Hint text="A long explanation that needs room.">▼ -3</Hint>);
    const trigger = screen.getByText('▼ -3');
    // The words and their "i" together reach to 1px from the window's edge.
    trigger.getBoundingClientRect = () =>
      ({ left: 330, right: 374, top: 100, bottom: 116, width: 44, height: 16 }) as DOMRect;
    tip().getBoundingClientRect = () =>
      ({ left: 0, right: 256, top: 0, bottom: 40, width: 256, height: 40 }) as DOMRect;

    act(() => screen.getByRole('button', { name: 'What this means' }).focus());

    expect(tip().hidden).toBe(false);
    const left = Number.parseFloat(tip().style.left);
    expect(left + 256).toBeLessThanOrEqual(375 - 8);
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

  // A pinned tip sits at fixed screen coordinates, so a scroll would leave it
  // floating over other content (L-385). A scroll event does not bubble: the
  // one fired here on a panel only reaches a listener that captures.
  function inPanel() {
    render(
      <div data-testid="panel">
        <Hint text="This check passed.">✓ OK</Hint>
      </div>,
    );
    return {
      panel: screen.getByTestId('panel'),
      button: screen.getByRole('button', { name: 'What this means' }),
    };
  }

  it('happy: a tip pinned by a tap closes when the panel around it scrolls', () => {
    const { panel, button } = inPanel();
    fireEvent.click(button);
    expect(tip().hidden).toBe(false);
    fireEvent.scroll(panel);
    expect(tip().hidden).toBe(true);
  });

  it('negative: a tip opened by keyboard focus stays open when the panel scrolls', () => {
    const { panel, button } = inPanel();
    act(() => button.focus());
    expect(tip().hidden).toBe(false);
    fireEvent.scroll(panel);
    expect(tip().hidden).toBe(false);
  });

  it('boundary: after a scroll closed it, one tap opens it again', () => {
    const { panel, button } = inPanel();
    fireEvent.click(button);
    fireEvent.scroll(panel);
    expect(tip().hidden).toBe(true);
    fireEvent.click(button);
    expect(tip().hidden).toBe(false);
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

  it('negative: focusable={false} draws no i and adds no Tab stop; a tap still opens it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Hint text="How far this job has got." focusable={false}>
          ●●○○○
        </Hint>
        <button type="button">Continue</button>
      </>,
    );
    expect(screen.queryByRole('button', { name: 'What this means' })).toBeNull();
    expect(screen.getByText('●●○○○').hasAttribute('tabindex')).toBe(false);
    await user.tab();
    expect(document.activeElement?.textContent).toBe('Continue');
    await user.tab();
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByText('●●○○○'));
    expect(tip().hidden).toBe(false);
  });
});
