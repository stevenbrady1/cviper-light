import { QUIET_BUTTON } from '../../app/buttons';

import { STEPS, continueStep, stepStates, type JobProgress, type StepId } from './steps';

/**
 * A tracker card's small step bar (L-200): ●●●○○ and Continue.
 *
 * Sits UNDER the card, not inside it: the card is one big button (select it,
 * drag it), and a button inside a button is not a thing a browser or a screen
 * reader can make sense of. Only shown for a job that has been started — a
 * card fresh from Search already has "Analyse this job" one click away.
 *
 * Continue goes to the first thing still to do (`continueStep`). Like every
 * step control, it only moves the user; it never runs a check or a model.
 */
export interface CardProgressProps {
  readonly applicationId: string;
  readonly progress: JobProgress;
  readonly onContinue: (step: StepId) => void;
}

export function CardProgress({ applicationId, progress, onContinue }: CardProgressProps) {
  const next = continueStep(progress);
  const states = stepStates(next, progress);
  // Filled when done. Export is also where Continue points once everything is
  // done, which makes it "current" — it is still done.
  const filled = states.map(
    (step) => step.state === 'done' || (step.id === 'export' && progress.exported),
  );
  const done = filled.filter(Boolean).length;
  const label = STEPS.find((step) => step.id === next)?.label ?? next;

  return (
    <div
      data-testid={`tracker-card-progress-${applicationId}`}
      data-done={done}
      className="mt-1 flex items-center justify-between gap-2 px-3"
    >
      <span aria-hidden="true" className="font-mono text-[11px] tracking-[0.2em] text-ink-muted">
        {filled.map((on) => (on ? '●' : '○')).join('')}
      </span>
      <span className="sr-only">
        {done} of {STEPS.length} steps done. Next: {label}.
      </span>
      <button
        type="button"
        data-testid={`tracker-card-continue-${applicationId}`}
        aria-label={`Continue: ${label}`}
        onClick={() => onContinue(next)}
        className={`${QUIET_BUTTON} text-xs`}
      >
        Continue
      </button>
    </div>
  );
}
