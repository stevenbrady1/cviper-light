import { type ReactNode } from 'react';

/**
 * The top of every view: what this screen is, and the one thing you would most
 * likely want to do on it.
 *
 * `action` is where a view's SINGLE blue primary button goes. One per view is
 * the rule — the moment there are two, neither is primary, and the user has to
 * read both to find out which one the screen is for.
 */

interface ViewHeaderProps {
  readonly title: string;
  readonly summary: string;
  /** The view's one primary action, or nothing. */
  readonly action?: ReactNode;
}

export function ViewHeader({ title, summary, action = null }: ViewHeaderProps) {
  return (
    <header className="flex flex-col gap-3 border-b border-line bg-card px-4 py-3 md:flex-row md:items-start md:justify-between md:gap-4 md:px-6 md:py-4">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        <p className="text-ink-muted">{summary}</p>
      </div>
      {action === null ? null : <div className="shrink-0">{action}</div>}
    </header>
  );
}
