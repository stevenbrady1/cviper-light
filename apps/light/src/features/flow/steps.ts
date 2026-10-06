/**
 * The five steps of one job (L-200): Find → Analyse → Tailor → ATS Score →
 * Export, and what each one says about where the user is.
 *
 * ============================================================================
 * STEPS ARE NEVER LOCKED
 * ============================================================================
 * The user can go straight to any step. Passing one by does not block it; it
 * is marked SKIPPED (⊘) so the bar says honestly that it was not done, and a
 * step done earlier stays done wherever the user goes afterwards.
 *
 * Nothing here starts a model call. Moving between steps is navigation; the
 * user still presses the button on the step to run it.
 */

export type StepId = 'find' | 'analyse' | 'tailor' | 'ats' | 'export';

export const STEPS: readonly { readonly id: StepId; readonly label: string }[] = [
  { id: 'find', label: 'Find' },
  { id: 'analyse', label: 'Analyse' },
  { id: 'tailor', label: 'Tailor' },
  { id: 'ats', label: 'ATS Score' },
  { id: 'export', label: 'Export' },
];

export type StepState = 'done' | 'current' | 'skipped' | 'todo';

/** What has happened for this job, as far as the app can tell. */
export interface JobProgress {
  /** An analysis has been saved against the job. */
  readonly analysed: boolean;
  /** There is a tailored draft for the job. */
  readonly tailored: boolean;
  /** A tailored CV has been saved to one of the job's applications. */
  readonly exported: boolean;
}

export interface StepView {
  readonly id: StepId;
  readonly label: string;
  readonly state: StepState;
}

function indexOf(step: StepId): number {
  return STEPS.findIndex((candidate) => candidate.id === step);
}

function isDone(step: StepId, current: StepId, progress: JobProgress): boolean {
  switch (step) {
    // There is a job, so it was found.
    case 'find':
      return true;
    case 'analyse':
      return progress.analysed;
    case 'tailor':
      return progress.tailored;
    // The score is worked out the moment there is a draft; the step is done
    // once the user has moved on from it with one, or has exported.
    case 'ats':
      return progress.tailored && (progress.exported || indexOf(current) > indexOf('ats'));
    case 'export':
      return progress.exported;
  }
}

export function stepStates(current: StepId, progress: JobProgress): StepView[] {
  const here = indexOf(current);
  return STEPS.map((step, index) => {
    let state: StepState;
    if (step.id === current) state = 'current';
    else if (isDone(step.id, current, progress)) state = 'done';
    else state = index < here ? 'skipped' : 'todo';
    return { ...step, state };
  });
}

export function previousStep(step: StepId): StepId | null {
  return STEPS[indexOf(step) - 1]?.id ?? null;
}

export function nextStep(step: StepId): StepId | null {
  return STEPS[indexOf(step) + 1]?.id ?? null;
}
