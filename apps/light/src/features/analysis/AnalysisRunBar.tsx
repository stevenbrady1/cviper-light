import { PRIMARY_BUTTON } from '../../app/buttons';
import { LiveStatus } from '../../app/LiveStatus';

export interface AnalysisRunBarProps {
  readonly running: boolean;
  /** Why the check cannot run, or `null` when it can. */
  readonly disabledReason: string | null;
  readonly onRun: () => void;
  /** What a slow run is doing, in words, or `null` (L-299). */
  readonly progressText: string | null;
  readonly elapsed: number;
}

/** The right of the box's bar (L-446): why the check cannot run, then the button. */
export function AnalysisRunBar({
  running,
  disabledReason,
  onRun,
}: Pick<AnalysisRunBarProps, 'running' | 'disabledReason' | 'onRun'>) {
  return (
    <>
      {disabledReason === null ? null : (
        <p id="analysis-run-reason" data-testid="analysis-run-reason" className="text-ink-muted">
          {disabledReason}
        </p>
      )}

      {/*
        The view's ONE blue button. Disabled, never hidden — and the
        reason is right next to it, because a grey button that says
        nothing is where a user's session ends.
      */}
      <button
        type="button"
        data-testid="analysis-run"
        data-primary="true"
        disabled={disabledReason !== null}
        aria-describedby={disabledReason === null ? undefined : 'analysis-run-reason'}
        onClick={onRun}
        className={PRIMARY_BUTTON}
      >
        {running ? 'Checking…' : 'Check this CV'}
      </button>
    </>
  );
}

/** First under the box: what a run is doing, while it runs, with its seconds. */
export function AnalysisRunStatus({
  progressText,
  elapsed,
}: Pick<AnalysisRunBarProps, 'progressText' | 'elapsed'>) {
  return (
    <>
      <LiveStatus text={progressText} />
      {progressText === null ? null : (
        <p
          data-testid="analysis-progress"
          className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
        >
          {progressText}{' '}
          <span aria-hidden="true" className="font-mono tabular-nums">
            {elapsed}s
          </span>
        </p>
      )}
    </>
  );
}
