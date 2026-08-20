/**
 * A job board this app can send a search to, described as DATA.
 *
 * ============================================================================
 * WHY A TEMPLATE AND NOT A FUNCTION PER BOARD
 * ============================================================================
 * The first version of this had one hand-written builder per board. Two boards
 * is fine. Eight is eight functions that differ only in a host and a separator,
 * and the ninth cannot be added by anyone who is not willing to ship a new
 * binary. A board is a URL shape and two rules about spaces, so it is stored as
 * a URL shape and two rules about spaces: the shipped list is a JSON file, the
 * user's own boards are the same shape in their own store, and one builder
 * serves both.
 *
 * `{keyword}` and `{location}` are the only placeholders that exist. Everything
 * else in a template is a literal, including — deliberately — the word `jobs`
 * in Google's query.
 */
import { z } from 'zod';

import { err, ok, type Result } from './result';

/**
 * How a board wants the spaces in a value.
 *
 * `hyphen` boards put the search in the PATH (`/business-analyst-jobs-in-leeds`)
 * and `plus` boards put it in the QUERY (`?q=business+analyst`). Everything
 * that is not a space is percent-encoded either way — see `buildBoardUrl` in
 * `@cviper/job-apis`, which is the only place this is interpreted.
 */
export const BOARD_ENCODINGS = ['hyphen', 'plus'] as const;

export type BoardEncoding = (typeof BOARD_ENCODINGS)[number];

/** The only two placeholders. Named here so builder and validator cannot drift. */
export const KEYWORD_PLACEHOLDER = '{keyword}';
export const LOCATION_PLACEHOLDER = '{location}';

export interface BoardTemplate {
  /** Stable, and the key every user preference is stored against. */
  readonly id: string;
  /** What the button says. */
  readonly label: string;
  /** A full `https://` URL containing `{keyword}` and optionally `{location}`. */
  readonly urlTemplate: string;
  readonly encoding: BoardEncoding;
}

/**
 * Validates both the shipped JSON and anything read back out of the user's
 * store. Unknown keys are STRIPPED rather than carried: a board object is
 * handed straight to a URL builder, and a field nothing reads is a field
 * nothing checks.
 */
export const BoardTemplateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  urlTemplate: z.string().min(1),
  encoding: z.enum(BOARD_ENCODINGS),
});

/**
 * Read a whole list of boards — the shipped JSON, or whatever came back out of
 * the user's store.
 *
 * Returns a `Result` rather than throwing, and rather than filtering silently:
 * a list that is half-readable is a list somebody has hand-edited, and quietly
 * dropping the entries we did not like would leave them with a board that
 * vanished and no reason given.
 */
export function parseBoardTemplates(raw: unknown): Result<BoardTemplate[], string> {
  const parsed = z.array(BoardTemplateSchema).safeParse(raw);
  return parsed.success ? ok(parsed.data) : err(z.prettifyError(parsed.error));
}
