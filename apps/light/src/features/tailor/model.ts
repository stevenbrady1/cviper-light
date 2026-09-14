/**
 * The tailor view's rules and data shapes, with no React in sight.
 *
 * Everything that decides WHETHER a run can start, WHICH options are offered
 * and WHAT gets written down afterwards lives here, so it can be tested
 * without rendering anything.
 */
import { MIN_SCORABLE_CHARS } from '@cviper/keyword-scoring';

import {
  type Cv,
  type Document,
  type DocumentKind,
  type IsoTimestamp,
  type Profile,
} from '@cviper/core-types';

import { type ProviderOption } from '../analysis/providers';

/** The shortest advert, and the shortest CV, worth rewriting for. Same bar as the analysis. */
export const MIN_TEXT_CHARS = MIN_SCORABLE_CHARS;

/** A cover letter longer than this is a second page nobody reads. */
export const LETTER_WORD_LIMIT = 400;

/**
 * Why the run button cannot be pressed when there is nothing to run it with.
 *
 * ============================================================================
 * THERE IS NO KEYWORD FALLBACK FOR WRITING, AND THE SCREEN SAYS SO
 * ============================================================================
 * The analysis screen works with nothing configured because comparing word
 * lists needs no model. Writing prose does. So the one honest thing this
 * screen can do on a machine with no local model and no key is say what it
 * needs, in generic words — a local model or the user's own key — and point
 * at the screen where either is set up. No provider is named: the product
 * does not read as tied to one (L-148).
 */
export const NO_AI_REASON = 'Needs a local model or your own key. Set one up in Settings.';

/**
 * The options this screen offers: everything the analysis picker offers
 * EXCEPT the basic match. The keyword scorer cannot write, and a picker that
 * listed it would be offering a run that is guaranteed to refuse.
 */
export function tailorOptions(options: readonly ProviderOption[]): ProviderOption[] {
  return options.filter((option) => option.kind !== 'keyword');
}

/** Everything the run button needs to know about. */
export interface TailorRunState {
  readonly cv: Cv | null;
  readonly jobText: string;
  /** The chosen option, or `null` if it is no longer being offered. */
  readonly option: ProviderOption | null;
  /** True when at least one non-keyword option exists at all. */
  readonly aiAvailable: boolean;
  readonly running: boolean;
}

/**
 * Why the run button cannot be pressed, or `null` when it can.
 *
 * ORDER IS THE MESSAGE — the same rule as the analysis screen's: exactly one
 * reason, and it is the FIRST thing the user has to do. A missing model
 * outranks a missing CV, because uploading a CV on a machine that cannot run
 * this is work towards a button that still will not press.
 */
export function runDisabledReason(state: TailorRunState): string | null {
  if (state.running) {
    return 'Already running. Give it a moment.';
  }

  if (!state.aiAvailable) {
    return NO_AI_REASON;
  }

  if (state.cv === null) {
    return 'Choose a CV first. Upload one on the Analysis screen if there is none here.';
  }

  const cvText = (state.cv.extracted_text ?? '').trim();
  if (cvText.length === 0) {
    return (
      'That CV has no readable text, so there is nothing to rewrite from. It is ' +
      'almost certainly a scan or a photo — upload the original .docx, or a ' +
      'PDF you exported from Word.'
    );
  }
  if (cvText.length < MIN_TEXT_CHARS) {
    return (
      'There is almost no text in that CV — only ' +
      `${cvText.length} characters could be read out of it. Upload the original ` +
      '.docx, or a PDF you exported from Word.'
    );
  }

  const advert = state.jobText.trim();
  if (advert.length === 0) {
    return 'Paste the job advert, or choose a tracked job.';
  }
  if (advert.length < MIN_TEXT_CHARS) {
    return (
      `Paste more of the advert — at least ${MIN_TEXT_CHARS} characters. ` +
      'The requirements list is the part that matters most.'
    );
  }

  if (state.option === null) {
    return (
      'The way you chose to run this is no longer available — the local model may have ' +
      'stopped. Pick another option.'
    );
  }

  return null;
}

/**
 * The candidate's own notes for the prompt, from the profile (L-154), or
 * `null` when there is nothing worth saying.
 *
 * Only the fields that change how text should READ go in: the headline says
 * how they describe themselves, `writing_style` says how they write. Deal
 * breakers, goals and STAR examples are facts about the search, not the
 * voice, and a fact in the notes is a fact the model might write into the CV.
 */
export function profileNotes(profile: Profile | null): string | null {
  if (profile === null) return null;
  const lines: string[] = [];
  const headline = profile.headline?.trim() ?? '';
  if (headline !== '') lines.push(`Headline, in their own words: ${headline}`);
  const style = profile.writing_style?.trim() ?? '';
  if (style !== '') lines.push(`How they want generated text to sound: ${style}`);
  return lines.length === 0 ? null : lines.join('\n');
}

/**
 * The title an archived document gets: what it is, then which job.
 *
 * `jobTitle` is the tracked job's own title; the dash is an em dash because
 * that is how the tracker already joins a title to a company.
 */
export function documentTitle(kind: 'cv' | 'cover_letter', jobTitle: string): string {
  const what = kind === 'cv' ? 'Tailored CV' : 'Cover letter';
  const job = jobTitle.trim();
  return job === '' ? what : `${what} — ${job}`;
}

/**
 * What the save dialog is pre-filled with. Only a SUGGESTION: Rust re-checks
 * it for separators and control characters and falls back to
 * `cviper-export.txt` itself (`bare_text_name`).
 */
export function exportFileName(kind: 'cv' | 'cover_letter', jobTitle: string): string {
  return `${documentTitle(kind, jobTitle)}.txt`;
}

/**
 * A document row from a finished draft.
 *
 * Ids are passed IN rather than generated here, so this stays a pure function
 * a test can assert exactly — the same rule as `newAnalysisRecord`.
 */
export function newDocument(input: {
  readonly id: string;
  readonly applicationId: string;
  readonly kind: DocumentKind;
  readonly title: string;
  readonly text: string;
  readonly now: IsoTimestamp;
}): Document {
  return {
    id: input.id,
    application_id: input.applicationId,
    kind: input.kind,
    title: input.title,
    text: input.text,
    created_at: input.now,
  };
}
