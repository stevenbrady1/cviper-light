import { type ComponentType } from 'react';

import {
  AiKeyIcon,
  AnalysisIcon,
  ProfileIcon,
  SearchIcon,
  TailorIcon,
  TrackerIcon,
  type NavIconProps,
} from '../ui';

import { type ViewId } from './views';

/**
 * Which duotone icon each view gets in the navigation (L-254) — one table, so
 * the desktop rail and the phone bar can never disagree. Settings takes the
 * AI-key drawing: setting up keys is what most people open it for.
 */
export const NAV_ICON: Readonly<Record<ViewId, ComponentType<NavIconProps>>> = {
  profile: ProfileIcon,
  search: SearchIcon,
  tracker: TrackerIcon,
  analysis: AnalysisIcon,
  tailor: TailorIcon,
  settings: AiKeyIcon,
};

/** The view's icon at nav size: 24px, never squeezed by a long label. */
export function NavIcon({ id }: { readonly id: ViewId }) {
  const Icon = NAV_ICON[id];
  return <Icon className="h-6 w-6 shrink-0" />;
}
