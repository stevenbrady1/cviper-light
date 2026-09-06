/**
 * Bytes or text in, a validated `JsonResume` out.
 */
import { err, ok, type Result } from '@cviper/core-types';

import {
  describeUnknown,
  emptyResumeError,
  invalidJsonError,
  invalidJsonResumeError,
  notAJsonResumeError,
  type ResumeError,
} from './errors';
import { flattenJsonResume } from './flatten';
import { JsonResumeSchema, RESUME_SECTION_KEYS, type JsonResume } from './schema';

/**
 * A dotted path with array indexes in brackets: `work[0].highlights[2]`.
 * Empty path (a problem with the root) is reported as `resume`.
 */
export function describePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return 'resume';
  return path.reduce<string>((joined, key) => {
    if (typeof key === 'number') return `${joined}[${key}]`;
    return joined.length === 0 ? String(key) : `${joined}.${String(key)}`;
  }, '');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Does this object have at least one résumé section that is not empty?
 *
 * `{ "basics": {} }` and `{ "work": [] }` count: they are a résumé with
 * nothing in it, which `parseJsonResume` reports as EMPTY_RESUME — a
 * different, more useful message than "not a résumé".
 */
function hasResumeSection(value: Record<string, unknown>): boolean {
  return RESUME_SECTION_KEYS.some((key) => key in value && value[key] !== undefined);
}

/**
 * Parse JSON text as a JSON Resume.
 *
 * Order of checks, and why:
 *   1. Is it JSON at all? A syntax error is answered as a syntax error.
 *   2. Is it a résumé? An array, a string, or an object with none of the
 *      résumé sections is answered as "not a JSON Resume", before any field
 *      is inspected — a list of shape errors about a file that was never a
 *      résumé would send the user off to fix the wrong thing.
 *   3. Is every field the right shape? All problems are reported together,
 *      by path, so one pass through the exporting tool fixes them all.
 *   4. Is there anything in it? A résumé that flattens to nothing is
 *      reported as empty rather than imported as an empty CV.
 */
export function parseJsonResume(text: string): Result<JsonResume, ResumeError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    return err(invalidJsonError(describeUnknown(cause)));
  }

  if (!isPlainObject(raw) || !hasResumeSection(raw)) return err(notAJsonResumeError());

  const parsed = JsonResumeSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${describePath(issue.path)}: ${issue.message}`,
    );
    return err(invalidJsonResumeError(issues));
  }

  // The ORIGINAL object goes back, not Zod's copy. The schema has no
  // transforms, coercions or defaults, so the two hold the same values — but
  // Zod rebuilds an object in schema order with unknown keys last, and a
  // résumé that came in as `skills, basics` would go out as `basics, skills`.
  // Returning what was read is what makes the round trip byte-identical.
  const resume: JsonResume = raw as JsonResume;

  if (flattenJsonResume(resume).length === 0) return err(emptyResumeError());

  return ok(resume);
}

/**
 * Parse a file's bytes as a JSON Resume.
 *
 * UTF-8 only, which is what the JSON specification requires of a file. A
 * leading byte-order mark is dropped (`TextDecoder` does that by default);
 * bytes that are not UTF-8 at all are reported as invalid JSON rather than
 * decoded into replacement characters and then rejected one field at a time.
 */
export function parseJsonResumeBytes(bytes: Uint8Array): Result<JsonResume, ResumeError> {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    return err(invalidJsonError(`not UTF-8: ${describeUnknown(cause)}`));
  }
  return parseJsonResume(text);
}
