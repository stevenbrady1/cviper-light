/**
 * The four views, and the order they appear in the rail.
 *
 * ============================================================================
 * WORKFLOW ORDER, NOT ALPHABETICAL AND NOT BY IMPORTANCE
 * ============================================================================
 *   Search -> Tracker -> Analysis
 *
 * That is the order a job hunt actually happens in: find something, record that
 * you are chasing it, then work out whether your CV is any good for it. A rail
 * that lists the app's features in the order they were built teaches nobody
 * anything; a rail that lists them in the order they are used is a diagram of
 * the process, for free, permanently on screen.
 *
 * Settings is PINNED TO THE BOTTOM and is not in that sequence, because it is
 * not a step. Putting it fourth in the list would imply it is what you do after
 * an analysis.
 *
 * ============================================================================
 * THE DEFAULT VIEW IS THE TRACKER
 * ============================================================================
 * Not Search, even though Search is first in the workflow. Opening this app on
 * a Tuesday morning, the question is almost never "what jobs exist" — it is
 * "where do I stand, and what has gone quiet". The first screen should answer
 * the question the user came with. Search is one keystroke away.
 *
 * ============================================================================
 * THERE IS NO HAMBURGER, AND EXACTLY ONE BREAKPOINT
 * ============================================================================
 * On a desktop window (1000x700 minimum, `tauri.conf.json`) the rail is a fixed
 * 240px and always open. On a phone (below Tailwind's `md`, L-81) the shell
 * mounts a bottom bar with these same four views instead. Nothing collapses:
 * a control that hides the thing it controls teaches nobody anything.
 */

export type ViewId = 'search' | 'tracker' | 'analysis' | 'settings';

export interface ViewDefinition {
  readonly id: ViewId;
  /** The rail label, and the heading of the view itself. Sentence case. */
  readonly label: string;
  /** One line under the heading, saying what the view is for. */
  readonly summary: string;
  /** The `Ctrl+N` digit, or `null` for a view that is not part of the sequence. */
  readonly shortcut: number | null;
  /** `sequence` views sit at the top in workflow order; `pinned` sits at the bottom. */
  readonly placement: 'sequence' | 'pinned';
}

export const VIEWS: readonly ViewDefinition[] = [
  {
    id: 'search',
    label: 'Search',
    summary: 'Find roles and save the ones worth chasing.',
    shortcut: 1,
    placement: 'sequence',
  },
  {
    id: 'tracker',
    label: 'Tracker',
    summary: 'Every application you are chasing, and how long each has sat still.',
    shortcut: 2,
    placement: 'sequence',
  },
  {
    id: 'analysis',
    label: 'Analysis',
    summary: 'Check a CV against a role and see what is missing.',
    shortcut: 3,
    placement: 'sequence',
  },
  {
    id: 'settings',
    label: 'Settings',
    summary: 'Your API keys, your data, and where it all lives.',
    shortcut: null,
    placement: 'pinned',
  },
];

/** The view the app opens on. See the note above. */
export const DEFAULT_VIEW: ViewId = 'tracker';

export const SEQUENCE_VIEWS: readonly ViewDefinition[] = VIEWS.filter(
  (view) => view.placement === 'sequence',
);

export const PINNED_VIEWS: readonly ViewDefinition[] = VIEWS.filter(
  (view) => view.placement === 'pinned',
);

/** The view bound to `Ctrl+<digit>`, or `null` if that digit is not bound. */
export function viewForShortcut(digit: number): ViewId | null {
  return VIEWS.find((view) => view.shortcut === digit)?.id ?? null;
}

export function viewById(id: ViewId): ViewDefinition {
  const view = VIEWS.find((candidate) => candidate.id === id);
  // Unreachable: `ViewId` is a closed union over this same list, so a bad id is
  // a compile error. Thrown rather than defaulted so a future dynamic caller
  // finds out immediately instead of silently rendering the wrong screen.
  if (view === undefined) throw new Error(`Unknown view: ${id}`);
  return view;
}
