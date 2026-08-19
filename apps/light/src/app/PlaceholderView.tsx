import { ViewHeader } from './ViewHeader';
import { type ViewDefinition } from './views';

/**
 * A view that has not been built yet, said out loud.
 *
 * ============================================================================
 * AN EMPTY SHELL IS ONLY HONEST IF IT SAYS SO
 * ============================================================================
 * The failure to avoid is a screen that looks like a working feature with
 * nothing in it — a user cannot tell "no results" from "not built", tries
 * harder, and concludes the app is broken. So this says plainly that the view
 * is not here yet, and then does the one thing an empty state should always do:
 * points at something that DOES work right now.
 *
 * No fake search box, no greyed-out controls, no "coming soon" badge on a
 * mock-up. There is nothing here to click because there is nothing here.
 */

interface PlaceholderViewProps {
  readonly view: ViewDefinition;
  /** Where to send the user instead. One sentence, and it must be true. */
  readonly insteadTry: string;
}

export function PlaceholderView({ view, insteadTry }: PlaceholderViewProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid={`view-${view.id}`}>
      <ViewHeader title={view.label} summary={view.summary} />

      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
        <div className="max-w-md text-center">
          <p className="font-mono text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
            Not built yet
          </p>
          <p className="mt-2 text-ink-muted">{insteadTry}</p>
        </div>
      </div>
    </section>
  );
}
