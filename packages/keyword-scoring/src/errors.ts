/**
 * The error channel for @cviper/keyword-scoring.
 *
 * Nothing here throws across the boundary: `scoreByKeywords` returns
 * `Result<CvAnalysis, ScoringError>` from `@cviper/core-types`, so a caller
 * that forgets a failure path is a compile error rather than a crash in front
 * of someone who was only trying to check a job advert.
 *
 * ============================================================================
 * WHY THESE ARE ERRORS AND NOT A LOW SCORE.
 * ============================================================================
 * The tempting alternative is to score an empty CV as 0 and move on. It is the
 * wrong answer twice over: it is not true — nothing was measured — and on
 * screen a 0 reads as a verdict on the candidate rather than a note that
 * nothing was supplied. "This CV scores 0 against the job" is a devastating
 * thing to tell someone because a file failed to load.
 *
 * Branch on `code`, never on `message`. The wording is expected to improve.
 */

export type ScoringErrorCode =
  /** No CV text at all, or nothing but whitespace. */
  | 'EMPTY_CV'
  /** CV text too short for a keyword scan to mean anything. */
  | 'CV_TOO_SHORT'
  /** No advert text at all, or nothing but whitespace. */
  | 'EMPTY_JOB_DESCRIPTION'
  /** Advert text too short for a keyword scan to mean anything. */
  | 'JOB_DESCRIPTION_TOO_SHORT';

export interface ScoringError {
  readonly code: ScoringErrorCode;
  /** Legible enough to put in front of a user with no further translation. */
  readonly message: string;
}

export function emptyCvError(): ScoringError {
  return {
    code: 'EMPTY_CV',
    message:
      'There is no CV text to compare. Nothing was measured, so there is no ' +
      'score — this is not a judgement on your CV. Upload or paste your CV ' +
      'and try again.',
  };
}

export function cvTooShortError(characters: number, minimum: number): ScoringError {
  return {
    code: 'CV_TOO_SHORT',
    message:
      `That CV is only ${characters} characters long, and at least ${minimum} are ` +
      'needed before a keyword comparison says anything useful. If your CV is ' +
      'a scan or a photo, the text could not be read out of it — try the ' +
      'original Word or PDF file you exported.',
  };
}

export function emptyJobDescriptionError(): ScoringError {
  return {
    code: 'EMPTY_JOB_DESCRIPTION',
    message:
      'There is no job advert to compare your CV against. Paste the advert ' +
      'text — the whole thing, including the requirements list — and try again.',
  };
}

export function jobDescriptionTooShortError(characters: number, minimum: number): ScoringError {
  return {
    code: 'JOB_DESCRIPTION_TOO_SHORT',
    message:
      `That job advert is only ${characters} characters long, and at least ` +
      `${minimum} are needed for a keyword comparison to mean anything. Paste ` +
      'the full advert, including the requirements, rather than just the job title.',
  };
}
