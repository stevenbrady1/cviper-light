import { useCallback, useEffect, useRef, useState } from 'react';

import { type Cv, type Job } from '@cviper/core-types';

import { gapsFromAnalysis, type TailorHandoff } from '../flow/handoff';
import { NO_SAVED_PROGRESS, type JobProgressPort, type SavedProgress } from '../flow/progress';
import { type StepId } from '../flow/steps';

import { type AnalysisSession, type AnalysisSessionState } from './session';

export interface AnalysisStepBarInput {
  readonly session: AnalysisSession;
  readonly progress: JobProgressPort;
  readonly jobs: readonly Job[];
  readonly cvs: readonly Cv[];
  readonly cvsLoaded: boolean;
  readonly jobId: string | null;
  readonly jobText: string;
  readonly selectedCvId: string | null;
  readonly optionKey: string;
  readonly result: AnalysisSessionState['result'];
  readonly checkedAdvert: string | null;
  readonly jobChoice:
    | ((
        jobId: string,
      ) => { readonly cvId: string | null; readonly optionKey: string | null } | null)
    | undefined;
  readonly onJobStep: ((step: StepId, job: Job, handoff: TailorHandoff) => void) | undefined;
}

/**
 * The step bar's half of the Analysis screen (L-200): which tracked job this
 * is, its saved progress, its own CV and engine coming back, and the hand-over
 * to Tailor.
 */
export function useAnalysisStepBar({
  session,
  progress,
  jobs,
  cvs,
  cvsLoaded,
  jobId,
  jobText,
  selectedCvId,
  optionKey,
  result,
  checkedAdvert,
  jobChoice,
  onJobStep,
}: AnalysisStepBarInput) {
  /** The tracked job the advert belongs to, if it is on the board. */
  const stepJob =
    jobId === null ? null : (jobs.find((candidate) => candidate.id === jobId) ?? null);
  const [saved, setSaved] = useState<SavedProgress>(NO_SAVED_PROGRESS);
  useEffect(() => {
    setSaved(NO_SAVED_PROGRESS);
    if (jobId === null) return;
    let cancelled = false;
    void progress.load(jobId).then((loaded) => {
      if (!cancelled) setSaved(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [jobId, progress]);

  /**
   * A job arriving brings back its own CV and engine (L-200, "pick once"),
   * once, after the CVs are read so a deleted CV is never selected. A job
   * with no choice yet keeps whatever is picked now.
   */
  const choiceAppliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (jobId === null) {
      choiceAppliedFor.current = null;
      return;
    }
    if (!cvsLoaded || choiceAppliedFor.current === jobId) return;
    choiceAppliedFor.current = jobId;
    const choice = jobChoice?.(jobId) ?? null;
    if (choice === null) return;
    const current = session.get();
    const cvId =
      choice.cvId !== null && cvs.some((cv) => cv.id === choice.cvId) ? choice.cvId : null;
    if (cvId !== null && cvId !== current.selectedCvId) {
      // Another CV: a result on screen was for the one being left.
      session.supersede();
      session.update({ selectedCvId: cvId, result: null, runError: null, warnings: [] });
    }
    if (choice.optionKey !== null && choice.optionKey !== current.optionKey) {
      session.update({ optionKey: choice.optionKey });
    }
  }, [cvs, cvsLoaded, jobChoice, jobId, session]);

  /** What "Tailor my CV for this job" hands over — the same, whichever button. */
  const tailorHandoff = useCallback(
    (): TailorHandoff => ({
      jobId,
      jobText,
      cvId: selectedCvId,
      optionKey,
      // The gaps this result found, for the advert it CHECKED (L-202). Never
      // `missing_skills`: see `gapsFromAnalysis`.
      keywordGaps:
        result === null ? null : gapsFromAnalysis(result.analysis, selectedCvId, checkedAdvert),
    }),
    [checkedAdvert, jobId, jobText, optionKey, result, selectedCvId],
  );

  const onBarStep = useCallback(
    (step: StepId) => {
      if (step === 'analyse' || stepJob === null) return;
      onJobStep?.(step, stepJob, tailorHandoff());
    },
    [onJobStep, stepJob, tailorHandoff],
  );

  return { stepJob, saved, tailorHandoff, onBarStep };
}
