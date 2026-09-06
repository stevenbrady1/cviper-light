// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { WIDE_QUERY, useViewportClass } from './viewport';

/**
 * A `matchMedia` that answers `WIDE_QUERY` for one width and can be told the
 * width changed. jsdom ships none, which is itself the first case below.
 */
function installMatchMedia(widthPx: number) {
  const listeners = new Set<() => void>();
  let width = widthPx;
  const list = {
    get matches() {
      return width >= 768;
    },
    media: WIDE_QUERY,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => {
      if (query !== WIDE_QUERY) throw new Error(`unexpected query ${query}`);
      return list;
    },
  });
  return {
    resize(next: number) {
      width = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  // Back to jsdom's real state: no matchMedia at all.
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('useViewportClass', () => {
  it('is wide when the runtime has no matchMedia at all (jsdom, and the app before L-81)', () => {
    expect(typeof window.matchMedia).toBe('undefined');
    const { result } = renderHook(() => useViewportClass());
    expect(result.current).toBe('wide');
  });

  it('is narrow on a phone and wide on a desktop window', () => {
    installMatchMedia(375);
    expect(renderHook(() => useViewportClass()).result.current).toBe('narrow');
  });

  it('boundary: 768px is wide, 767px is narrow — the same line as Tailwind’s md', () => {
    installMatchMedia(768);
    expect(renderHook(() => useViewportClass()).result.current).toBe('wide');
    installMatchMedia(767);
    expect(renderHook(() => useViewportClass()).result.current).toBe('narrow');
  });

  it('follows a rotation live, and lets go of the listener on unmount', () => {
    const media = installMatchMedia(375);
    const { result, unmount } = renderHook(() => useViewportClass());
    expect(result.current).toBe('narrow');

    act(() => media.resize(1024));
    expect(result.current).toBe('wide');

    act(() => media.resize(375));
    expect(result.current).toBe('narrow');

    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });
});
