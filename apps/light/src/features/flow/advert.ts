/**
 * A search result's advert, made whole before anybody scores a CV against it
 * (L-190).
 *
 * ============================================================================
 * WHY A SEARCH RESULT IS NOT ALWAYS AN ADVERT
 * ============================================================================
 * Adzuna's `description` and Reed's search `jobDescription` are PREVIEWS — the
 * first few hundred characters, cut mid-sentence — and the Guardian's feed
 * carries nothing but the salary and location lines. Arbeitnow usually sends
 * the whole thing. Analysing a preview produces a confident score against the
 * opening paragraph, with the requirements list — the part that decides the
 * score — never read. That is worse than no score, because it looks like one.
 *
 * So when the user presses "Analyse this job" on a preview, the app reads the
 * advert's own page: ONE page, the one the result links to, on that press and
 * no other, through `runFetch` and every rule it already has (the blocklist,
 * the private-address refusals in Rust, the login-wall check). When the page
 * cannot be read, the preview is kept and the user is told what to do about it
 * in words that are true — never a status code.
 *
 * Nothing here writes anything. Saving the better text onto the job is the
 * search port's business; this module only decides what the better text is.
 */
import { type Job, type JobSource } from '@cviper/core-types';
import { DESCRIPTION_MAX_CHARS } from '@cviper/job-apis';

import { FETCH_SITE_REFUSES_NOTE, runFetch } from '../tracker/runFetch';
import { createTauriPageTransport, type PageFetchTransport } from '../tracker/pageFetch';

/**
 * The boards whose search results only ever carry a preview.
 *
 * Listed by name rather than left to the length rule below, because a long
 * preview is still a preview: Reed's cut-off falls wherever it falls, and a
 * preview that happened to clear the threshold would otherwise be scored as
 * though it were the whole advert.
 */
const PREVIEW_SOURCES: ReadonlySet<JobSource> = new Set<JobSource>(['adzuna', 'reed', 'guardian']);

/**
 * Shorter than this, an advert is treated as a preview wherever it came from.
 *
 * A thousand characters is about a hundred and sixty words. The previews this
 * app meets are well under it — Adzuna's and Reed's stop at a few hundred
 * characters, the Guardian's at two short lines — while a real advert with a
 * requirements list, a salary and a line about the employer is comfortably
 * past it. Being wrong in the strict direction costs one extra page read the
 * user asked for anyway; being wrong in the generous direction costs a score
 * computed against a fragment, which the user has no way to notice.
 */
export const FULL_ADVERT_MIN_CHARS = 1000;

/**
 * What the Analysis screen says when the site turned the app away.
 *
 * Not `FETCH_SITE_REFUSES_NOTE`: that sentence talks about "Fetch" and "the box
 * below" on the tracker's paste form, and neither exists on the Analysis
 * screen. Same facts — it is the site's policy, and pasting works — said about
 * the screen the user is actually looking at.
 */
export const PREVIEW_SITE_BLOCKS_NOTE =
  'This job site blocks apps from reading its pages, so only a preview of the advert came ' +
  'with this result. For a proper score, open the advert in your browser, copy it, and paste ' +
  'it over the preview below.';

/**
 * What the Analysis screen says for every other way the full advert did not
 * arrive: no link, a page that would not load, a login wall, a page shorter
 * than the preview itself. All of them mean one thing to the user and have one
 * remedy, which is the header's point in `runFetch.ts` too.
 */
export const PREVIEW_ONLY_NOTE =
  'Only a preview of the advert came with this result, and the full page could not be read. ' +
  'For a proper score, paste the full advert over the preview below.';

/**
 * What the search screen says, next to the results, before anybody presses
 * "Analyse this job".
 *
 * The same disclosure the tracker's Fetch carries (`FETCH_DISCLOSURE`), for the
 * same reason: reading an advert's page is a real request to somebody else's
 * server, and the sentence belongs on screen beside the control that starts
 * it, not in a settings page. It says when it happens — only for a preview —
 * and that it is one page.
 */
export const ANALYSE_DISCLOSURE =
  'Analyse this job saves the advert to your tracker. When a result carries only a preview ' +
  'of the advert, it also opens that one page from your computer to read the rest, the same ' +
  'as visiting it in your browser — the site sees your IP address.';

/** The advert text to analyse, and the one sentence to show beside it, if any. */
export interface FullAdvert {
  /** The best advert text there is: the page's, or the stored description. */
  readonly text: string;
  /** Safe to show verbatim. `null` when `text` is the whole advert. */
  readonly note: string | null;
}

function visibleLength(text: string | null): number {
  return (text ?? '').trim().length;
}

/** Is what this job carries only a preview of its advert? */
export function isPreviewAdvert(job: Pick<Job, 'source' | 'description'>): boolean {
  return PREVIEW_SOURCES.has(job.source) || visibleLength(job.description) < FULL_ADVERT_MIN_CHARS;
}

/**
 * The full advert for this job, reading its page only when it has to.
 *
 * Never rejects and never returns less than the job already had: the fetched
 * text is used only when it is LONGER than what is stored, so a page that
 * turned out to be a teaser of its own cannot replace a better description.
 *
 * The note is attached only when what is kept still looks like a preview. An
 * advert read in full on an earlier visit and stored is not "only a preview"
 * because a second read of the page failed today — saying so would be untrue.
 */
export async function fetchFullAdvert(
  job: Job,
  createTransport: () => PageFetchTransport = createTauriPageTransport,
): Promise<FullAdvert> {
  const stored = job.description ?? '';
  if (!isPreviewAdvert(job)) return { text: stored, note: null };

  const failed = (note: string): FullAdvert => ({
    text: stored,
    note: visibleLength(stored) < FULL_ADVERT_MIN_CHARS ? note : null,
  });

  if (job.url === null || job.url.trim() === '') return failed(PREVIEW_ONLY_NOTE);

  let outcome;
  try {
    outcome = await runFetch(job.url, createTransport);
  } catch {
    // `runFetch` is built never to reject, and the transport returns a
    // `Result`; this is the fallback for an IPC layer that broke anyway. The
    // user still gets the preview and a sentence that tells them what to do.
    return failed(PREVIEW_ONLY_NOTE);
  }

  if (!outcome.available) {
    return failed(
      outcome.reason === FETCH_SITE_REFUSES_NOTE ? PREVIEW_SITE_BLOCKS_NOTE : PREVIEW_ONLY_NOTE,
    );
  }

  // Capped at the same length every board's description is capped at, so an
  // advert read from its page is stored no larger than one read from a search.
  const text = outcome.text.slice(0, DESCRIPTION_MAX_CHARS);
  if (visibleLength(text) <= visibleLength(stored)) return failed(PREVIEW_ONLY_NOTE);

  return { text, note: null };
}
