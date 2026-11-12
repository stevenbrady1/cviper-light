/**
 * How wide a screen's content may grow. One width, for every screen that reads
 * top to bottom (L-341).
 *
 * ============================================================================
 * ONE READING WIDTH
 * ============================================================================
 * Profile, Search, Settings, Analysis and Tailor are each one column of cards
 * and forms that the user reads down. They used to pick their own widths —
 * Profile and Settings `max-w-2xl`, Search `max-w-3xl`, and Analysis and Tailor
 * none at all — so going from one screen to the next moved every left-hand
 * card edge you had just learnt, and on a wide window Analysis and Tailor
 * stretched a paragraph across the whole screen, too long a line to read.
 *
 * So the five share this one class, on ONE element per screen marked
 * `data-content-column`, and no other width class sits between that column and
 * the screen's scroll area, or on the column's own children. A screen that
 * wants a different width changes this file, and so changes all five.
 *
 * The column is 1024px and CENTRED (L-326): on a wide window a left-aligned
 * column left half of every screenshot empty. It goes INSIDE the scroll area,
 * never on it: the scroll area stays full width, so its scrollbar stays at the
 * window's edge, not in the middle of it. Step bars and error banners stay
 * full width, outside the column. The page header's strip is full width too,
 * but its title row carries this same class (`ViewHeader`), so the title
 * starts where the content starts.
 *
 * Tracker (a board of columns) and the first-run welcome are not read top to
 * bottom, and keep their own widths. Tracker's title stays at the left, in
 * line with its full-width board.
 *
 * `contentColumn.contract.test.tsx` checks all of this on the rendered screens.
 */
export const CONTENT_COLUMN = 'mx-auto max-w-5xl';

/** The side padding of every screen's scroll area, the same as the header's. */
export const SIDE_PADDING = 'px-4 md:px-6';
