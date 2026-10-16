/**
 * The app's shared presentational pieces: the styling language every screen
 * is drawn in. Tokens only — see `styles/theme.css`.
 *
 * They live here rather than in `packages/ui` because Tailwind 4 generates
 * utilities from the files it scans, and the token and contrast contracts read
 * `apps/light/src`. A component outside both would be styled by nothing and
 * checked by nothing.
 */
export { Card, cardClasses, type CardProps } from './Card';
export { Icon, ICON_NAMES, type IconName } from './Icon';
export { IconTile, type IconTileTone } from './IconTile';
export {
  AiKeyIcon,
  AnalysisIcon,
  NAV_ACCENT,
  ProfileIcon,
  SearchIcon,
  TailorIcon,
  TrackerIcon,
  type NavIconProps,
} from './NavIcons';
export {
  AboutIcon,
  DeleteEverythingIcon,
  GettingStartedIcon,
  JobBoardsIcon,
  PrivacyIcon,
  ReportProblemIcon,
  SECTION_ACCENT,
  UpdatesIcon,
  YourDataIcon,
  type SettingsIconProps,
} from './SettingsIcons';
export { PageHeader, SectionHeading } from './PageHeader';
export { PILL_TONES, StatusPill, type PillTone } from './StatusPill';
