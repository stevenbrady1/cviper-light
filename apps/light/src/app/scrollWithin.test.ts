// @vitest-environment jsdom
/**
 * L-216: moving to a step scrolls the screen's own scroll area — and nothing
 * else. `scrollIntoView` scrolls EVERY box between the anchor and the window,
 * the app shell and the page included, which pushed the whole window up and
 * left the bottom half blank on Tailor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { scrollWithin } from './scrollWithin';

function box(top: number): DOMRect {
  return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top } as DOMRect;
}

function setUp(containerTop: number, anchorTop: number, scrollTop: number) {
  const container = document.createElement('div');
  const anchor = document.createElement('span');
  container.append(anchor);
  document.body.append(container);
  container.scrollTop = scrollTop;
  container.getBoundingClientRect = () => box(containerTop);
  anchor.getBoundingClientRect = () => box(anchorTop);
  const scrollTo = vi.fn();
  container.scrollTo = scrollTo as unknown as typeof container.scrollTo;
  return { container, anchor, scrollTo };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('scrollWithin', () => {
  it('happy: brings the anchor to the top of its own scroll area, smoothly', () => {
    const { container, anchor, scrollTo } = setUp(100, 700, 50);
    scrollWithin(container, anchor);
    expect(scrollTo).toHaveBeenCalledWith({ top: 650, behavior: 'smooth' });
  });

  it('scrolls back up to an anchor above the visible part', () => {
    const { container, anchor, scrollTo } = setUp(100, -300, 900);
    scrollWithin(container, anchor);
    expect(scrollTo).toHaveBeenCalledWith({ top: 500, behavior: 'smooth' });
  });

  it('boundary: an anchor already at the top stays where it is', () => {
    const { container, anchor, scrollTo } = setUp(100, 100, 240);
    scrollWithin(container, anchor);
    expect(scrollTo).toHaveBeenCalledWith({ top: 240, behavior: 'smooth' });
  });

  it('boundary: never asks for a position above the start', () => {
    const { container, anchor, scrollTo } = setUp(100, 0, 20);
    scrollWithin(container, anchor);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('negative: an anchor outside the scroll area moves nothing', () => {
    const { container, scrollTo } = setUp(100, 700, 0);
    const stray = document.createElement('span');
    document.body.append(stray);
    scrollWithin(container, stray);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('never touches the page, the window or any box around the scroll area', () => {
    const { container, anchor } = setUp(100, 700, 0);
    const outer = document.createElement('div');
    outer.append(container);
    document.body.append(outer);
    const intoView = vi.fn();
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    Element.prototype.scrollIntoView = intoView;
    try {
      scrollWithin(container, anchor);
      expect(intoView).not.toHaveBeenCalled();
      expect(windowScroll).not.toHaveBeenCalled();
      expect(outer.scrollTop).toBe(0);
      expect(document.body.scrollTop).toBe(0);
      expect(document.documentElement.scrollTop).toBe(0);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      windowScroll.mockRestore();
    }
  });

  it('without scrollTo (an older engine) it sets the position directly', () => {
    const { container, anchor } = setUp(100, 400, 10);
    (container as { scrollTo?: unknown }).scrollTo = undefined;
    scrollWithin(container, anchor);
    expect(container.scrollTop).toBe(310);
  });
});

/**
 * L-353: a scroll area with top padding. Its content starts BELOW its top
 * edge — 20px on a wide window, 16px on a narrow one (`py-4 md:py-5`) — so an
 * anchor at the very start of the content is that far below the edge while the
 * area sits at the top. Measured from the edge alone, Tailor opened 20px down.
 */
describe('scrollWithin, in a scroll area with top padding (L-353)', () => {
  for (const padding of [20, 16]) {
    it(`boundary: an anchor at the very start of a ${String(padding)}px-padded area leaves it at the top`, () => {
      const { container, anchor, scrollTo } = setUp(100, 100 + padding, 0);
      container.style.paddingTop = `${String(padding)}px`;
      scrollWithin(container, anchor);
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });
  }

  it('boundary: from further down, back to that anchor is all the way back to the top', () => {
    const { container, anchor, scrollTo } = setUp(100, 120 - 300, 300);
    container.style.paddingTop = '20px';
    scrollWithin(container, anchor);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('a section further down lands with the padding gap above it, not flush (Settings)', () => {
    // Settings opened at Job boards or the Reed key: the section is 600px
    // below the area's edge. It lands 20px down — the same gap the first
    // section has when the screen is unscrolled — not flush at 0px.
    const { container, anchor, scrollTo } = setUp(100, 700, 0);
    container.style.paddingTop = '20px';
    scrollWithin(container, anchor);
    expect(scrollTo).toHaveBeenCalledWith({ top: 580, behavior: 'smooth' });
  });

  it('negative: with no padding, the result is what it always was', () => {
    const { container, anchor, scrollTo } = setUp(100, 700, 50);
    container.style.paddingTop = '0px';
    scrollWithin(container, anchor);
    expect(scrollTo).toHaveBeenCalledWith({ top: 650, behavior: 'smooth' });
  });
});
