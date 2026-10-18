import { type ReactNode } from 'react';

import { PageHeader } from '../ui';

import { NAV_ICON } from './NavIcon';

import { type ViewId } from './views';

/**
 * The top of every view: what this screen is, and the one thing you would most
 * likely want to do on it.
 *
 * `action` is where a view's SINGLE blue primary button goes. One per view is
 * the rule — the moment there are two, neither is primary, and the user has to
 * read both to find out which one the screen is for.
 *
 * Drawn by the shared `PageHeader` (the welcome refresh's styling language):
 * an icon tile for the view, the title, and the summary in muted ink.
 *
 * The tile shows the view's duotone navigation icon (`NAV_ICON`, L-254) — the
 * same drawing as the rail, from the same table, so the two cannot drift.
 */

interface ViewHeaderProps {
  readonly title: string;
  readonly summary: string;
  /** The view's one primary action, or nothing. */
  readonly action?: ReactNode;
  /** Which view this heads, for its icon. */
  readonly view?: ViewId | undefined;
}

export function ViewHeader({ title, summary, action = null, view }: ViewHeaderProps) {
  return (
    <PageHeader
      title={title}
      subtitle={summary}
      actions={action}
      glyph={view === undefined ? undefined : NAV_ICON[view]}
    />
  );
}
