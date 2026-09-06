import { VIEWS, type ViewDefinition, type ViewId } from './views';

/**
 * The phone's navigation: one bar along the bottom, four labels, thumb-reach.
 *
 * ============================================================================
 * THE SAME FOUR VIEWS, THE SAME TEST IDS, NEVER BOTH NAVS AT ONCE
 * ============================================================================
 * This is the rail (`Sidebar.tsx`) folded for a 375px screen. It renders the
 * same `VIEWS` under the same `data-testid="nav-<id>"`, so every test and
 * every keyboard path that drives the rail drives this too. The shell mounts
 * exactly one of the two, decided by `useViewportClass`.
 *
 * Settings sits last rather than apart: a bottom bar has no "pinned to the
 * bottom", so the workflow order runs left to right and Settings closes it.
 *
 * ============================================================================
 * 44 PIXELS, AND THE HOME INDICATOR
 * ============================================================================
 * `min-h-11` is Apple's minimum touch target. `pb-safe` is the home-indicator
 * inset (`env(safe-area-inset-bottom)`), which is zero on every screen that
 * has no such thing and about 34px on the phones that do — without it the
 * bar's bottom row of pixels sits under the indicator and cannot be tapped.
 */

interface BottomNavButtonProps {
  readonly view: ViewDefinition;
  readonly active: boolean;
  readonly onSelect: (id: ViewId) => void;
}

function BottomNavButton({ view, active, onSelect }: BottomNavButtonProps) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      data-testid={`nav-${view.id}`}
      onClick={() => onSelect(view.id)}
      className={[
        'flex min-h-11 flex-1 flex-col items-center justify-center rounded-control px-1 py-1.5 text-xs',
        // The 2px teal rule is the marker, as on the rail — on top here, where
        // the thumb is not covering it. Present in both states so nothing
        // shifts as the selection moves.
        'border-t-2',
        active
          ? 'border-t-teal font-medium text-ink-inverse'
          : 'border-t-transparent text-ink-inverse-muted',
      ].join(' ')}
    >
      {view.label}
    </button>
  );
}

interface BottomNavProps {
  readonly activeView: ViewId;
  readonly onSelect: (id: ViewId) => void;
}

export function BottomNav({ activeView, onSelect }: BottomNavProps) {
  return (
    <nav
      aria-label="Views"
      data-testid="bottom-nav"
      className="flex shrink-0 items-stretch gap-1 border-t border-canvas/10 bg-navy px-2 pt-1 pb-safe text-ink-inverse"
    >
      {VIEWS.map((view) => (
        <BottomNavButton
          key={view.id}
          view={view}
          active={view.id === activeView}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}
