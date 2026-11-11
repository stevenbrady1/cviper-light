import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

import { type Job } from '@cviper/core-types';

import { jobAdvertText } from '../features/analysis/model';
import { type AnalysisSession } from '../features/analysis/session';
import {
  loadJobIntoAnalysis,
  type AnalyseHandoff,
  gapsFromSession,
  type TailorHandoff,
} from '../features/flow/handoff';
import { type StepId } from '../features/flow/steps';
import { type JobSessions } from '../features/tailor/jobSessions';
import { type TailorStep } from '../features/tailor/Tailor';
import { type TrackerEntry } from '../features/tracker/model';

import { type ViewId } from './views';

export interface JobFlowInput {
  /** The last analysis. `App` holds it: "Delete everything" resets it. */
  readonly analysisSession: AnalysisSession;
  /** The Tailor screen's work, one session per job. `App` holds it, for the same reason. */
  readonly jobSessions: JobSessions;
  readonly setActiveView: Dispatch<SetStateAction<ViewId>>;
  /** `App` holds the hand-off: Tailor reads it, and "Delete everything" clears it. */
  readonly setTailorHandoff: Dispatch<SetStateAction<TailorHandoff | null>>;
}

export interface JobFlow {
  readonly tailorEntryStep: TailorStep;
  readonly setTailorEntryStep: Dispatch<SetStateAction<TailorStep>>;
  readonly onSelect: (id: ViewId) => void;
  readonly onAnalyseJob: (handoff: AnalyseHandoff) => void;
  readonly onTailorJob: (handoff: TailorHandoff) => void;
  readonly onTailorHandoffHandled: () => void;
  readonly onJobStep: (step: StepId, job: Job, handoff?: TailorHandoff) => void;
  readonly onTracker: () => void;
  readonly jobChoice: (
    jobId: string,
  ) => { readonly cvId: string | null; readonly optionKey: string | null } | null;
  readonly onJobChoice: (
    job: Job,
    choice: { readonly cvId?: string | null; readonly optionKey?: string | null },
  ) => void;
  readonly tailoredJob: (jobId: string) => boolean;
  readonly onTrackerAnalyse: (entry: TrackerEntry) => void;
  readonly onTrackerTailor: (entry: TrackerEntry) => void;
}

/**
 * Carrying a job between screens (L-190, L-200): the side menu, Find Job →
 * Analyse → Tailor CV, the step bars, "pick once" and the tracker's buttons.
 * Only moves the user and hands things on; it runs no check and no model.
 *
 * Moved word for word out of `App` (L-373).
 */
export function useJobFlow({
  analysisSession,
  jobSessions,
  setActiveView,
  setTailorHandoff,
}: JobFlowInput): JobFlow {
  /**
   * Which of Tailor's own steps it opens on (L-200). Set by a step bar on
   * another screen; the sidebar and every other route open it on Tailor.
   */
  const [tailorEntryStep, setTailorEntryStep] = useState<TailorStep>('tailor');

  const onSelect = useCallback((id: ViewId) => {
    setTailorEntryStep('tailor');
    setActiveView(id);
  }, []);

  // ── Find Job → Analyse → Tailor CV (L-190) ──────────────────────────────

  /** A job from Search or the tracker, loaded into Analysis — and shown. */
  const onAnalyseJob = useCallback(
    (handoff: AnalyseHandoff) => {
      loadJobIntoAnalysis(analysisSession, handoff);
      setActiveView('analysis');
    },
    [analysisSession],
  );

  /** A job, CV and option from Analysis or the tracker, handed to Tailor. */
  const onTailorJob = useCallback((handoff: TailorHandoff) => {
    setTailorHandoff(handoff);
    setActiveView('tailor');
  }, []);

  const onTailorHandoffHandled = useCallback(() => setTailorHandoff(null), []);

  /**
   * A step on a job's step bar that lives on another screen (L-200). Only
   * MOVES the user — nothing here runs a check or a model.
   *
   * Going to Tailor reopens the job's own work when it has some; only a job
   * with none takes the hand-off ("Tailor my CV for this job"), which would
   * otherwise start its draft again (L-205).
   */
  const onJobStep = useCallback(
    (step: StepId, job: Job, handoff?: TailorHandoff) => {
      if (step === 'find') {
        setActiveView('search');
        return;
      }
      if (step === 'analyse') {
        // The same job stays as it is — its result included.
        if (analysisSession.get().jobId !== job.id) {
          loadJobIntoAnalysis(analysisSession, { job, applicationId: null, note: null });
        }
        setActiveView('analysis');
        return;
      }
      if (jobSessions.has(job.id) || handoff === undefined) {
        jobSessions.open(job.id, () => ({ advert: jobAdvertText(job) }));
        setActiveView('tailor');
      } else {
        onTailorJob(handoff);
      }
      setTailorEntryStep(step);
    },
    [analysisSession, jobSessions, onTailorJob],
  );

  const onTracker = useCallback(() => setActiveView('tracker'), []);

  // "Pick once" (L-200): a job's CV and engine live in its Tailor session, so
  // a choice made on either screen is the one the other opens with.
  const jobChoice = useCallback(
    (jobId: string) => {
      if (!jobSessions.has(jobId)) return null;
      const { cvId, optionKey } = jobSessions.session(jobId);
      return { cvId, optionKey };
    },
    [jobSessions],
  );
  const onJobChoice = useCallback(
    (job: Job, choice: { readonly cvId?: string | null; readonly optionKey?: string | null }) => {
      jobSessions.ensure(job.id, () => ({ advert: jobAdvertText(job) }));
      // As on Tailor: a draft written from another CV is not this CV's draft.
      jobSessions.patch(job.id, (current) =>
        choice.cvId !== undefined && current.cvId !== choice.cvId
          ? { ...choice, result: null, review: null, letter: null, error: null }
          : choice,
      );
    },
    [jobSessions],
  );
  const tailoredJob = useCallback(
    (jobId: string) => jobSessions.session(jobId).result !== null,
    [jobSessions],
  );

  // The tracker's two buttons. Its job holds the advert as saved, so nothing
  // is fetched and there is no note: the pane has its own "Open the advert"
  // for a thin one. Tailor gets the CV and option last used on Analysis —
  // the user's choice, if they have made one; Tailor falls back if not.
  const onTrackerAnalyse = useCallback(
    (entry: TrackerEntry) =>
      onAnalyseJob({ job: entry.job, applicationId: entry.application.id, note: null }),
    [onAnalyseJob],
  );

  const onTrackerTailor = useCallback(
    (entry: TrackerEntry) => {
      const state = analysisSession.get();
      onTailorJob({
        jobId: entry.job.id,
        jobText: jobAdvertText(entry.job),
        cvId: state.selectedCvId,
        optionKey: state.optionKey,
        // Only used by Tailor if the last analysis was of this job's advert
        // and this CV (L-202) — `gapsForTailor` checks both.
        keywordGaps: gapsFromSession(state),
      });
    },
    [analysisSession, onTailorJob],
  );

  return {
    tailorEntryStep,
    setTailorEntryStep,
    onSelect,
    onAnalyseJob,
    onTailorJob,
    onTailorHandoffHandled,
    onJobStep,
    onTracker,
    jobChoice,
    onJobChoice,
    tailoredJob,
    onTrackerAnalyse,
    onTrackerTailor,
  };
}
