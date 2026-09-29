// @vitest-environment jsdom
/**
 * The CViper mark in the sidebar (L-184): CViper's own logo file, shown as an
 * image, beside the "CViper Light" wordmark.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CViperMark } from './CViperMark';
import { Sidebar } from './Sidebar';

afterEach(() => {
  cleanup();
});

describe('the CViper mark', () => {
  it('shows the committed CViper logo file, not a redrawing of it', () => {
    render(<CViperMark />);
    const src = screen.getByTestId('cviper-mark').getAttribute('src') ?? '';
    // Vite either bundles the file (a path ending in cviper-mark.svg) or, being
    // small, inlines it as a data: URI. Both are the committed file, and both
    // are allowed by the app's `img-src 'self' data:` policy.
    if (src.startsWith('data:')) {
      // Its colours are pinned by CViperMark.source.test.ts, which reads the
      // file; this .tsx may not spell hex (the token contract).
      const svg = decodeURIComponent(src);
      expect(svg).toContain('<title>CViper</title>');
      expect(svg.match(/<rect /g)).toHaveLength(4);
    } else {
      expect(src).toMatch(/cviper-mark\.svg/);
    }
  });

  it('is decoration for sighted users; the words "CViper Light" stay the accessible name', () => {
    render(<CViperMark />);
    const mark = screen.getByTestId('cviper-mark');
    expect(mark.getAttribute('alt')).toBe('');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
  });

  it('boundary: draws at the size it is given', () => {
    render(<CViperMark size={48} />);
    expect(screen.getByTestId('cviper-mark').getAttribute('width')).toBe('48');
  });
});

describe('the sidebar', () => {
  it('shows the CViper mark beside the CViper Light wordmark', () => {
    render(<Sidebar activeView="tracker" onSelect={() => undefined} status={null} />);

    expect(screen.getByTestId('cviper-mark')).toBeTruthy();
    expect(screen.getByTestId('sidebar').textContent).toContain('CViper');
    expect(screen.getByTestId('sidebar').textContent).toContain('Light');
  });
});
