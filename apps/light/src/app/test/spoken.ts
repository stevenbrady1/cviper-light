/**
 * Test helper for L-299: a message is SPOKEN when a status region already on
 * the page holds its words, and the visible copy carries no role of its own
 * (so a screen reader does not hear it twice).
 */
import { screen } from '@testing-library/react';
import { expect } from 'vitest';

export function expectSpoken(visible: HTMLElement, words: string | RegExp): void {
  expect(visible.getAttribute('role'), 'the visible copy is not a second live region').toBeNull();
  const regions = screen.getAllByRole('status');
  const spoken = regions.some((region) => {
    const text = region.textContent ?? '';
    return typeof words === 'string' ? text.includes(words) : words.test(text);
  });
  expect(spoken, `a status region says ${String(words)}`).toBe(true);
}
