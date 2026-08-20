/**
 * Turning a pasted advert into something the user can review.
 *
 * No React, no I/O, no provider. Everything here is a pure function over
 * values, so the rules that matter most — nulls become empty boxes, a failure
 * never loses the paste, an unconfigured machine gets a sentence rather than a
 * dead button — can be tested without rendering anything or mocking a model.
 */
import {
  ANTHROPIC_DEFAULT_MODEL,
  type JobExtractionOutcome,
} from '@cviper/ai-providers';
import { EMPTY_JOB_EXTRACTION, type JobExtraction } from '@cviper/core-types';

import { providerOptions, type Availability, type ProviderOption } from '../analysis/providers';

import { EMPTY_DRAFT, type ApplicationDraft } from './model';

/**
 * The ways an extraction can be run on this machine.
 *
 * `providerOptions` is reused rather than reimplemented — it already knows how
 * to read an availability probe, how to name a model, and that an option the
 * user cannot use is ABSENT rather than greyed out. The one thing filtered away
 * is the keyword scorer: it exists to score a CV against an advert, and there
 * is no keyword heuristic that reads a title and a company out of prose. The
 * source app is explicit about this too — `_email_extraction_unavailable`'s
 * docstring says there is no heuristic here that would beat the user typing the
 * fields themselves.
 *
 * WHICH IS WHY THERE IS NO REGEX FALLBACK. A pattern-matched "title" pulled off
 * the first line of an email is wrong often enough to be worse than an empty
 * box, and it would be wrong INVISIBLY — the review form cannot tell the user
 * which fields were guessed.
 */
export function extractionOptions(availability: Availability): ProviderOption[] {
  return providerOptions(availability).filter((option) => option.kind !== 'keyword');
}

/**
 * What to say when there is no AI on this machine at all.
 *
 * Names both routes out — the free one first — and never implies the user has
 * done something wrong. Adding a job by hand is a first-class way to use this
 * app, not a consolation prize, so it is offered in the same breath.
 */
export const NO_PROVIDER_NOTE =
  'Extraction needs an AI provider (free with Ollama, or your own key) — or add the job manually.';

/**
 * What to say while a local model is thinking.
 *
 * A local model that is not already resident spends 5-30 seconds loading
 * several gigabytes into memory before it emits a single token. Thirty seconds
 * of a still screen is indistinguishable from a crash, so the wait says what is
 * happening and why it is slow. Same wording discipline as the analysis view.
 */
export function extractionProgressNote(option: ProviderOption): string {
  return option.local
    ? `Reading the advert with ${option.model} on this machine. The first run after starting ` +
        'your PC loads the model into memory, which takes 5 to 30 seconds. Nothing is being ' +
        'sent anywhere.'
    : `Sending the advert to ${option.kind === 'anthropic' ? 'Anthropic' : 'OpenAI'}. ` +
        'This usually takes a few seconds.';
}

/** A number as the review form shows it. `null` is an EMPTY BOX, never a zero. */
function numberField(value: number | null): string {
  return value === null ? '' : String(value);
}

/** A string as the review form shows it. `null` is an EMPTY BOX, never a guess. */
function textField(value: string | null): string {
  return value ?? '';
}

/**
 * The extraction, as boxes for the user to check.
 *
 * ============================================================================
 * A NULL IS AN EMPTY BOX. IT IS NEVER FILLED IN WITH SOMETHING PLAUSIBLE.
 * ============================================================================
 * That is the whole design rule of the source feature, quoted from its manifest:
 * "an empty box the user fills in is correct; a plausible invented day rate is a
 * bad decision waiting to happen". Nothing in this function has a default, a
 * fallback or a best guess, WITH ONE EXCEPTION, below.
 *
 * THE EXCEPTION: `description` falls back to the pasted text when the model
 * returned nothing for it. That is not a guess — it is the user's own words,
 * put in the one box big enough to hold them, so a successful-but-empty
 * extraction cannot silently swallow what they pasted. They can edit it or
 * clear it; what they cannot do is get it back once it is gone.
 *
 * `status` is not part of the extraction and never will be: an advert cannot
 * know whether the user has applied to it. It starts where the manual form
 * starts.
 */
export function draftFromExtraction(
  extraction: JobExtraction,
  pastedText: string,
  sourceUrl = '',
): ApplicationDraft {
  return {
    ...EMPTY_DRAFT,
    title: textField(extraction.title),
    company: textField(extraction.company),
    // VERBATIM, hybrid and remote wording included. See the location rule in
    // `build-extraction-prompt.ts`: three days on site is the difference
    // between a job somebody can take and one they cannot.
    location: textField(extraction.location),
    description: extraction.description ?? pastedText,
    // THE SECOND EXCEPTION, and the same kind as `description` above: not a
    // guess, but something the user themselves supplied. If they typed or
    // pasted the advert's address into the link box, that address is a fact,
    // and the page's own text almost never contains it — so without this the
    // one field we know for certain would be the one left blank. An address
    // the model actually found IN the advert still wins: an advert naming its
    // own application link is naming the one the user should end up with.
    url: textField(extraction.url) || sourceUrl.trim(),
    postedDate: textField(extraction.posted_date),
    salaryMin: numberField(extraction.salary_min),
    salaryMax: numberField(extraction.salary_max),
    salaryCurrency: textField(extraction.salary_currency),
  };
}

/**
 * The fall-through: a blank form that still has everything the user pasted.
 *
 * Reached when the model failed twice, when the provider was unreachable, and
 * when there was no provider to ask in the first place. The paste goes in
 * `description` because it is the only field big enough and the only one where
 * arbitrary prose is correct rather than wrong — a whole advert in the title
 * box would be a second failure on top of the first.
 */
export function draftWithPastedText(text: string, sourceUrl = ''): ApplicationDraft {
  return { ...EMPTY_DRAFT, description: text, url: sourceUrl.trim() };
}

/**
 * The draft to open the review form with, whatever happened.
 *
 * ONE function for both outcomes, so there is exactly one answer to "what does
 * the user see now" and no path where a failure leads somewhere that has not
 * been thought about. A failed extraction returns `EMPTY_JOB_EXTRACTION`, so
 * this is the same code either way — the paste survives because
 * `draftFromExtraction` falls back to it, not because of a second branch.
 */
export function draftFromOutcome(
  outcome: JobExtractionOutcome,
  pastedText: string,
  sourceUrl = '',
): ApplicationDraft {
  return outcome.available
    ? draftFromExtraction(outcome.extraction, pastedText, sourceUrl)
    : draftFromExtraction(EMPTY_JOB_EXTRACTION, pastedText, sourceUrl);
}

/** Re-exported so the paste form can name the cloud model in its own copy. */
export { ANTHROPIC_DEFAULT_MODEL };
