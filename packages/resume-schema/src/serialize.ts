/**
 * A `JsonResume` as the text of a `.json` file.
 *
 * Two-space indentation and a trailing newline, which is what every JSON
 * Resume tool writes and what a diff reads best as. Key order is the order the
 * object holds — which, for a résumé that came in through `parseJsonResume`,
 * is the order the source file had, so a file that goes in and comes out is
 * the same file.
 */
import type { JsonResume } from './schema';

export function serializeJsonResume(resume: JsonResume): string {
  return `${JSON.stringify(resume, null, 2)}\n`;
}
