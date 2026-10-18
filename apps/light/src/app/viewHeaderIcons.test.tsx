// @vitest-environment jsdom
/**
 * The icon at the top of each view, and on the welcome cards, is the SAME
 * duotone drawing the navigation shows for that view (L-254).
 *
 * The new icons reached the sidebar and the phone bar, but every view's header
 * tile and the three welcome cards still drew the old single-colour `Icon` set,
 * so the screen said "Profile" in two different drawings at once.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type Availability } from '../features/analysis/providers';
import { Welcome } from '../features/onboarding/Welcome';

import { NAV_ICON } from './NavIcon';
import { ViewHeader } from './ViewHeader';
import { VIEWS, type ViewId } from './views';

afterEach(() => cleanup());

/** The path data of a drawing: what it looks like, independent of its size class. */
function drawing(svg: Element | null | undefined): string[] {
  if (!svg) return [];
  return [...svg.querySelectorAll('path, polyline, line, circle, rect')].map(
    (node) => node.outerHTML,
  );
}

function navDrawing(id: ViewId): string[] {
  const Icon = NAV_ICON[id];
  const { container, unmount } = render(<Icon />);
  const result = drawing(container.querySelector('svg'));
  unmount();
  return result;
}

describe('every view header wears its navigation icon', () => {
  for (const view of VIEWS) {
    it(view.id, () => {
      const expected = navDrawing(view.id);
      const { container } = render(
        <ViewHeader view={view.id} title={view.label} summary={view.summary} />,
      );
      const svg = container.querySelector('header svg');
      expect(drawing(svg)).toEqual(expected);
      expect(expected.length).toBeGreaterThan(0);
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
    });
  }

  it('negative: a header with no view draws no icon tile', () => {
    const { container } = render(<ViewHeader title="Untitled" summary="No view." />);
    expect(container.querySelector('header svg')).toBeNull();
  });

  it('boundary: the header icon is tile-sized, not nav-sized', () => {
    const { container } = render(<ViewHeader view="profile" title="Profile" summary="x" />);
    const cls = container.querySelector('header svg')?.getAttribute('class') ?? '';
    expect(cls).toContain('size-6');
    expect(cls).not.toContain('h-6 w-6 shrink-0');
  });
});

describe('the welcome cards wear the same icons', () => {
  const NOTHING: Availability = {
    ollamaRunning: false,
    ollamaModels: [],
    anthropicKey: false,
    openaiKey: false,
  };

  it('tracker, analysis and search', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);
    await screen.findByTestId('welcome');
    for (const id of ['tracker', 'analysis', 'search'] as const) {
      const svg = screen.getByTestId(`welcome-card-${id}`).querySelector('svg');
      expect(drawing(svg), id).toEqual(navDrawing(id));
    }
  });
});
