import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { Hint } from '../../app/Hint';
import { FLOW_HINT, STEP_HINT } from '../../app/hints';
import { StateMark, type StateMarkName } from '../../ui';

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
 *   ◀ Tracker   Senior Data Analyst · Acme Ltd · Leeds     [Back] [Next: ATS Score]
 *               CV: cv.docx · Engine: Keyword match
 *   ✓ Find —— ✓ Analyse —— ● Tailor —— ○ ATS Score —— ○ Export
 *
 * Two rows on a desktop (L-386): the job, with Back and Next at its right, and
 * the steps joined by DRAWN lines. A long job name is cut short on its line
 * rather than pushing Back and Next off it.
 *
 * On a phone the steps show their marks only — one row of five 44px buttons,
 * each still NAMED for a screen reader — and one line of words under them
 * says "Step 4 of 5 · ATS Score. Skipped: Analyse.". The marks must never go
 * without that line: on touch a tap on a step navigates, so its hint cannot be
 * reached, and the words are what explain the marks.
 *
 * An ORDERED LIST with `aria-current="step"`, so a screen reader says "list,
 * 5 items" and reads the current one as the current step. Every step is a
 * button — steps are never locked — and so are Back and Next. None of them
 * starts a model call: they move the user, and the user presses the button
 * on the step to run it.
 *
 * No blue here. Each view keeps its one primary action; this bar is
 * navigation, so it uses the quiet and secondary buttons only.
 *
 * The marks are drawn (`StateMark`, L-360), not typed, so they look the same
 * on every machine, and each state is its own shape: done a tick, current a
 * filled dot, skipped a struck-through ring, to do an empty ring. A mark is
 * hidden from a screen reader; the words after the step's name say its state.
 */
export interface JobStepBarProps {
  readonly title: string;
  readonly company: string;
  readonly location: string | null;
  readonly current: StepId;
  readonly progress: JobProgress;
  readonly onStep: (step: StepId) => void;
  /**
   * The CV and engine chosen for this job (L-200), picked once and used by
   * every step. Left out, the line is not drawn.
   */
  readonly choice?: { readonly cv: string | null; readonly engine: string | null } | undefined;
  /** Back to the tracker, where the job lives. Left out, no link is drawn. */
  readonly onTracker?: (() => void) | undefined;
}

const MARK: Readonly<Record<StepState, StateMarkName>> = {
  done: 'tick',
  current: 'dot',
  skipped: 'skipped',
  todo: 'ring',
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
  choice,
  onTracker,
}: JobStepBarProps) {
  const steps = stepStates(current, progress);
  const back = previousStep(current);
  const next = nextStep(current);
  const job = [title, company, location ?? '']
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' · ');
  const skipped = steps.filter((step) => step.state === 'skipped').map((step) => step.label);
  const where =
    `Step ${String(steps.findIndex((step) => step.id === current) + 1)} of ${String(steps.length)}` +
    ` · ${labelOf(current)}.` +
    (skipped.length === 0 ? '' : ` Skipped: ${skipped.join(', ')}.`);

  return (
    <section
      data-testid="job-steps"
      aria-label="This job’s steps"
      className="border-b border-line bg-card px-4 py-2 md:px-6"
    >
      {/* A phone wraps Back and Next onto a line of their own. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 md:flex-nowrap">
        {onTracker === undefined ? null : (
          <Hint text={FLOW_HINT.tracker}>
            {(trigger) => (
              <button
                type="button"
                data-testid="job-steps-tracker"
                onClick={onTracker}
                className={QUIET_BUTTON}
                {...trigger}
              >
                <StateMark name="back" /> Tracker
              </button>
            )}
          </Hint>
        )}
        <div className="min-w-0 flex-1">
          <p data-testid="job-steps-job" className="truncate font-medium text-ink">
            {job}
          </p>
          {choice === undefined ? null : (
            <p data-testid="job-steps-choice" className="break-words text-xs text-ink-muted">
              <Hint text={FLOW_HINT.choice}>
                CV: <span className="text-ink">{choice.cv ?? 'none chosen'}</span>
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, </span>
                Engine: <span className="text-ink">{choice.engine ?? 'none set up'}</span>
              </Hint>
            </p>
          )}
        </div>
        <div className="flex basis-full items-center gap-2 md:basis-auto md:shrink-0">
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
      </div>

      <nav aria-label="Steps for this job" className="mt-1">
        <ol className="flex items-center gap-1 md:flex-wrap">
          {steps.map((step, index) => (
            <li key={step.id} className="flex items-center gap-1">
              {index === 0 ? null : (
                <span
                  data-testid="job-steps-line"
                  aria-hidden="true"
                  className="h-px w-3 bg-ink-faint md:w-4"
                />
              )}
              <Hint text={STEP_HINT[step.state]}>
                {(trigger) => (
                  <button
                    type="button"
                    data-testid={`job-step-${step.id}`}
                    data-state={step.state}
                    aria-current={step.state === 'current' ? 'step' : undefined}
                    onClick={() => onStep(step.id)}
                    className={`${QUIET_BUTTON} min-w-11 md:min-w-0`}
                    {...trigger}
                  >
                    <StateMark name={MARK[step.state]} />
                    {/* A phone shows the mark only; the name stays for a screen reader. */}
                    <span
                      className={`sr-only md:not-sr-only ${step.state === 'current' ? 'font-semibold text-ink' : ''}`}
                    >
                      {step.label}
                    </span>
                    <span className="sr-only">, {SPOKEN[step.state]}</span>
                  </button>
                )}
              </Hint>
            </li>
          ))}
        </ol>
        <p data-testid="job-steps-where" className="mt-1 text-xs text-ink-muted md:hidden">
          {where}
        </p>
      </nav>
    </section>
  );
}
