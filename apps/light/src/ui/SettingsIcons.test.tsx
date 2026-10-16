// @vitest-environment jsdom
/**
 * The duotone Settings section icons (L-256): the owner's eight drawings,
 * exactly, the main strokes in `currentColor` and the accent through the
 * section-icon token.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AboutIcon,
  DeleteEverythingIcon,
  GettingStartedIcon,
  JobBoardsIcon,
  PrivacyIcon,
  ReportProblemIcon,
  SECTION_ACCENT,
  UpdatesIcon,
  YourDataIcon,
} from './SettingsIcons';
import SETTINGS_ICONS_SOURCE from './SettingsIcons.tsx?raw';

afterEach(() => cleanup());

const ICONS = [
  ['YourDataIcon', YourDataIcon],
  ['JobBoardsIcon', JobBoardsIcon],
  ['UpdatesIcon', UpdatesIcon],
  ['GettingStartedIcon', GettingStartedIcon],
  ['PrivacyIcon', PrivacyIcon],
  ['AboutIcon', AboutIcon],
  ['ReportProblemIcon', ReportProblemIcon],
  ['DeleteEverythingIcon', DeleteEverythingIcon],
] as const;

describe.each(ICONS)('%s', (_name, Component) => {
  it('is a 24-unit, decorative, unfocusable SVG drawn in currentColor at 1.75', () => {
    const { container } = render(<Component className="extra" size={16} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.getAttribute('height')).toBe('16');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.getAttribute('fill')).toBe('none');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('stroke-width')).toBe('1.75');
    expect(svg?.getAttribute('stroke-linecap')).toBe('round');
    expect(svg?.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg?.getAttribute('class')).toContain('extra');
  });

  it('defaults to 24px', () => {
    const { container } = render(<Component />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('24');
  });

  it('draws its accent through the section token, never a colour literal', () => {
    const { container } = render(<Component />);
    const strokes = [...container.querySelectorAll('[stroke]')].map((el) =>
      el.getAttribute('stroke'),
    );
    expect(strokes).toContain(SECTION_ACCENT);
    for (const stroke of strokes) expect(stroke).toMatch(/^(currentColor|var\(--[a-z-]+\))$/);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe('the accent token', () => {
  it('is its own token, not the nav icons’ one', () => {
    expect(SECTION_ACCENT).toBe('var(--color-section-icon-accent)');
  });

  it('the source holds no hex colour', () => {
    expect(SETTINGS_ICONS_SOURCE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('the drawings are the owner’s, exactly', () => {
  it('about: the dot keeps its 2.5 stroke', () => {
    const { container } = render(<AboutIcon />);
    const dot = container.querySelector('path[stroke-width]');
    expect(dot?.getAttribute('d')).toBe('M12 8h.01');
    expect(dot?.getAttribute('stroke-width')).toBe('2.5');
    expect(container.querySelector('circle')?.getAttribute('r')).toBe('10');
  });

  it('job boards: the accent square is filled at 0.1', () => {
    const { container } = render(<JobBoardsIcon />);
    const accent = container.querySelector('rect[fill-opacity]');
    expect(accent?.getAttribute('x')).toBe('3');
    expect(accent?.getAttribute('y')).toBe('14');
    expect(accent?.getAttribute('fill')).toBe(SECTION_ACCENT);
    expect(accent?.getAttribute('fill-opacity')).toBe('0.1');
    expect(container.querySelectorAll('rect')).toHaveLength(4);
  });

  it('your data: four parts, the second ring in the accent', () => {
    const { container } = render(<YourDataIcon />);
    expect(container.querySelector('ellipse')?.getAttribute('rx')).toBe('9');
    const accent = container.querySelector(`path[stroke="${SECTION_ACCENT}"]`);
    expect(accent?.getAttribute('d')).toBe('M21 8c0 1.66-4 3-9 3s-9-1.34-9-3');
  });

  it('updates: two currentColor arcs, two accent ones', () => {
    const { container } = render(<UpdatesIcon />);
    expect(container.querySelectorAll('path')).toHaveLength(4);
    expect(container.querySelectorAll(`path[stroke="${SECTION_ACCENT}"]`)).toHaveLength(2);
  });

  it('delete everything: the two accent lines', () => {
    const { container } = render(<DeleteEverythingIcon />);
    expect(container.querySelectorAll(`line[stroke="${SECTION_ACCENT}"]`)).toHaveLength(2);
  });

  it('getting started, privacy, report a problem: their own paths', () => {
    expect(render(<GettingStartedIcon />).container.innerHTML).toContain('M12 16l4-4-4-4');
    cleanup();
    expect(render(<PrivacyIcon />).container.innerHTML).toContain('M9 12l2 2 4-4');
    cleanup();
    expect(render(<ReportProblemIcon />).container.innerHTML).toContain(
      'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z',
    );
  });
});
