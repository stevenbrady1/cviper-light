// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';

import { CVIPER_PRIVACY_URL } from './links';
import { SIGNPOSTS, Signpost, type SignpostId } from './Signpost';

/**
 * The one remaining signpost (L-87, narrowed by L-114): one line, the same
 * every time, opening the browser only when tapped. No badge, no modal, no
 * count, no timer, no state.
 *
 * The analysis and tracker signposts described a hosted CViper that was
 * mothballed on 10 September 2026 and whose infrastructure was deleted. They
 * are gone rather than reworded: there is no other product to point at.
 */

const IDS: readonly SignpostId[] = ['privacy'];

/**
 * The sentence, pinned as a literal rather than read back out of the module.
 * Reading `SIGNPOSTS[id].text` proves the component renders whatever it is
 * given; only a literal proves WHAT it is given, so a copy change has to be
 * made here on purpose.
 */
const EXPECTED: Readonly<Record<SignpostId, string>> = {
  privacy: 'Here is exactly what this app keeps and contacts, as a page you can link to.',
};

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

  it('says exactly the sentence that was agreed, word for word', () => {
    for (const id of IDS) {
      expect(SIGNPOSTS[id].text).toBe(EXPECTED[id]);
    }
    // And says nothing about a hosted product, which no longer exists.
    for (const id of IDS) {
      expect(SIGNPOSTS[id].text).not.toMatch(/full\s+CViper|syncs|reminders|rule set/i);
    }
  });

  it('is the only signpost left: the two that advertised the hosted product are gone', () => {
    expect(Object.keys(SIGNPOSTS)).toEqual(['privacy']);
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

  it('the privacy signpost points at this app’s own published policy page', () => {
    expect(SIGNPOSTS.privacy.url).toBe(CVIPER_PRIVACY_URL);
    expect(CVIPER_PRIVACY_URL).toBe('https://cviper.ai/privacy/');
    for (const id of IDS) expect(SIGNPOSTS[id].url).toMatch(/^https:\/\/cviper\.ai(\/|$)/);
  });

  it('negative: rendering a signpost opens nothing on its own', () => {
    const browser = createFakeBrowserPort();
    render(<Signpost id="privacy" browser={browser} />);
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
    const { rerender } = render(<Signpost id="privacy" browser={browser} />);
    const first = screen.getByTestId('signpost-privacy').textContent;
    for (let i = 0; i < 10; i += 1) {
      fireEvent.click(screen.getByTestId('signpost-privacy-open'));
      rerender(<Signpost id="privacy" browser={browser} />);
    }
    expect(screen.getByTestId('signpost-privacy').textContent).toBe(first);
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
