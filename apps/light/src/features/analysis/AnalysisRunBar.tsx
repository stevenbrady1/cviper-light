import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { LiveStatus } from '../../app/LiveStatus';

export interface AnalysisRunBarProps {
  readonly running: boolean;
  /** Why the check cannot run, or `null` when it can. */
  readonly disabledReason: string | null;
  readonly onRun: () => void;
  readonly historyCount: number;
  readonly historyDisabled: boolean;
  readonly onOpenHistory: () => void;
  /** What a slow run is doing, in words, or `null` (L-299). */
  readonly progressText: string | null;
  readonly elapsed: number;
}

/** Analysis, step 4: the check button, past checks, and what a run is doing. */
export function AnalysisRunBar({
  running,
  disabledReason,
  onRun,
  historyCount,
  historyDisabled,
  onOpenHistory,
  progressText,
  elapsed,
}: AnalysisRunBarProps) {
  return (
    <>
      <div className="flex items-center gap-3">
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

        <button
          type="button"
          data-testid="analysis-history-open"
          disabled={historyDisabled}
          onClick={onOpenHistory}
          className={SECONDARY_BUTTON}
        >
          Past checks <span className="font-mono tabular-nums">({historyCount})</span>
        </button>

        {disabledReason === null ? null : (
          <p id="analysis-run-reason" data-testid="analysis-run-reason" className="text-ink-muted">
            {disabledReason}
          </p>
        )}
      </div>

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
