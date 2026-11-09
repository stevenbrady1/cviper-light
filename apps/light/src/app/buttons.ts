/**
 * The three kinds of button this app has. There is no fourth.
 *
 * ============================================================================
 * AT MOST ONE BLUE BUTTON PER VIEW
 * ============================================================================
 * Blue means "this is the thing this screen is for". The moment a screen has
 * two blue buttons, neither of them is primary and the user has to read both to
 * find out which one the screen is about — so the colour has stopped carrying
 * any information at all. A view with no one main action has none: Settings at
 * rest is the example (L-321).
 *
 * `data-primary` is on every primary button so this is CHECKABLE rather than
 * merely intended: the tracker's tests count the enabled primary buttons on
 * screen and fail if there is ever more than one.
 *
 * A primary button that is momentarily unavailable is DISABLED, never hidden.
 * A control that comes and goes is a control the user cannot learn.
 *
 * `destructive` is red, and red appears in exactly two places in the whole app:
 * here, and an overdue next action on a tracker card (the `rejected` status
 * pill that used to be the other one left the card in L-175).
 *
 * A disabled button LOOKS disabled, and in one way: the `line` grey fill, in all
 * four styles (L-315). Greying the text alone left a secondary button looking
 * pressable. `sunken` is too close to the page to see, and it is the hover colour.
 */

// `min-h-11` below `md`: 44px is the smallest thing a thumb reliably hits,
// and every button in the app is a thumb target on a phone (L-81). Above `md`
// the buttons keep their natural height.
const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-control px-3 py-1.5 font-medium ' +
  'min-h-11 md:min-h-0 disabled:cursor-not-allowed';

export const PRIMARY_BUTTON = `${BASE} bg-blue text-ink-inverse hover:bg-navy disabled:bg-line disabled:text-ink-faint`;

export const SECONDARY_BUTTON = `${BASE} border border-line bg-card text-ink hover:bg-sunken disabled:border-transparent disabled:bg-line disabled:text-ink-faint aria-disabled:border-transparent aria-disabled:bg-line`;

export const DESTRUCTIVE_BUTTON = `${BASE} bg-danger text-ink-inverse hover:bg-danger/90 disabled:bg-line disabled:text-ink-faint`;

/** A quiet, text-only button for the third-rank actions. */
export const QUIET_BUTTON = `${BASE} text-ink-muted hover:bg-sunken hover:text-ink disabled:bg-line disabled:text-ink-faint aria-disabled:bg-line`;
