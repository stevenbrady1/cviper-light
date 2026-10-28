import { QUIET_BUTTON } from '../../app/buttons';

import { type SearchForm } from './model';

/** The last few searches, as chips. Nothing is drawn until there is one. */
export interface SearchRecentProps {
  readonly recent: readonly SearchForm[];
  readonly onPick: (form: SearchForm) => void;
}

export function SearchRecent({ recent, onPick }: SearchRecentProps) {
  if (recent.length === 0) return null;

  return (
    <div data-testid="search-recent" className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-faint">Recent</span>
      {recent.map((entry, index) => (
        <button
          key={`${entry.keywords}|${entry.location}|${index}`}
          type="button"
          data-testid={`search-recent-${index}`}
          /*
            Fills the boxes and stops. It does NOT search: a click that
            silently spent one of Reed's hundred would be the same
            mistake as searching on startup.
          */
          onClick={() => onPick(entry)}
          className={`${QUIET_BUTTON} rounded-pill border border-line px-2 py-0.5 text-xs`}
        >
          {[entry.keywords, entry.location].filter((part) => part !== '').join(' · ')}
        </button>
      ))}
    </div>
  );
}
