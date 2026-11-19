import { type ReactNode } from 'react';

import { Icon, type IconName } from './Icon';

/**
 * The one empty state (L-434): what a screen shows when it has nothing in it
 * yet. A small grey icon, a title, a sentence, and sometimes one thing to press.
 *
 * Centred, with no border and no fill. Search's was a dashed box with its icon
 * in a tinted tile, which reads as a place to drop a file. A tinted tile is the
 * mark at the head of a card or section (`IconTile`); an empty state is not
 * one, so its icon is plain ink. Muted ink, not faint: faint ink is kept for
 * text with a second cue such as a smaller size (L-213), and an icon has none.
 *
 * The icon is decorative and hidden from screen readers: the title says what
 * it means. It adds no words, so a screen's text reads exactly as before.
 *
 * `body` is drawn inside a `<p>`, so it is words or inline markup, never a
 * block. `action` is drawn under the sentence; left out, nothing is drawn
 * there at all.
 */
export interface EmptyStateProps {
  readonly icon: IconName;
  readonly title: string;
  readonly body: ReactNode;
  readonly action?: ReactNode;
  readonly testId: string;
}

export function EmptyState({ icon, title, body, action, testId }: EmptyStateProps) {
  return (
    <div data-testid={testId} className="px-6 py-8 text-center">
      <span aria-hidden="true" className="mb-3 flex justify-center text-ink-muted">
        <Icon name={icon} size={20} monochrome />
      </span>
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-ink-muted">{body}</p>
      {action === undefined ? null : <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
