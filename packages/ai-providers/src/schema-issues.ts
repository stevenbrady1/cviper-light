/**
 * The ONE place a schema validator's own words are read (L-350).
 *
 * ============================================================================
 * TWO READERS, TWO FIELDS
 * ============================================================================
 * When a reply has the wrong shape, there are two people to tell, and they need
 * opposite things:
 *
 *   - the MODEL, on the one repair turn, needs the exact path and the exact
 *     complaint — "match_score: Invalid input: expected number, received
 *     undefined" names the key to fix, which is the whole point of the turn.
 *     That is `repairHint`.
 *   - the PERSON, when the repair turn failed too, needs a sentence that says
 *     what happened and what to do. That is `message`.
 *
 * For months one `message` string served both, and five features showed the
 * repair hint in the red banner. Keeping them in separately named fields means
 * the model's text cannot reach the screen by passing the wrong variable along:
 * an attempt failure has no `message` to pass. `detail` carries the field names
 * and reasons for anyone who needs them later — never any part of the reply
 * itself, which can quote the user's CV.
 *
 * `wrong-shape-wording.contract.test.ts` holds every AI entry point to this,
 * and `validator-text-boundary.contract.test.ts` fails the build if any other
 * file under `src/` starts reading the validator's issue messages itself.
 */
import type { JsonFailureKind, JsonParseFailure } from './extract-json';

/** One schema issue, as a Zod `safeParse` failure reports it. */
export interface SchemaIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** Enough to fix the reply, not so many that the repair turn becomes a wall. */
const MAX_REPORTED_ISSUES = 8;

/**
 * What the person reads when the model's answer had the wrong shape twice, in
 * analysis, tailoring, the review, the cover letter and interview prep. Worded
 * by the owner (L-350). The follow-up draft and job extraction keep sentences
 * of their own, which also say what to do by hand instead.
 */
export const WRONG_SHAPE_MESSAGE =
  'The AI did not return a usable result. Try again, or try a different model.';

/**
 * Turn a schema's issue list into something a MODEL can act on. The path
 * matters more than the prose: "experience.0.bullets: expected array" names the
 * key. For the repair prompt and for `detail` — never for a person's screen.
 */
export function describeSchemaIssues(issues: readonly SchemaIssue[]): string {
  const lines = issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue): string => {
      const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('\n');

  return issues.length > MAX_REPORTED_ISSUES
    ? `${lines}\n…and ${issues.length - MAX_REPORTED_ISSUES} more.`
    : lines;
}

/** Why one reply could not be used. Built only by the two functions below. */
export interface AttemptFailure {
  readonly kind: JsonFailureKind | 'schema-invalid';
  /** For the MODEL: quoted in the repair prompt. Never shown to a person. */
  readonly repairHint: string;
  /** For the PERSON, if this was the last attempt. */
  readonly userMessage: string;
  /** Field names and reasons for a schema mismatch; `null` otherwise. */
  readonly detail: string | null;
  /** The reply as received, for the repair prompt to quote back. */
  readonly raw: string;
}

/**
 * The reply was not JSON at all. `extract-json`'s message was written for a
 * person, and the model is told the same thing, as it always was.
 */
export function jsonAttemptFailure(failure: JsonParseFailure, raw: string): AttemptFailure {
  return {
    kind: failure.failure,
    repairHint: failure.message,
    userMessage: failure.message,
    detail: null,
    raw,
  };
}

/** The reply was JSON of the wrong shape. The two readers part ways here. */
export function schemaAttemptFailure(issues: readonly SchemaIssue[], raw: string): AttemptFailure {
  const described = describeSchemaIssues(issues);
  return {
    kind: 'schema-invalid',
    repairHint: described,
    userMessage: WRONG_SHAPE_MESSAGE,
    detail: described,
    raw,
  };
}

/** The final error's fields, from the attempt that ended it. */
export interface FinalFailure {
  readonly kind: JsonFailureKind | 'schema-invalid';
  readonly message: string;
  readonly detail?: string;
}

export function finalFailure(failure: AttemptFailure): FinalFailure {
  return {
    kind: failure.kind,
    message: failure.userMessage,
    ...(failure.detail === null ? {} : { detail: failure.detail }),
  };
}
