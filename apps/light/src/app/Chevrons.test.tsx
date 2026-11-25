// @vitest-environment jsdom
/**
 * The one drawn drop-down arrow (L-461). It moved out of `ChipSelect.tsx` so
 * Search's drop-downs draw the very same one: same classes, so the chips do
 * not change on screen.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChipSelect } from './ChipSelect';
import { SelectChevron } from './Chevrons';

afterEach(cleanup);

const CHEVRON_CLASSES = [
  'pointer-events-none',
  'absolute',
  'top-1/2',
  'right-2.5',
  'inline-flex',
  '-translate-y-1/2',
  'rotate-90',
  'text-ink-muted',
];

describe('SelectChevron: the drop-down arrow (L-461)', () => {
  it('happy: one hidden span holding one svg, with the classes the chip used', () => {
    const { container } = render(<SelectChevron />);
    const mark = container.firstElementChild as HTMLElement;
    expect(mark.tagName).toBe('SPAN');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.className.split(' ')).toEqual(CHEVRON_CLASSES);
    expect(mark.querySelectorAll('svg')).toHaveLength(1);
  });

  it('negative: it adds no words and no Tab stop', () => {
    const { container } = render(<SelectChevron />);
    expect(container.textContent).toBe('');
    expect(container.querySelector('[tabindex], button, a, input, select')).toBeNull();
  });

  it('ChipSelect draws exactly one chevron, the shared one', () => {
    render(
      <ChipSelect
        id="chip-cv"
        name="Your CV"
        testId="chip-cv"
        value="a"
        options={[{ value: 'a', label: 'A' }]}
        onChange={vi.fn()}
      />,
    );
    const shared = render(<SelectChevron />).container.innerHTML;
    const chip = screen.getByTestId('chip-cv').parentElement!;
    const marks = chip.querySelectorAll('span[aria-hidden="true"]');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.outerHTML).toBe(shared);
  });
});
