import { type EnvironmentStatus } from '../status/environment';

import { StatusStrip } from './StatusStrip';
import { PINNED_VIEWS, SEQUENCE_VIEWS, type ViewDefinition, type ViewId } from './views';

/**
 * The rail: fixed 240px, navy, always open.
 *
 * ============================================================================
 * NO HAMBURGER, NO BREAKPOINTS, NO COLLAPSE
 * ============================================================================
 * A collapsible sidebar exists to solve the problem of a 375px screen. This app
 * has a 1000x700 minimum window (`tauri.conf.json`) and cannot be opened on a
 * phone. Adding a collapse control here would add a control whose only job is
 * to hide the thing it controls — and a second layout to keep correct for ever.
 *
 * ============================================================================
 * THE ACTIVE MARKER IS TEAL, NOT BLUE
 * ============================================================================
 * Blue is reserved for action: exactly one primary button per view, links, and
 * the focus ring. A nav item you are already looking at is not an action, it is
 * a statement of where you are — which is teal's meaning ("present"). It is
 * also the practical answer: blue on navy is two dark colours a few degrees
 * apart, and on the rail it is nearly invisible.
 */

interface NavButtonProps {
  readonly view: ViewDefinition;
  readonly active: boolean;
  readonly onSelect: (id: ViewId) => void;
}

function NavButton({ view, active, onSelect }: NavButtonProps) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      data-testid={`nav-${view.id}`}
      onClick={() => onSelect(view.id)}
      className={[
        'flex w-full items-center justify-between gap-2 rounded-control py-2 pr-3 pl-2.5 text-left',
        // The 2px teal rule is the marker. `border-l-2` is on both states so
        // the label does not shift by two pixels as the selection moves.
        'border-l-2',
        active
          ? 'border-l-teal bg-canvas/10 font-medium text-ink-inverse'
          : 'border-l-transparent text-ink-inverse-muted hover:bg-canvas/5 hover:text-ink-inverse',
      ].join(' ')}
    >
      <span>{view.label}</span>
      {view.shortcut === null ? null : (
        // Teaching the shortcut in place costs nothing and saves the user
        // finding it in a menu that does not exist.
        <span aria-hidden="true" className="font-mono text-[11px] tabular-nums opacity-60">
          {`Ctrl ${view.shortcut}`}
        </span>
      )}
    </button>
  );
}

interface SidebarProps {
  readonly activeView: ViewId;
  readonly onSelect: (id: ViewId) => void;
  readonly status: EnvironmentStatus | null;
}

export function Sidebar({ activeView, onSelect, status }: SidebarProps) {
  return (
    <nav
      aria-label="Views"
      data-testid="sidebar"
      className="flex w-60 shrink-0 flex-col bg-navy text-ink-inverse"
    >
      <div className="px-4 pt-5 pb-4">
        <p className="text-base font-semibold tracking-tight">CViper</p>
        <p className="font-mono text-[10px] font-medium tracking-[0.18em] text-ink-inverse-muted uppercase">
          Light
        </p>
      </div>

      <ul className="flex-1 space-y-0.5 px-2">
        {SEQUENCE_VIEWS.map((view) => (
          <li key={view.id}>
            <NavButton view={view} active={view.id === activeView} onSelect={onSelect} />
          </li>
        ))}
      </ul>

      <ul className="space-y-0.5 px-2 pb-3">
        {PINNED_VIEWS.map((view) => (
          <li key={view.id}>
            <NavButton view={view} active={view.id === activeView} onSelect={onSelect} />
          </li>
        ))}
      </ul>

      <StatusStrip status={status} />
    </nav>
  );
}
