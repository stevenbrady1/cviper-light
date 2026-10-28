// @vitest-environment jsdom
/**
 * L-299 — the always-present status region a screen reader listens to.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LiveStatus } from './LiveStatus';

afterEach(() => {
  cleanup();
});

describe('LiveStatus', () => {
  it('is a polite status region that holds the words', () => {
    render(<LiveStatus text="Key saved." testId="live" />);
    const region = screen.getByTestId('live');
    expect(region.getAttribute('role')).toBe('status');
    expect(region.textContent).toBe('Key saved.');
  });

  // BOUNDARY — the point of the component: it is on the page before there is
  // anything to say, so the first message is a change, not an insertion.
  it('boundary: is on the page, empty, when there is nothing to say', () => {
    render(<LiveStatus text={null} testId="live" />);
    const region = screen.getByTestId('live');
    expect(region.getAttribute('role')).toBe('status');
    expect(region.textContent).toBe('');
  });

  it('keeps the same region and writes a new node when the words change', () => {
    const { rerender } = render(<LiveStatus text={null} testId="live" />);
    const region = screen.getByTestId('live');
    rerender(<LiveStatus text="Saved." testId="live" />);
    const first = region.firstElementChild;
    rerender(<LiveStatus text="Saved again." testId="live" />);
    expect(screen.getByTestId('live')).toBe(region);
    expect(region.textContent).toBe('Saved again.');
    expect(region.firstElementChild).not.toBe(first);
  });

  // NEGATIVE — it takes no room on screen: it is visually hidden.
  it('negative: is visually hidden, so the visible message is not shown twice', () => {
    render(<LiveStatus text="Saved." testId="live" />);
    expect(screen.getByTestId('live').className).toContain('sr-only');
  });
});
