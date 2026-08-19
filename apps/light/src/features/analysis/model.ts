/**
 * The analysis view's rules and data shapes, with no React in sight.
 *
 * Everything that decides WHETHER something can run, and WHAT gets written down
 * afterwards, lives here so it can be tested without rendering anything.
 */
import { MIN_SCORABLE_CHARS } from '@cviper/keyword-scoring';

import {
  type Analysis,
  type CvAnalysis,
  type Cv,
  type IsoTimestamp,
  type Job,
} from '@cviper/core-types';

import { type ProviderOption } from './providers';

/**
 * The shortest advert, and the shortest CV, worth comparing.
 *
 * Taken from `@cviper/keyword-scoring` rather than picked again here: the
 * scorer refuses anything shorter, and a button that let the user run something
 * guaranteed to come back as an error would be the UI disagreeing with the
 * engine about what is possible.
 */
export const MIN_ADVERT_CHARS = MIN_SCORABLE_CHARS;

/** Everything the run button needs to know about. */
export interface RunState {
  readonly cv: Cv | null;
  readonly jobText: string;
  /** The chosen option, or `null` if it is no longer being offered. */
  readonly option: ProviderOption | null;
  readonly running: boolean;
}

/**
 * Why the run button cannot be pressed, or `null` when it can.
 *
 * ============================================================================
 * A DISABLED BUTTON THAT SAYS NOTHING IS A DEAD END.
 * ============================================================================
 * This is a free, offline app. There is no support inbox, no error dashboard
 * and nobody to ask — the UI is the entire support channel. A greyed-out button
 * with no explanation is therefore not a small usability wrinkle, it is the
 * point at which the user's session ends.
 *
 * So the reason is a value, it is rendered next to the button, and every branch
 * of it is covered by a test.
 *
 * ORDER IS THE MESSAGE. Exactly one reason is returned, and it is the FIRST
 * thing the user has to do, not the first thing the code happens to check.
 * Listing all four at once is a wall of text that answers "what do I do next"
 * with "everything".
 */
export function runDisabledReason(state: RunState): string | null {
  // Outranks everything: while a run is in flight, nothing else is actionable
  // and the other messages would be advice about a button that is busy.
  if (state.running) {
    return 'Already running. Give it a moment.';
  }

  if (state.cv === null) {
    return 'Choose a CV first.';
  }

  const cvText = (state.cv.extracted_text ?? '').trim();
  if (cvText.length === 0) {
    return (
      'That CV has no readable text, so there is nothing to compare. It is ' +
      'almost certainly a scan or a photo — upload the original .docx, or a ' +
      'PDF you exported from Word.'
    );
  }
  if (cvText.length < MIN_ADVERT_CHARS) {
    return (
      'There is almost no text in that CV — only ' +
      `${cvText.length} characters could be read out of it. Upload the original ` +
      '.docx, or a PDF you exported from Word.'
    );
  }

  const advert = state.jobText.trim();
  if (advert.length === 0) {
    return 'Paste the job advert.';
  }
  if (advert.length < MIN_ADVERT_CHARS) {
    return (
      `Paste more of the advert — at least ${MIN_ADVERT_CHARS} characters. ` +
      'The requirements list is the part that matters most.'
    );
  }

  if (state.option === null) {
    return (
      'The way you chose to run this is no longer available — Ollama may have ' +
      'stopped. Pick another option.'
    );
  }

  return null;
}

/**
 * A CV row from a parsed upload.
 *
 * Ids are passed IN rather than generated here, so this stays a pure function a
 * test can assert exactly. The data layer's rule is that ids are UUIDs made by
 * the caller (see `db/index.ts`), and the caller is the component.
 */
export function newCvRecord(input: {
  readonly id: string;
  readonly name: string;
  /** Absolute path, or `null` when the text was pasted rather than opened. */
  readonly path: string | null;
  readonly text: string;
  readonly now: IsoTimestamp;
}): Cv {
  return {
    id: input.id,
    name: input.name,
    file_path: input.path,
    extracted_text: input.text,
    created_at: input.now,
  };
}

/**
 * An analysis row from a finished run.
 *
 * `match_score` is duplicated out of `result_json` on purpose: it is a column
 * so the history list can be drawn without deserialising every stored result.
 * It is copied FROM the result and never passed in separately — two sources for
 * one number is two numbers that can disagree on screen.
 */
export function newAnalysisRecord(input: {
  readonly id: string;
  readonly cvId: string;
  readonly jobId: string | null;
  readonly provider: string;
  readonly model: string;
  readonly analysis: CvAnalysis;
  readonly now: IsoTimestamp;
}): Analysis {
  return {
    id: input.id,
    cv_id: input.cvId,
    job_id: input.jobId,
    provider: input.provider,
    model: input.model,
    match_score: input.analysis.match_score,
    result_json: input.analysis,
    created_at: input.now,
  };
}

/**
 * Advert text for a job already on the tracker board.
 *
 * The title and company go in even though they are not "the advert": the
 * keyword scorer reads the job title to decide whether the candidate's own
 * titles line up, and an analysis run against a bare description would silently
 * lose that half of the score.
 *
 * A blank line separates the header from the body, and absent fields are left
 * out entirely rather than becoming empty lines the scanner has to step over.
 */
export function jobAdvertText(job: Job): string {
  const header = [job.title, job.company, job.location]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join('\n');

  const description = (job.description ?? '').trim();
  return description === '' ? header : `${header}\n\n${description}`;
}

/**
 * The stored `provider` string, as a person would say it.
 *
 * Falls back to the stored value itself. Analyses outlive the build that wrote
 * them — they sit in the database and in export files — so a provider this
 * version has never heard of must render as its own name rather than as
 * "Unknown", which would tell the user their history is corrupt when it is not.
 */
const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  keyword: 'Basic match',
  ollama: 'Ollama',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}
