/**
 * The staleness edge — a 2px left rule on every card, coloured by how long it
 * has been since anything happened.
 *
 * ============================================================================
 * WHY AGE, AND WHY IT IS THE SIGNATURE ELEMENT
 * ============================================================================
 * A job hunt does not fail loudly. It rots quietly: an application sits in
 * "applied" for six weeks, nobody replies, nobody follows up, and it is still
 * sitting in exactly the same column looking exactly the same as the one sent
 * on Friday. Every tracker in existence shows STATUS well and AGE not at all,
 * and age is the fact that should drive the next action.
 *
 * The edge is orthogonal to the column on purpose. The column says what state
 * the application is in; the edge says how long it has been in it. Two
 * different facts, one glance, no extra chrome and no extra column. You should
 * be able to see which column is rotting without reading a single word.
 *
 * ============================================================================
 * WHY THESE FOUR BANDS
 * ============================================================================
 *   0-6    teal          moving       inside a week: this is live
 *   7-20   line grey     neutral      normal. Recruiters are slow; a fortnight
 *                                     of silence is not yet a signal
 *   21-44  gold          going quiet  three weeks with no movement is the point
 *                                     at which a nudge is worth sending
 *   45+    gold at 40%   cold         six weeks. Usually over. It RECEDES
 *                                     rather than shouting: a board of forty
 *                                     dead applications screaming for attention
 *                                     is a board nobody looks at
 *
 * Nothing here is ever red. Red is destructive and the `rejected` status, and
 * an application nobody has replied to is not a rejection — saying so in colour
 * would be the app inventing bad news.
 *
 * ============================================================================
 * PURE, AND TESTED AT EVERY BOUNDARY
 * ============================================================================
 * Deliberately not computed inline in JSX. An off-by-one in a band boundary is
 * invisible — one card's edge is the wrong colour, and nobody can tell by
 * looking — so it needs a test on both sides of 6/7, 20/21 and 44/45, and a
 * test needs a function to call.
 */

export type StalenessBand = 'moving' | 'neutral' | 'quiet' | 'cold';

interface BandDefinition {
  /** The Tailwind class for the 2px left rule. */
  readonly edgeClass: string;
  /** Plain words for the same fact, for anyone who cannot use the colour. */
  readonly label: string;
}

export const STALENESS_BANDS: Record<StalenessBand, BandDefinition> = {
  moving: { edgeClass: 'border-l-teal', label: 'moving' },
  neutral: { edgeClass: 'border-l-line', label: 'steady' },
  quiet: { edgeClass: 'border-l-gold', label: 'going quiet' },
  cold: { edgeClass: 'border-l-gold/40', label: 'cold' },
};

/** Inclusive lower bound of each band, in days, highest first. */
const THRESHOLDS: ReadonlyArray<readonly [days: number, band: StalenessBand]> = [
  [45, 'cold'],
  [21, 'quiet'],
  [7, 'neutral'],
];

/**
 * Which band an age in days falls into.
 *
 * `null` and `NaN` are NEUTRAL, not cold. An age we could not read is a data
 * problem; painting it gold would tell the user something about their job hunt
 * that is not true. A negative age — a skewed clock, or a backup written on a
 * machine set to tomorrow — is treated as fresh, because nothing goes stale in
 * negative time.
 */
export function stalenessBand(days: number | null): StalenessBand {
  if (days === null || Number.isNaN(days)) return 'neutral';

  for (const [threshold, band] of THRESHOLDS) {
    if (days >= threshold) return band;
  }
  return 'moving';
}

/**
 * The same fact in words.
 *
 * The colour is a second telling, never the only one: on a greyscale display,
 * or for the roughly one man in twelve with a colour vision deficiency, the
 * edge alone says nothing. This string goes on the card's accessible label.
 */
export function stalenessDescription(days: number | null): string {
  if (days === null) return 'Last change unknown';
  if (days <= 0) return 'Last changed today';
  if (days === 1) return 'Last changed 1 day ago';
  return `Last changed ${days} days ago`;
}
