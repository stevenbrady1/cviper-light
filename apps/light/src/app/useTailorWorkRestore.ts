import { useEffect, type Dispatch, type SetStateAction } from 'react';

import { type JobSessions } from '../features/tailor/jobSessions';
import {
  createTauriWorkflowPort,
  hydrateJobSessions,
  startWriteThrough,
  type WorkflowPort,
} from '../features/tailor/persistence';
import { createDbTailorPort, type TailorPort } from '../features/tailor/port';

import { type ViewId } from './views';

export interface TailorWorkRestoreInput {
  readonly activeView: ViewId;
  /** The Tailor screen's work, one session per job. `App` holds it. */
  readonly jobSessions: JobSessions;
  /** `AppProps.tailorPort`. When it was injected, the real database is not reached past it. */
  readonly tailorPort: TailorPort | undefined;
  /** `AppProps.workflowPort`. */
  readonly workflowPort: WorkflowPort | null | undefined;
  /** `App` holds the offer: its banner and "Delete everything" read it too. */
  readonly setResumeOffer: Dispatch<
    SetStateAction<{
      readonly title: string;
      readonly company: string;
    } | null>
  >;
  /** `App` holds the problem, for the same reason. */
  readonly setKeepProblem: Dispatch<SetStateAction<string | null>>;
}

/**
 * Tailor's work across a restart (L-199): every job's work put back and then
 * written through, and the job the last run was on offered back once.
 *
 * Moved word for word out of `App` (L-373). Called where its two effects
 * were, so they still run in the same order among the shell's others.
 */
export function useTailorWorkRestore({
  activeView,
  jobSessions,
  tailorPort,
  workflowPort,
  setResumeOffer,
  setKeepProblem,
}: TailorWorkRestoreInput): void {
  // Once the user is on Tailor, the offer has been taken up either way.
  useEffect(() => {
    if (activeView === 'tailor') setResumeOffer(null);
  }, [activeView]);

  // Restore every job's Tailor work, then keep writing it through (L-199).
  useEffect(() => {
    let stopped = false;
    let stopWriting: (() => void) | null = null;

    void (async () => {
      const port =
        workflowPort !== undefined
          ? workflowPort
          : tailorPort === undefined
            ? await createTauriWorkflowPort()
            : null;
      if (port === null || stopped) return;

      const resumed = await hydrateJobSessions(jobSessions, port);
      if (stopped) return;
      stopWriting = startWriteThrough(jobSessions, port, undefined, setKeepProblem);
      if (resumed === null) return;

      // The job's title and company, for the sentence. A failed read still
      // offers the work back, just without naming the job.
      const jobs = await (tailorPort ?? createDbTailorPort()).loadJobs();
      if (stopped) return;
      const job = jobs.ok ? jobs.value.find((candidate) => candidate.id === resumed) : undefined;
      setResumeOffer({ title: job?.title ?? '', company: job?.company ?? '' });
    })();

    return () => {
      stopped = true;
      stopWriting?.();
    };
  }, [jobSessions, tailorPort, workflowPort]);
}
