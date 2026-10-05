import { useId } from 'react';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';

import {
  MAX_METRIC_CHARS,
  approve,
  canApprove,
  dismiss,
  reopen,
  setDraft,
  type MetricPrompt,
  type MetricState,
} from './metricPrompts';

export interface MetricPromptBoxesProps {
  readonly prompts: readonly MetricPrompt[];
  readonly state: MetricState;
  readonly onChange: (next: MetricState) => void;
}

/**
 * One gentle question per keyword gap (L-205). The logic - what is approved,
 * what is sent - lives in `metricPrompts.ts`; this only draws it.
 *
 * Typing never sends anything: the text goes into the rewrite only after
 * "Add to rewrite", and "Not now" drops it. The box offers no example number.
 */
export function MetricPromptBoxes({ prompts, state, onChange }: MetricPromptBoxesProps) {
  const baseId = useId();
  if (prompts.length === 0) return null;

  return (
    <div data-testid="tailor-metric-prompts" className="mt-2 space-y-2">
      {prompts.map((prompt, index) => {
        const entry = state[prompt.key];
        const status = entry?.status ?? 'editing';
        const draft = entry?.draft ?? '';
        const inputId = `${baseId}-${index}`;

        return (
          <div
            key={prompt.key}
            data-testid="tailor-metric-prompt"
            data-status={status}
            className="rounded-control border border-line bg-sunken px-3 py-2"
          >
            <p id={`${inputId}-q`} className="text-xs text-ink-muted">
              {prompt.question}
            </p>

            {status === 'dismissed' ? (
              <button
                type="button"
                className={`${QUIET_BUTTON} mt-1`}
                onClick={() => {
                  onChange(reopen(state, prompt.key));
                }}
              >
                Add one anyway
              </button>
            ) : status === 'approved' ? (
              <div className="mt-1 space-y-1">
                <p className="text-ink">{draft}</p>
                <p className="text-xs text-teal">Added to your rewrite.</p>
                <button
                  type="button"
                  className={QUIET_BUTTON}
                  onClick={() => {
                    onChange(reopen(state, prompt.key));
                  }}
                >
                  Change
                </button>
                <button
                  type="button"
                  className={QUIET_BUTTON}
                  onClick={() => {
                    onChange(dismiss(state, prompt.key));
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <>
                <label htmlFor={inputId} className="sr-only">
                  {`Achievement or metric for ${prompt.skill}`}
                </label>
                <textarea
                  id={inputId}
                  rows={2}
                  value={draft}
                  aria-describedby={`${inputId}-q`}
                  onChange={(event) => {
                    onChange(setDraft(state, prompt.key, event.currentTarget.value));
                  }}
                  className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
                />
                <p className="mt-0.5 text-xs text-ink-faint">
                  Only what you type and add is used. Up to {MAX_METRIC_CHARS} characters.
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!canApprove(draft)}
                    className={SECONDARY_BUTTON}
                    onClick={() => {
                      onChange(approve(state, prompt.key));
                    }}
                  >
                    Add to rewrite
                  </button>
                  <button
                    type="button"
                    className={QUIET_BUTTON}
                    onClick={() => {
                      onChange(dismiss(state, prompt.key));
                    }}
                  >
                    Not now
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
