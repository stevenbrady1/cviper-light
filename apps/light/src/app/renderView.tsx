import { Analysis, type AnalysisProps } from '../features/analysis/Analysis';
import { Profile, type ProfileProps } from '../features/profile/Profile';
import { Search, type SearchProps } from '../features/search/Search';
import { Settings, type SettingsProps } from '../features/settings/Settings';
import { Tailor, type TailorProps } from '../features/tailor/Tailor';
import { Tracker, type TrackerProps } from '../features/tracker/Tracker';

import { type ViewId } from './views';

// The screen switch. Moved word for word out of `App` (L-373); `App` still
// calls it inside the view's own error boundary.

/** The props each view needs, gathered in one place the switch below reads. */
interface ViewProps {
  readonly profile: ProfileProps;
  readonly search: SearchProps;
  readonly tracker: TrackerProps;
  readonly analysis: AnalysisProps;
  readonly tailor: TailorProps;
  readonly settings: SettingsProps;
}

export function renderView(id: ViewId, props: ViewProps) {
  switch (id) {
    case 'profile':
      return <Profile {...props.profile} />;
    case 'search':
      return <Search {...props.search} />;
    case 'tracker':
      return <Tracker {...props.tracker} />;
    case 'analysis':
      return <Analysis {...props.analysis} />;
    case 'tailor':
      return <Tailor {...props.tailor} />;
    case 'settings':
      return <Settings {...props.settings} />;
  }
}
