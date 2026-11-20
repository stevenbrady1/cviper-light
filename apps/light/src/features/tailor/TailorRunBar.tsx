import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { LiveStatus } from '../../app/LiveStatus';

import { type Phase } from './jobSessions';
import { NO_AI_REASON } from './model';

export interface TailorRunBarProps {
  readonly phase: Phase;
  /** Why the run button is off, or `null` when it can be pressed. */
  readonly disabledReason: string | null;
  readonly onRun: () => void;
  /** Left undefined, no Settings button is drawn (L-175). */
  readonly onOpenSettings?: (() => void) | undefined;
  /** The progress sentence while a run is going, else `null`. */
  readonly progressSentence: string | null;
  readonly elapsed: number;
  readonly choosingFile: boolean;
  readonly saveMessage: string | null;
  /** This job has a draft: the button is grey and reads "Tailor again" (L-400). */
  readonly hasDraft: boolean;
}

/**
 * The right of the advert box's bar (L-445): why the button is off, then the
 * button. Disabled, never hidden.
 */
export function TailorRunButton({
  phase,
  disabledReason,
  onRun,
  hasDraft,
}: Pick<TailorRunBarProps, 'phase' | 'disabledReason' | 'onRun' | 'hasDraft'>) {
  return (
    <>
      {disabledReason === null ? null : (
        // `max-w-md`: a long reason wraps beside the button, not on a line of its own above it.
        <p
          id="tailor-run-reason"
          data-testid="tailor-run-reason"
          className="max-w-md text-ink-muted"
        >
          {disabledReason}
        </p>
      )}
      {/* Once there is a draft, Save as PDF is the one blue button (L-400). */}
      <button
        type="button"
        data-testid="tailor-run"
        data-primary={hasDraft ? undefined : 'true'}
        disabled={disabledReason !== null}
        aria-describedby={disabledReason === null ? undefined : 'tailor-run-reason'}
        onClick={onRun}
        className={hasDraft ? SECONDARY_BUTTON : PRIMARY_BUTTON}
      >
        {phase === 'tailoring' ? 'Tailoring…' : hasDraft ? 'Tailor again' : 'Tailor CV'}
      </button>
    </>
  );
}

/**
 * Under the advert box: what is happening now — the run in progress, the save
 * window, the last save — and what to do when there is no AI.
 */
export function TailorRunStatus({
  disabledReason,
  onOpenSettings,
  progressSentence,
  elapsed,
  choosingFile,
  saveMessage,
}: Omit<TailorRunBarProps, 'phase' | 'onRun' | 'hasDraft'>) {
  return (
    <>
      <LiveStatus text={progressSentence} />
      {progressSentence === null ? null : (
        <p
          data-testid="tailor-progress"
          className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
        >
          {progressSentence}{' '}
          <span aria-hidden="true" className="font-mono tabular-nums">
            {elapsed}s
          </span>
        </p>
      )}

      <LiveStatus text={choosingFile ? 'Choose where to save it in the save window.' : null} />
      {choosingFile ? (
        <p
          data-testid="tailor-save-choosing"
          className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
        >
          Choose where to save it in the save window.
        </p>
      ) : null}

      <LiveStatus text={saveMessage} />
      {saveMessage === null ? null : (
        <p
          data-testid="tailor-save-message"
          className="rounded-control bg-teal/10 px-3 py-2 break-all text-teal-ink"
        >
          {saveMessage}
        </p>
      )}

      {/*
        Not a dead end (L-175, L-240). Tailoring writes new text, so it
        needs an AI and there is no keyword fallback to offer. What there
        is: two ways forward, in plain words, and a note that the CV can go
        in now. No provider is named (L-148).
      */}
      {disabledReason === NO_AI_REASON ? (
        <div
          data-testid="tailor-no-ai"
          className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
        >
          <p>You can still upload your CV now, so it is ready. Then choose one of these:</p>
          <ul className="mt-2 space-y-3">
            <li className="flex flex-wrap items-center gap-2">
              {onOpenSettings === undefined ? (
                <span className="font-medium text-ink">Add an AI key in Settings.</span>
              ) : (
                <button
                  type="button"
                  data-testid="tailor-open-settings"
                  onClick={onOpenSettings}
                  className={SECONDARY_BUTTON}
                >
                  Add an AI key
                </button>
              )}
              <span>You get the key from the AI company you choose.</span>
            </li>
            <li data-testid="tailor-free-local">
              <span className="font-medium text-ink">Use a free AI on your own PC.</span> A model
              running on this PC keeps your CV on this computer. If one is already running, come
              back to this screen and CViper will find it. You can also add one in Settings.
            </li>
          </ul>
        </div>
      ) : null}
    </>
  );
}
