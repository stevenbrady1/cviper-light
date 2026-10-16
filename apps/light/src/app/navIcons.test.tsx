// @vitest-environment jsdom
/**
 * Both navigations draw the owner's duotone icon beside each label (L-254):
 * the desktop rail and the phone bar, the same icon per view.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BottomNav } from './BottomNav';
import { NAV_ICON } from './NavIcon';
import { Sidebar } from './Sidebar';
import { VIEWS, type ViewId } from './views';

afterEach(() => cleanup());

/** The SVG markup the icon component draws on its own, for comparison. */
function expectedSvg(id: ViewId): string {
  const Icon = NAV_ICON[id];
  const { container, unmount } = render(<Icon className="h-6 w-6 shrink-0" />);
  const html = container.querySelector('svg')?.outerHTML ?? '';
  unmount();
  return html;
}

const NAVS = [
  [
    'the desktop rail',
    (onSelect: (id: ViewId) => void) =>
      render(<Sidebar activeView="tracker" onSelect={onSelect} status={null} />),
  ],
  [
    'the phone bar',
    (onSelect: (id: ViewId) => void) =>
      render(<BottomNav activeView="tracker" onSelect={onSelect} />),
  ],
] as const;

describe.each(NAVS)('%s', (_name, renderNav) => {
  it('shows each view’s own icon, before its label', () => {
    const expected = Object.fromEntries(VIEWS.map((view) => [view.id, expectedSvg(view.id)]));
    renderNav(() => undefined);

    for (const view of VIEWS) {
      const button = screen.getByTestId(`nav-${view.id}`);
      const svg = button.querySelector('svg');
      expect(svg?.outerHTML, view.id).toBe(expected[view.id]);
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      // Before the label, in document order.
      const label = within(button).getByText(view.label);
      expect(svg && svg.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });

  it('the accessible name is still just the label', () => {
    renderNav(() => undefined);
    for (const view of VIEWS) {
      expect(screen.getByRole('button', { name: view.label })).toBe(
        screen.getByTestId(`nav-${view.id}`),
      );
    }
  });

  it('clicking the icon still navigates', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(id: ViewId) => void>();
    renderNav(onSelect);

    const svg = screen.getByTestId('nav-search').querySelector('svg');
    expect(svg).not.toBeNull();
    if (svg !== null) await user.click(svg);

    expect(onSelect).toHaveBeenCalledWith('search');
  });
});

describe('the icon per view', () => {
  it('Settings uses the AI-key drawing, and every view has one', () => {
    for (const view of VIEWS) expect(NAV_ICON[view.id], view.id).toBeTypeOf('function');
    expect(NAV_ICON.settings.name).toBe('AiKeyIcon');
  });
});

describe('the phone bar still fits a 375px screen', () => {
  it('every button shares the width and keeps the 44px touch target', () => {
    render(<BottomNav activeView="tracker" onSelect={() => undefined} />);
    for (const view of VIEWS) {
      const button = screen.getByTestId(`nav-${view.id}`);
      expect(button.className).toContain('flex-1');
      expect(button.className).toContain('min-h-11');
      expect(button.className).toContain('min-w-0');
    }
  });
});
