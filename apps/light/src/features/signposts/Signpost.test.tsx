// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';

import { CVIPER_PRIVACY_URL, CVIPER_URL } from './links';
import { SIGNPOSTS, Signpost, type SignpostId } from './Signpost';

/**
 * The three signposts (L-87): one line each, the same every time, opening the
 * browser only when tapped. No badge, no modal, no count, no timer, no state.
 */

const IDS: readonly SignpostId[] = ['analysis', 'tracker', 'privacy'];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Signpost', () => {
  it('renders the exact sentence for each signpost, and nothing decorative', () => {
    for (const id of IDS) {
      const browser = createFakeBrowserPort();
      render(<Signpost id={id} browser={browser} />);
      const line = screen.getByTestId(`signpost-${id}`);
      expect(line.textContent).toContain(SIGNPOSTS[id].text);
      // Plain text: no image, no badge, no counter.
      expect(line.querySelector('img, svg, [data-badge], [data-count]')).toBeNull();
      cleanup();
    }
  });

  it('happy: tapping hands the exact URL to the browser, once, and nothing else', () => {
    for (const id of IDS) {
      const browser = createFakeBrowserPort();
      render(<Signpost id={id} browser={browser} />);
      fireEvent.click(screen.getByTestId(`signpost-${id}-open`));
      expect(browser.opened()).toEqual([SIGNPOSTS[id].url]);
      cleanup();
    }
  });

  it('the analysis and tracker signposts point at the full CViper; privacy at its policy', () => {
    expect(SIGNPOSTS.analysis.url).toBe(CVIPER_URL);
    expect(SIGNPOSTS.tracker.url).toBe(CVIPER_URL);
    expect(SIGNPOSTS.privacy.url).toBe(CVIPER_PRIVACY_URL);
    for (const id of IDS) expect(SIGNPOSTS[id].url).toMatch(/^https:\/\/cviper\.ai(\/|$)/);
  });

  it('negative: rendering a signpost opens nothing on its own', () => {
    const browser = createFakeBrowserPort();
    render(<Signpost id="tracker" browser={browser} />);
    expect(browser.opened()).toEqual([]);
  });

  it('negative: never reads or writes browser storage, even when tapped', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    for (const id of IDS) {
      const browser = createFakeBrowserPort();
      render(<Signpost id={id} browser={browser} />);
      fireEvent.click(screen.getByTestId(`signpost-${id}-open`));
      cleanup();
    }
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('boundary: the text is identical on the first render and the tenth tap', () => {
    const browser = createFakeBrowserPort();
    const { rerender } = render(<Signpost id="analysis" browser={browser} />);
    const first = screen.getByTestId('signpost-analysis').textContent;
    for (let i = 0; i < 10; i += 1) {
      fireEvent.click(screen.getByTestId('signpost-analysis-open'));
      rerender(<Signpost id="analysis" browser={browser} />);
    }
    expect(screen.getByTestId('signpost-analysis').textContent).toBe(first);
    expect(browser.opened()).toHaveLength(10);
  });

  it('boundary: a browser that fails to open is not a crash and leaves no trace', () => {
    const browser = createFakeBrowserPort();
    browser.failNext();
    render(<Signpost id="privacy" browser={browser} />);
    expect(() => fireEvent.click(screen.getByTestId('signpost-privacy-open'))).not.toThrow();
    // Still exactly one line, no error banner grown underneath it.
    expect(screen.getByTestId('signpost-privacy').querySelector('[role="alert"]')).toBeNull();
  });
});
