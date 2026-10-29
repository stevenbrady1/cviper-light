import { useId } from 'react';

import { QUIET_BUTTON } from '../../app/buttons';
import { Hint } from '../../app/Hint';
import { FLOW_HINT } from '../../app/hints';

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
 *
 * The dots alone never said WHICH step (L-331), so a line above them says it
 * in words — "Step 3 of 5 · Tailor" — with the step bar's own names (`STEPS`).
 * The step is the one Continue goes to; a job with everything done is on
 * "Step 5 of 5 · Export", where Continue opens it. That line is also the
 * row's accessible name, so the words heard and the words read are one.
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
  const position = STEPS.findIndex((step) => step.id === next) + 1;
  const lineId = useId();

  return (
    <div
      data-testid={`tracker-card-progress-${applicationId}`}
      data-done={done}
      role="group"
      aria-labelledby={lineId}
      className="mt-1 px-3"
    >
      <p
        id={lineId}
        data-testid={`tracker-card-step-${applicationId}`}
        className="text-[11px] text-ink-muted"
      >
        Step {position} of {STEPS.length} · {label}
      </p>
      <div className="flex items-center justify-between gap-2">
        <Hint text={FLOW_HINT.cardDots} focusable={false}>
          <span
            aria-hidden="true"
            className="font-mono text-[11px] tracking-[0.2em] text-ink-muted"
          >
            {filled.map((on) => (on ? '●' : '○')).join('')}
          </span>
        </Hint>
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
    </div>
  );
}
