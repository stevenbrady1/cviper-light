/**
 * The six views, and the order they appear in the rail.
 *
 * ============================================================================
 * THE WORK FIRST, THEN "YOU" (L-402)
 * ============================================================================
 *   Tracker, Search, Analysis, Tailor      then, under "You": Profile, Settings
 *
 * The Tracker LEADS because the app opens on it (below): the first name in the
 * rail is the screen you are looking at, and `Ctrl+1` is the way back to it.
 * Search, Analysis and Tailor follow in the order one job is worked: find it,
 * check your CV against it, rewrite the CV for it.
 *
 * Tailor is AFTER Analysis (L-160) because it is what you do once the check
 * has told you what is missing: a rewrite that runs before the gaps are known
 * is a rewrite aimed at nothing. It works from the same CV rows and the same
 * tracked jobs, and it needs a model — there is no keyword fallback for
 * writing prose, so the screen says so and points at Settings.
 *
 * Profile and Settings sit in a SECOND GROUP, labelled "You", because neither
 * is a step: they are about the person and the machine, set once and read by
 * every step. Profile was first in the rail until L-402 (L-154: every later
 * step reads from it); the owner moved it on 13 November 2026, with the six
 * names unchanged. The Welcome screen is what points a new user at it now.
 *
 * `Ctrl+1` to `Ctrl+5` are the first five places in the rail, in order, so the
 * number beside a name is always its position. Settings has none.
 *
 * ============================================================================
 * THE DEFAULT VIEW IS THE TRACKER
 * ============================================================================
 * Opening this app on a Tuesday morning, the question is almost never "what
 * jobs exist" — it is "where do I stand, and what has gone quiet". The first
 * screen should answer the question the user came with. Search is one
 * keystroke away.
 *
 * ============================================================================
 * THERE IS NO HAMBURGER, AND EXACTLY ONE BREAKPOINT
 * ============================================================================
 * On a desktop window (1000x700 minimum, `tauri.conf.json`) the rail is a fixed
 * 240px and always open. On a phone (below Tailwind's `md`, L-81) the shell
 * mounts a bottom bar with these same six views instead. Nothing collapses:
 * a control that hides the thing it controls teaches nobody anything.
 */

export type ViewId = 'profile' | 'search' | 'tracker' | 'analysis' | 'tailor' | 'settings';

export interface ViewDefinition {
  readonly id: ViewId;
  /** The rail label, and the heading of the view itself. Sentence case. */
  readonly label: string;
  /** One line under the heading, saying what the view is for. */
  readonly summary: string;
  /** The `Ctrl+N` digit — the view's place in the rail — or `null` for Settings. */
  readonly shortcut: number | null;
  /** `sequence` views are the steps, at the top; `you` views sit below, under "You". */
  readonly placement: 'sequence' | 'you';
}

export const VIEWS: readonly ViewDefinition[] = [
  {
    id: 'tracker',
    label: 'Tracker',
    summary: 'Every application you are chasing, and how long each has sat still.',
    shortcut: 1,
    placement: 'sequence',
  },
  {
    id: 'search',
    label: 'Search',
    summary: 'Find roles and save the ones worth chasing.',
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
    id: 'tailor',
    label: 'Tailor',
    summary: 'Rewrite your CV for one advert, and draft the letter — from your own facts only.',
    shortcut: 4,
    placement: 'sequence',
  },
  {
    id: 'profile',
    label: 'Profile',
    summary: 'Who you are and what you want. Saved as you type.',
    shortcut: 5,
    placement: 'you',
  },
  {
    id: 'settings',
    label: 'Settings',
    summary: 'Your AI set-up, your data, and where it all lives.',
    shortcut: null,
    placement: 'you',
  },
];

/** The view the app opens on. See the note above. */
export const DEFAULT_VIEW: ViewId = 'tracker';

export const SEQUENCE_VIEWS: readonly ViewDefinition[] = VIEWS.filter(
  (view) => view.placement === 'sequence',
);

export const YOU_VIEWS: readonly ViewDefinition[] = VIEWS.filter(
  (view) => view.placement === 'you',
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
