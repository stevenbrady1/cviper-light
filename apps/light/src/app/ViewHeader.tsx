import { type ReactNode } from 'react';

import { PageHeader } from '../ui';

import { CONTENT_COLUMN, HEADER_EDGE } from './layout';

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
 * the title, and the summary in muted ink. No icon: the rail already shows the
 * view's icon, and a tile here only repeated it (L-431, after L-254).
 *
 * The title row carries `CONTENT_COLUMN` (L-326), so on a wide window the title
 * starts where the centred content starts. Not on Tracker: its board is full
 * width, and a centred title would sit away from the board's left edge.
 *
 * The strip also keeps the scroll bar's room on its right (`HEADER_EDGE`,
 * L-435), the room the scroll area below always keeps, so the title row and
 * the column are the same width. Not on Tracker, whose board keeps no such room.
 */

interface ViewHeaderProps {
  readonly title: string;
  readonly summary: string;
  /** The view's one primary action, or nothing. */
  readonly action?: ReactNode;
  /** Which view this heads, for its column width. */
  readonly view?: ViewId | undefined;
}

export function ViewHeader({ title, summary, action = null, view }: ViewHeaderProps) {
  return (
    <PageHeader
      title={title}
      subtitle={summary}
      actions={action}
      column={view === 'tracker' ? '' : CONTENT_COLUMN}
      edge={view === 'tracker' ? '' : HEADER_EDGE}
    />
  );
}
