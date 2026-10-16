import { type ComponentType, type ReactNode } from 'react';

import {
  AboutIcon,
  DeleteEverythingIcon,
  GettingStartedIcon,
  JobBoardsIcon,
  PrivacyIcon,
  ReportProblemIcon,
  UpdatesIcon,
  YourDataIcon,
  type SettingsIconProps,
} from './SettingsIcons';

/**
 * The app's icons: a small, fixed set of line drawings, inline.
 *
 * ============================================================================
 * WHY INLINE SVG AND NOT AN ICON LIBRARY
 * ============================================================================
 * The app needs about twenty glyphs. A dependency for twenty paths is a
 * dependency to audit, pin and update for ever, in an app whose whole promise
 * is that it works offline and ships nothing it does not use. These are drawn
 * on a 24-unit grid with a 2-unit round stroke so they sit together.
 *
 * They draw in `currentColor` — set by the SVG attribute, never by a `stroke-*`
 * or `fill-*` utility, which the contrast contract would have no way to check.
 * The colour therefore always comes from the text colour around the icon, and
 * the text colour is a token.
 *
 * Every icon is decorative (`aria-hidden`). The words beside it carry the
 * meaning, so a screen reader hears the label once rather than twice.
 */

const PATHS = {
  tracker: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="11" rx="1.5" />
      <rect x="17" y="4" width="4" height="7" rx="1.5" />
    </>
  ),
  analysis: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="m9 14 2 2 4-4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  tailor: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h10" />
      <path d="M18 6h2" />
      <circle cx="16" cy="6" r="2" />
      <path d="M4 12h4" />
      <path d="M12 12h8" />
      <circle cx="10" cy="12" r="2" />
      <path d="M4 18h12" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  computer: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
    </>
  ),
  noAccount: (
    <>
      <circle cx="10" cy="8" r="4" />
      <path d="M3 21a7 7 0 0 1 11-5.7" />
      <path d="m17 15 4 4" />
      <path d="m21 15-4 4" />
    </>
  ),
  free: (
    <>
      <path d="M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8" />
      <rect x="3" y="7" width="18" height="5" rx="1" />
      <path d="M12 7v14" />
      <path d="M12 7c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9" />
      <path d="m17 6 3 3" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </>
  ),
} satisfies Record<string, ReactNode>;

/**
 * The Settings section icons (L-256): the owner's duotone drawings, under the
 * names the Settings headings already used, so every `SectionHeading` that
 * asked for `data`, `boards`, … now draws the new icon. The old single-colour
 * drawings for these eight names were removed — nothing else referenced them.
 * See `SettingsIcons.tsx`.
 */
const DUOTONE = {
  data: YourDataIcon,
  boards: JobBoardsIcon,
  refresh: UpdatesIcon,
  start: GettingStartedIcon,
  shield: PrivacyIcon,
  info: AboutIcon,
  flag: ReportProblemIcon,
  trash: DeleteEverythingIcon,
} satisfies Record<string, ComponentType<SettingsIconProps>>;

export type IconName = keyof typeof PATHS | keyof typeof DUOTONE;

/** Every icon there is. Exported so the tests can prove each one draws. */
export const ICON_NAMES = [...Object.keys(PATHS), ...Object.keys(DUOTONE)] as readonly IconName[];

function isDuotone(name: IconName): name is keyof typeof DUOTONE {
  return name in DUOTONE;
}

export interface IconProps {
  readonly name: IconName;
  /** Pixel size of the square. 16 inline with text, 20 inside a tile. */
  readonly size?: number;
}

export function Icon({ name, size = 20 }: IconProps) {
  if (isDuotone(name)) {
    const Duotone = DUOTONE[name];
    return <Duotone size={size} className="shrink-0" />;
  }
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {PATHS[name]}
    </svg>
  );
}
