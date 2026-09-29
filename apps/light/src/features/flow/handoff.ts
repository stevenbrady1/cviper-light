/**
 * One job, carried from screen to screen: Find Job → Analyse → Tailor CV
 * (L-190).
 *
 * ============================================================================
 * WHY THE SHELL CARRIES IT, AND NOT THE SCREENS
 * ============================================================================
 * The shell mounts one view at a time, so a screen cannot hand anything to the
 * next one directly — by the time the next one exists, the first is gone. The
 * shell owns which view is showing, so it owns the move: a screen says "this
 * job, analyse it" and the shell loads the analysis session and switches view.
 *
 * ============================================================================
 * MEMORY ONLY — NEVER `localStorage`
 * ============================================================================
 * The same rule as `analysis/session.ts`, for the same reason: a CV and the
 * advert beside it are personal data, and none of this is written anywhere
 * but the database the user already has. "Delete everything" clears what is in
 * flight as well, so the screens cannot outlive the data.
 */
import { type Job } from '@cviper/core-types';

import { jobAdvertText } from '../analysis/model';
import { type AnalysisSession } from '../analysis/session';

/** A job on its way to the Analysis screen. */
export interface AnalyseHandoff {
  /** The STORED job — its id is the one the tracker has — with the best advert text. */
  readonly job: Job;
  /** The application chasing it, when there is one. */
  readonly applicationId: string | null;
  /** What to tell the user about the advert (a preview, say), or `null`. */
  readonly note: string | null;
}

/**
 * A job, a CV and an option on their way to the Tailor screen.
 *
 * Every field is a suggestion the Tailor screen checks against what it has
 * loaded: a CV deleted since, a job that is not on the board, or an option
 * this screen does not offer (the basic match cannot write a paragraph) all
 * fall back to the screen's own defaults rather than to a broken selection.
 */
export interface TailorHandoff {
  readonly jobId: string | null;
  readonly jobText: string;
  readonly cvId: string | null;
  readonly optionKey: string | null;
}

/**
 * Load a job into the analysis session, ready to check.
 *
 * The CV and the chosen option are KEPT — the user picked them, and a job
 * arriving is not a reason to forget that. The CV's partial-read warnings are
 * kept for the same reason: they are about the CV, which has not changed.
 * Everything that described the PREVIOUS advert — its result, the advert it
 * was scored against, a failure — goes, and a run still in flight for it is
 * superseded so its late answer is not shown under this job.
 */
export function loadJobIntoAnalysis(session: AnalysisSession, handoff: AnalyseHandoff): void {
  session.supersede();
  session.update({
    jobText: jobAdvertText(handoff.job),
    jobId: handoff.job.id,
    jobNote: handoff.note,
    result: null,
    checkedAdvert: null,
    runError: null,
  });
}
