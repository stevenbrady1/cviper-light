// @vitest-environment jsdom
/**
 * The welcome cards wear the SAME duotone drawing the navigation shows for
 * that view (L-254). The view headers no longer wear one at all (L-431).
 *
 * L-254 put the navigation drawing in a tile beside every view's title, so the
 * header and the rail could not say "Profile" in two different drawings. But
 * the tile then said it twice, side by side: the rail's icon, and the same icon
 * again a few pixels to the right. The rule turned over on purpose:
 *
 *   before (L-254)  every view header shows its navigation drawing
 *   now    (L-431)  no view header shows an icon; the title stands alone
 *
 * The welcome cards stand on their own page with no rail beside them, so they
 * keep the drawing.
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

describe('no view header draws an icon (L-431)', () => {
  for (const view of VIEWS) {
    it(view.id, () => {
      const { container } = render(
        <ViewHeader view={view.id} title={view.label} summary={view.summary} />,
      );
      const header = container.querySelector('header');
      expect(header?.querySelector('h1')?.textContent).toBe(view.label);
      expect(header?.querySelector('svg')).toBeNull();
      expect(header?.querySelector('[aria-hidden="true"]')).toBeNull();
    });
  }

  it('negative: a header with no view draws no icon either', () => {
    const { container } = render(<ViewHeader title="Untitled" summary="No view." />);
    expect(container.querySelector('header svg')).toBeNull();
  });

  it('boundary: every view still HAS a navigation drawing, so the header leaves it out by choice', () => {
    for (const view of VIEWS) expect(navDrawing(view.id).length, view.id).toBeGreaterThan(0);
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
