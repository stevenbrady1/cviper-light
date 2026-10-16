/**
 * The duotone Settings section icons (L-256), drawn by the owner.
 *
 * The same approach as the navigation icons (`NavIcons.tsx`, L-254): the
 * owner's SVGs exactly, converted to JSX and nothing else, the main strokes in
 * `currentColor` so they follow the tile's ink, the accent through a theme
 * token, decorative (`aria-hidden`, not focusable).
 *
 * They are reached through the shared `Icon` component by the names the
 * Settings headings already use (`data`, `boards`, `refresh`, `start`,
 * `shield`, `info`, `flag`, `trash`), so `SectionHeading icon="…"` draws them
 * with no change at the call site. See `DUOTONE` in `Icon.tsx`.
 *
 * Their accent is `--color-section-icon-accent`, NOT the nav icons' token:
 * these sit on light tiles, where the owner's teal measures under 3:1, so the
 * two may need different values (`sectionIconAccent.contract.test.ts`).
 */
import { type ReactNode } from 'react';

/** The accent colour, as the CSS variable the theme defines once. */
export const SECTION_ACCENT = 'var(--color-section-icon-accent)';

export interface SettingsIconProps {
  /** Layout classes. Colour comes from the text around the icon. */
  readonly className?: string | undefined;
  /** Pixel size of the square. 24 by default; 16 inside a section tile. */
  readonly size?: number | undefined;
}

function SettingsSvg({
  className,
  size = 24,
  children,
}: SettingsIconProps & { readonly children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={String(size)}
      height={String(size)}
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

export function YourDataIcon(props: SettingsIconProps) {
  return (
    <SettingsSvg {...props}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      <path d="M21 8c0 1.66-4 3-9 3s-9-1.34-9-3" stroke={SECTION_ACCENT} />
    </SettingsSvg>
  );
}

export function JobBoardsIcon(props: SettingsIconProps) {
  return (
    <SettingsSvg {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect
        x="3"
        y="14"
        width="7"
        height="7"
        rx="1"
        stroke={SECTION_ACCENT}
        fill={SECTION_ACCENT}
        fillOpacity="0.1"
      />
    </SettingsSvg>
  );
}

export function UpdatesIcon(props: SettingsIconProps) {
  return (
    <SettingsSvg {...props}>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" stroke={SECTION_ACCENT} />
      <path d="M16 21v-5h5" stroke={SECTION_ACCENT} />
    </SettingsSvg>
  );
}

export function GettingStartedIcon(props: SettingsIconProps) {
  return (
    <SettingsSvg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16l4-4-4-4" stroke={SECTION_ACCENT} />
      <path d="M8 12h8" stroke={SECTION_ACCENT} />
    </SettingsSvg>
  );
}

export function PrivacyIcon(props: SettingsIconProps) {
  return (
    <SettingsSvg {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" stroke={SECTION_ACCENT} />
    </SettingsSvg>
  );
}

export function AboutIcon(props: SettingsIconProps) {
  return (
    <SettingsSvg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" stroke={SECTION_ACCENT} />
      <path d="M12 8h.01" stroke={SECTION_ACCENT} strokeWidth="2.5" />
    </SettingsSvg>
  );
}

export function ReportProblemIcon(props: SettingsIconProps) {
  return (
    <SettingsSvg {...props}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" stroke={SECTION_ACCENT} />
    </SettingsSvg>
  );
}

export function DeleteEverythingIcon(props: SettingsIconProps) {
  return (
    <SettingsSvg {...props}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" stroke={SECTION_ACCENT} />
      <line x1="14" y1="11" x2="14" y2="17" stroke={SECTION_ACCENT} />
    </SettingsSvg>
  );
}
