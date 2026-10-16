/**
 * The duotone navigation icons (L-254), drawn by the owner.
 *
 * One component per view, used by both navigations — the desktop rail
 * (`app/Sidebar.tsx`) and the phone bar (`app/BottomNav.tsx`) — through
 * `app/NavIcon.tsx`. They sit beside `Icon` rather than inside its `PATHS`
 * table because they are a different drawing: a 1.75 stroke where `Icon` uses
 * 2, and a second colour.
 *
 * The paths are the owner's SVGs exactly (issue 293), converted to JSX and
 * nothing else. The main strokes are `currentColor`, so they follow the nav
 * item's text colour through its active, hover and focus states. The accent
 * strokes use `NAV_ACCENT`, the `--color-nav-accent` token in `theme.css` —
 * never a colour literal here (`tokens.contract.test.ts`).
 *
 * Decorative, like every icon in the app: the label beside the icon carries the
 * meaning, so it is `aria-hidden` and not focusable.
 */
import { type ReactNode } from 'react';

/** The accent colour, as a CSS variable the theme defines once. */
export const NAV_ACCENT = 'var(--color-nav-accent)';

export interface NavIconProps {
  /** Sizing and layout, e.g. `h-6 w-6 shrink-0`. Colour comes from the text around it. */
  readonly className?: string | undefined;
}

function NavSvg({ className, children }: NavIconProps & { readonly children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export function ProfileIcon({ className }: NavIconProps) {
  return (
    <NavSvg className={className}>
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        stroke={NAV_ACCENT}
        strokeOpacity="0.5"
      />
      <circle cx="12" cy="10" r="3" />
      <path d="M7 20v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2" />
    </NavSvg>
  );
}

export function SearchIcon({ className }: NavIconProps) {
  return (
    <NavSvg className={className}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16" y2="16" />
      <path d="M10 7v2m-1-1h2" stroke={NAV_ACCENT} />
      <path d="M14 11v2m-1-1h2" stroke={NAV_ACCENT} />
    </NavSvg>
  );
}

export function TrackerIcon({ className }: NavIconProps) {
  return (
    <NavSvg className={className}>
      <rect x="3" y="12" width="6" height="8" rx="1" />
      <rect x="9" y="8" width="6" height="12" rx="1" />
      <rect
        x="15"
        y="4"
        width="6"
        height="16"
        rx="1"
        stroke={NAV_ACCENT}
        fill={NAV_ACCENT}
        fillOpacity="0.1"
      />
      <line x1="3" y1="22" x2="21" y2="22" />
    </NavSvg>
  );
}

export function AnalysisIcon({ className }: NavIconProps) {
  return (
    <NavSvg className={className}>
      <path d="M19 22H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9l6 6v12a2 2 0 0 1-2 2z" />
      <line x1="8" y1="18" x2="8" y2="14" stroke={NAV_ACCENT} />
      <line x1="12" y1="18" x2="12" y2="10" stroke={NAV_ACCENT} />
      <line x1="16" y1="18" x2="16" y2="12" stroke={NAV_ACCENT} />
      <polyline points="7 12 11 8 15 10 18 5" stroke={NAV_ACCENT} strokeWidth="1.5" />
    </NavSvg>
  );
}

export function TailorIcon({ className }: NavIconProps) {
  return (
    <NavSvg className={className}>
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <path d="M17 6l1 1m0-2v2m-1-1h2" stroke={NAV_ACCENT} />
      <path d="M21 9l1 1m0-2v2m-1-1h2" stroke={NAV_ACCENT} />
    </NavSvg>
  );
}

/** The AI-key drawing. Used for Settings, where the keys are set up. */
export function AiKeyIcon({ className }: NavIconProps) {
  return (
    <NavSvg className={className}>
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
      <path d="M12 3v2m-1-1h2" stroke={NAV_ACCENT} />
      <path d="M19 12v2m-1-1h2" stroke={NAV_ACCENT} />
    </NavSvg>
  );
}
