// @vitest-environment jsdom
/**
 * The duotone navigation icons (L-254): the owner's six drawings, exactly, with
 * the primary strokes in `currentColor` and the accent through one theme token.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AiKeyIcon,
  AnalysisIcon,
  NAV_ACCENT,
  ProfileIcon,
  SearchIcon,
  TailorIcon,
  TrackerIcon,
} from './NavIcons';
import NAV_ICONS_SOURCE from './NavIcons.tsx?raw';

afterEach(() => cleanup());

const ICONS = [
  ['ProfileIcon', ProfileIcon],
  ['SearchIcon', SearchIcon],
  ['TrackerIcon', TrackerIcon],
  ['AnalysisIcon', AnalysisIcon],
  ['TailorIcon', TailorIcon],
  ['AiKeyIcon', AiKeyIcon],
] as const;

describe.each(ICONS)('%s', (_name, Component) => {
  it('is a 24-unit, decorative, unfocusable SVG drawn in currentColor at 1.75', () => {
    const { container } = render(<Component className="h-6 w-6 shrink-0" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('fill')).toBe('none');
    expect(svg?.getAttribute('stroke-width')).toBe('1.75');
    expect(svg?.getAttribute('stroke-linecap')).toBe('round');
    expect(svg?.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg?.getAttribute('class')).toBe('h-6 w-6 shrink-0');
  });

  it('draws its accent through the theme token, never a colour literal', () => {
    const { container } = render(<Component />);
    const strokes = [...container.querySelectorAll('[stroke]')].map((el) =>
      el.getAttribute('stroke'),
    );
    expect(strokes).toContain(NAV_ACCENT);
    for (const stroke of strokes) expect(stroke).toMatch(/^(currentColor|var\(--[a-z-]+\))$/);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe('the accent token', () => {
  it('is var(--color-nav-accent); its value lives in theme.css (navAccent.contract.test.ts)', () => {
    expect(NAV_ACCENT).toBe('var(--color-nav-accent)');
  });

  it('the source holds no hex colour', () => {
    expect(NAV_ICONS_SOURCE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('the drawings are the owner’s, exactly', () => {
  it('profile: accent document at full strength (owner, 2026-10-16), user in currentColor', () => {
    const { container } = render(<ProfileIcon />);
    const doc = container.querySelector(
      'path[d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"]',
    );
    expect(doc).not.toBeNull();
    expect(doc?.getAttribute('stroke')).toBe('var(--color-nav-accent)');
    // The drawing had it at 0.5 (2.32:1 on navy, under WCAG 1.4.11's 3:1); the
    // owner chose full strength, which is the accent's 5.26:1.
    expect(doc?.hasAttribute('stroke-opacity')).toBe(false);
    expect(container.querySelector('circle')?.getAttribute('r')).toBe('3');
  });

  it('analysis: the trend line keeps its 1.5 stroke', () => {
    const { container } = render(<AnalysisIcon />);
    const line = container.querySelector('polyline');
    expect(line?.getAttribute('points')).toBe('7 12 11 8 15 10 18 5');
    expect(line?.getAttribute('stroke-width')).toBe('1.5');
    expect(container.querySelectorAll('line')).toHaveLength(3);
  });

  it('tracker: the active column is accent-filled at 0.1', () => {
    const { container } = render(<TrackerIcon />);
    const active = container.querySelector('rect[fill-opacity]');
    expect(active?.getAttribute('fill')).toBe(NAV_ACCENT);
    expect(active?.getAttribute('fill-opacity')).toBe('0.1');
    expect(container.querySelectorAll('rect')).toHaveLength(3);
  });
});
