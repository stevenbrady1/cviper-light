/**
 * The error channel for @cviper/resume-schema.
 *
 * Nothing here throws across a boundary. Every message says what happened,
 * why, and what to do — there is no support inbox behind this app, so the
 * sentence on screen is the whole of the help the user gets.
 *
 * Branch on `code`, never on `message`.
 */

export type ResumeErrorCode =
  /** Not JSON at all: a syntax error, or bytes that are not UTF-8 text. */
  | 'INVALID_JSON'
  /** Valid JSON, but not a résumé: an array, a number, or an object with no résumé section. */
  | 'NOT_A_JSON_RESUME'
  /** A résumé whose fields have the wrong shape. `issues` lists every one, by path. */
  | 'INVALID_JSON_RESUME'
  /** A valid résumé with nothing in it to read. */
  | 'EMPTY_RESUME';

interface ResumeErrorBase<C extends ResumeErrorCode> {
  readonly code: C;
  readonly message: string;
  /** The underlying parser's own words, for logs. Never shown to the user. */
  readonly detail: string | null;
}

export type ResumeError =
  | ResumeErrorBase<'INVALID_JSON'>
  | ResumeErrorBase<'NOT_A_JSON_RESUME'>
  | (ResumeErrorBase<'INVALID_JSON_RESUME'> & {
      /** One line per problem: `work[0].highlights: expected an array of strings`. */
      readonly issues: readonly string[];
    })
  | ResumeErrorBase<'EMPTY_RESUME'>;

/** How many problems to name in the message before saying "and N more". */
export const MAX_ISSUES_IN_MESSAGE = 5;

export function invalidJsonError(detail: string): ResumeError {
  return {
    code: 'INVALID_JSON',
    message:
      'That file is not valid JSON, so it cannot be a JSON Resume. It may have ' +
      'been cut short while saving, or it may not be a JSON file at all. Export ' +
      'it again from the tool that made it, then try again.',
    detail,
  };
}

export function notAJsonResumeError(): ResumeError {
  return {
    code: 'NOT_A_JSON_RESUME',
    message:
      'That is a JSON file, but not a JSON Resume: none of the sections a résumé ' +
      'has (basics, work, education, skills and so on) is in it. CViper reads the ' +
      'JSON Resume format, which CVAurum, Reactive Resume and jsonresume.org tools ' +
      'all export. Check you picked the right file.',
    detail: null,
  };
}

export function invalidJsonResumeError(issues: readonly string[]): ResumeError {
  const shown = issues.slice(0, MAX_ISSUES_IN_MESSAGE);
  const more = issues.length - shown.length;
  const list = shown.map((issue) => `• ${issue}`).join('\n');
  const tail = more > 0 ? `\n• …and ${more} more` : '';
  return {
    code: 'INVALID_JSON_RESUME',
    message:
      'That JSON Resume has fields CViper cannot make sense of, so nothing has ' +
      'been imported. Fix these in the tool that exported it, then try again:\n' +
      list +
      tail,
    detail: null,
    issues,
  };
}

export function emptyResumeError(): ResumeError {
  return {
    code: 'EMPTY_RESUME',
    message:
      'That JSON Resume is valid but has no text in it — no name, no jobs, no ' +
      'skills, nothing to read. Check you picked the right file, and that the CV ' +
      'was filled in before it was exported.',
    detail: null,
  };
}

/** The text of an unknown thrown value, without assuming it is an `Error`. */
export function describeUnknown(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  try {
    return JSON.stringify(cause) ?? String(cause);
  } catch {
    return String(cause);
  }
}
