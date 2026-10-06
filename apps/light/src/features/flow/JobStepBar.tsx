import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';

import {
  nextStep,
  previousStep,
  stepStates,
  STEPS,
  type JobProgress,
  type StepId,
  type StepState,
} from './steps';

/**
 * Where this job is: Find → Analyse → Tailor → ATS Score → Export (L-200).
 *
 *   ◀ Tracker   Senior Data Analyst · Acme Ltd · Leeds
 *   ✓ Find ─ ✓ Analyse ─ ● Tailor ─ ○ ATS Score ─ ○ Export
 *   [Back]  [Next: ATS Score]
 *
 * An ORDERED LIST with `aria-current="step"`, so a screen reader says "list,
 * 5 items" and reads the current one as the current step. Every step is a
 * button — steps are never locked — and so are Back and Next. None of them
 * starts a model call: they move the user, and the user presses the button
 * on the step to run it.
 *
 * No blue here. Each view keeps its one primary action; this bar is
 * navigation, so it uses the quiet and secondary buttons only.
 */
export interface JobStepBarProps {
  readonly title: string;
  readonly company: string;
  readonly location: string | null;
  readonly current: StepId;
  readonly progress: JobProgress;
  readonly onStep: (step: StepId) => void;
  /** Back to the tracker, where the job lives. Left out, no link is drawn. */
  readonly onTracker?: (() => void) | undefined;
}

const SYMBOL: Readonly<Record<StepState, string>> = {
  done: '✓',
  current: '●',
  skipped: '⊘',
  todo: '○',
};

/** What a screen reader says after the step's name. */
const SPOKEN: Readonly<Record<StepState, string>> = {
  done: 'done',
  current: 'you are here',
  skipped: 'skipped',
  todo: 'not started',
};

function labelOf(step: StepId): string {
  return STEPS.find((candidate) => candidate.id === step)?.label ?? step;
}

export function JobStepBar({
  title,
  company,
  location,
  current,
  progress,
  onStep,
  onTracker,
}: JobStepBarProps) {
  const steps = stepStates(current, progress);
  const back = previousStep(current);
  const next = nextStep(current);
  const job = [title, company, location ?? '']
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' · ');

  return (
    <section
      data-testid="job-steps"
      aria-label="This job’s steps"
      className="border-b border-line bg-card px-4 py-2 md:px-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        {onTracker === undefined ? null : (
          <button
            type="button"
            data-testid="job-steps-tracker"
            onClick={onTracker}
            className={QUIET_BUTTON}
          >
            <span aria-hidden="true">◀</span> Tracker
          </button>
        )}
        <p data-testid="job-steps-job" className="min-w-0 flex-1 font-medium text-ink">
          {job}
        </p>
      </div>

      <nav aria-label="Steps for this job">
        <ol className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1">
          {steps.map((step, index) => (
            <li key={step.id} className="flex items-center gap-1">
              {index === 0 ? null : (
                // Hidden on a phone: the steps wrap there, and a divider
                // would start the second line.
                <span aria-hidden="true" className="hidden text-ink-faint md:inline">
                  ─
                </span>
              )}
              <button
                type="button"
                data-testid={`job-step-${step.id}`}
                data-state={step.state}
                aria-current={step.state === 'current' ? 'step' : undefined}
                onClick={() => onStep(step.id)}
                className={QUIET_BUTTON}
              >
                <span aria-hidden="true">{SYMBOL[step.state]}</span>
                <span className={step.state === 'current' ? 'font-semibold text-ink' : ''}>
                  {step.label}
                </span>
                <span className="sr-only">, {SPOKEN[step.state]}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="job-steps-back"
          disabled={back === null}
          onClick={() => {
            if (back !== null) onStep(back);
          }}
          className={SECONDARY_BUTTON}
        >
          Back
        </button>
        <button
          type="button"
          data-testid="job-steps-next"
          disabled={next === null}
          onClick={() => {
            if (next !== null) onStep(next);
          }}
          className={SECONDARY_BUTTON}
        >
          {next === null ? 'Next' : `Next: ${labelOf(next)}`}
        </button>
      </div>
    </section>
  );
}
