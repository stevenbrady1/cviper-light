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
 * `{keyword}` and `{location}`, and since L-219 `{radius}`, `{salaryMin}` and
 * `{contract}`, are the only placeholders that exist. Everything else in a
 * template is a literal, including — deliberately — the word `jobs` in
 * Google's query. A board that cannot take a filter simply leaves its
 * placeholder out; `filters` says how a board that CAN take one wants it.
 */
import { z } from './zod';

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

/** The only placeholders. Named here so builder and validator cannot drift. */
export const KEYWORD_PLACEHOLDER = '{keyword}';
export const LOCATION_PLACEHOLDER = '{location}';
/** Distance from the location (L-219). Miles unless `filters.radius.unit` says km. */
export const RADIUS_PLACEHOLDER = '{radius}';
/** Minimum yearly salary in pounds (L-219). */
export const SALARY_MIN_PLACEHOLDER = '{salaryMin}';
/** Permanent or contract, in the board's own word (L-219). */
export const CONTRACT_PLACEHOLDER = '{contract}';

export const BOARD_PLACEHOLDERS = [
  KEYWORD_PLACEHOLDER,
  LOCATION_PLACEHOLDER,
  RADIUS_PLACEHOLDER,
  SALARY_MIN_PLACEHOLDER,
  CONTRACT_PLACEHOLDER,
] as const;

/**
 * How a board wants the filters it can take (L-219). All optional: a board
 * without this section gets plain values — whole miles, whole pounds, and the
 * words `permanent` / `contract` — which is what a user's own board gets.
 */
export interface BoardFilters {
  /** `steps`: the only distances the site offers, smallest first. */
  readonly radius?:
    { readonly unit: 'miles' | 'km'; readonly steps?: readonly number[] | undefined } | undefined;
  /**
   * `steps`: the only salary floors the site offers, smallest first.
   * `with`: a fixed parameter the site needs beside the salary, sent only when
   * a salary is (`&salarytypeid=1`: "a year").
   */
  readonly salaryMin?:
    | { readonly steps?: readonly number[] | undefined; readonly with?: string | undefined }
    | undefined;
  /**
   * The site's word for each contract type, used as written: a value
   * (`permanent`), a path segment, or a whole parameter (`perm=true`). A type
   * with no word sends nothing.
   */
  readonly contract?:
    { readonly permanent?: string | undefined; readonly contract?: string | undefined } | undefined;
}

export interface BoardTemplate {
  /** Stable, and the key every user preference is stored against. */
  readonly id: string;
  /** What the button says. */
  readonly label: string;
  /** A full `https://` URL containing `{keyword}` and optionally `{location}`. */
  readonly urlTemplate: string;
  readonly encoding: BoardEncoding;
  readonly filters?: BoardFilters | undefined;
}

const steps = z
  .array(z.number().int().positive())
  .min(1)
  .refine((values) => values.every((value, index) => index === 0 || value > values[index - 1]!), {
    message: 'steps must be in ascending order',
  });

const contractWord = z.string().regex(/^[A-Za-z0-9_.~-]+(=[A-Za-z0-9_.~-]+)?$/);

const BoardFiltersSchema = z.object({
  radius: z.object({ unit: z.enum(['miles', 'km']), steps: steps.optional() }).optional(),
  salaryMin: z
    .object({
      steps: steps.optional(),
      with: z
        .string()
        .regex(/^&[A-Za-z0-9_.~-]+=[A-Za-z0-9_.~-]+$/)
        .optional(),
    })
    .optional(),
  // Used as written, so held to characters that cannot reshape a URL: no
  // `/`, `?`, `#`, `&` or spaces — one word, or one `name=value`.
  contract: z
    .object({ permanent: contractWord.optional(), contract: contractWord.optional() })
    .optional(),
});

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
  filters: BoardFiltersSchema.optional(),
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
