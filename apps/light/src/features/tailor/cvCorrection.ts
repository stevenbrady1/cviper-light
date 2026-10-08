/**
 * Correcting the CV text the AI works from (L-218).
 *
 * ============================================================================
 * ONE CORRECTION, ON THE CV ITSELF
 * ============================================================================
 * The text the app read from a CV file is what every AI request is sent, and
 * a parser can misread a file: a dropped section, dates run together, a
 * two-column layout read across. The user fixes it once, on the CV, and
 * Analysis, Tailor and every job use the fix from then on (owner decision,
 * 2026-10-08) — a misread file is a property of the CV, not of one job.
 *
 * The corrected text goes where the text always was, `extracted_text`, so no
 * reader has to know corrections exist. The file's own text moves to
 * `original_text` the first time, and stays there through later corrections,
 * so "what you changed" is always against the FILE and "Restore" always puts
 * the file's text back.
 */
import { err, ok, type Cv, type Result } from '@cviper/core-types';

/**
 * The longest corrected text accepted. A two-page CV is around 6,000
 * characters; this is room for a very long one, and a guard against a paste
 * of something that is not a CV at all.
 */
export const MAX_CV_TEXT_CHARS = 100_000;

export type CorrectionProblem = 'empty' | 'too_long';

/** Line endings as the app stores them: a Windows paste is not a change. */
function normalised(text: string): string {
  return text.replaceAll('\r\n', '\n');
}

export function isCorrected(cv: Cv): boolean {
  return cv.original_text !== null && cv.original_text !== undefined;
}

/** The CV with `text` as its text, or why that text cannot be used. */
export function correctedCv(cv: Cv, text: string): Result<Cv, CorrectionProblem> {
  const next = normalised(text);
  if (next.trim() === '') return err('empty');
  if (next.length > MAX_CV_TEXT_CHARS) return err('too_long');

  const original = isCorrected(cv) ? (cv.original_text ?? '') : (cv.extracted_text ?? '');
  // Back to exactly what the file said: that is a restore, not a correction.
  if (next === original) return ok({ ...cv, extracted_text: original, original_text: null });
  return ok({ ...cv, extracted_text: next, original_text: original });
}

/** The CV with the file's own text back. Unchanged if it was never corrected. */
export function restoredCv(cv: Cv): Cv {
  if (!isCorrected(cv)) return cv;
  return { ...cv, extracted_text: cv.original_text ?? '', original_text: null };
}
