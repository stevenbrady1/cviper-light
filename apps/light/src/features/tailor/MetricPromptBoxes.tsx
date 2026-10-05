import { useEffect, useId, useRef, useState } from 'react';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';

import {
  MAX_METRIC_CHARS,
  approve,
  approvedMetrics,
  canApprove,
  cleanedOnApproval,
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
  /** True while a model call is running: nothing can change under it. */
  readonly disabled?: boolean | undefined;
}

/**
 * One gentle question per keyword gap (L-205), inside one closed `<details>`
 * so fifteen gaps never push the run controls off the screen. The logic -
 * what is approved, what is sent - lives in `metricPrompts.ts`; this only
 * draws it.
 *
 * Typing never sends anything: the text goes into the rewrite only after
 * "Add to rewrite", and "Not now" drops it. The box offers no example number.
 */
export function MetricPromptBoxes({
  prompts,
  state,
  onChange,
  disabled = false,
}: MetricPromptBoxesProps) {
  const [announcement, setAnnouncement] = useState({ text: '', count: 0 });
  if (prompts.length === 0) return null;

  const added = approvedMetrics(state, prompts).length;

  return (
    <div data-testid="tailor-metric-prompts" className="mt-2">
      <details className="rounded-card border border-line bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          {`Add a number or result for your gaps (optional, ${added} of ${prompts.length} added)`}
        </summary>
        <p className="mt-2 text-sm text-ink-muted">
          Optional: if you have a real number or result for any of these, add it. Skip the rest.
        </p>
        <ul className="mt-2 space-y-2">
          {prompts.map((prompt) => (
            <li key={prompt.key}>
              <MetricBox
                prompt={prompt}
                state={state}
                disabled={disabled}
                onChange={onChange}
                announce={(text) => {
                  setAnnouncement((previous) => ({ text, count: previous.count + 1 }));
                }}
              />
            </li>
          ))}
        </ul>
      </details>
      {/* Outside the <details>, so it is still in the page when that is closed. */}
      <p role="status" className="sr-only">
        {/* A new node each time, so the same message twice is announced twice. */}
        <span key={announcement.count}>{announcement.text}</span>
      </p>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5l3.2 3.2L13 4.8" />
    </svg>
  );
}

interface MetricBoxProps {
  readonly prompt: MetricPrompt;
  readonly state: MetricState;
  readonly disabled: boolean;
  readonly onChange: (next: MetricState) => void;
  readonly announce: (message: string) => void;
}

function MetricBox({ prompt, state, disabled, onChange, announce }: MetricBoxProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const inputId = `${id}-input`;
  const counterId = `${id}-counter`;
  const hintId = `${id}-hint`;

  const entry = state.get(prompt.key);
  const status = entry?.status ?? 'idle';
  const draft = entry?.draft ?? '';
  const approvable = canApprove(draft) && !disabled;

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const previous = useRef(status);

  // Focus follows the control the user just used, which is replaced on screen:
  // approve -> "Change"; change or add -> the input; skip or remove -> "Add a metric".
  useEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    if (status === 'editing') inputRef.current?.focus();
    else if (status === 'approved') changeRef.current?.focus();
    else if (status === 'dismissed') addRef.current?.focus();
  }, [status]);

  const open = () => {
    onChange(entry === undefined ? setDraft(state, prompt.key, '') : reopen(state, prompt.key));
  };

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      data-testid="tailor-metric-prompt"
      data-skill={prompt.skill}
      data-status={status}
      className={`rounded-control border bg-sunken px-3 py-2 ${
        status === 'approved' ? 'border-success' : 'border-line'
      }`}
    >
      {status === 'idle' || status === 'dismissed' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id={labelId} className="text-sm text-ink">
            {`Keyword gap: ${prompt.skill}`}
            {status === 'dismissed' ? <span className="text-ink-muted"> - skipped</span> : null}
          </p>
          <button
            ref={addRef}
            type="button"
            disabled={disabled}
            aria-label={`Add a metric, ${prompt.skill}`}
            className={QUIET_BUTTON}
            onClick={open}
          >
            Add a metric
          </button>
        </div>
      ) : status === 'approved' ? (
        <div className="space-y-1">
          <p id={labelId} className="text-sm text-ink">
            {prompt.question}
          </p>
          <p className="text-ink">{draft}</p>
          <p className="flex items-center gap-1.5 text-sm text-success">
            <CheckIcon />
            Added. We&apos;ll use this in your next rewrite.
          </p>
          {cleanedOnApproval(state, prompt.key) ? (
            <p className="text-xs text-ink-muted">
              We tidied some wording the model cannot take. This is exactly what will be used.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              ref={changeRef}
              type="button"
              disabled={disabled}
              aria-label={`Change, ${prompt.skill}`}
              className={QUIET_BUTTON}
              onClick={open}
            >
              Change
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove from rewrite, ${prompt.skill}`}
              className={QUIET_BUTTON}
              onClick={() => {
                onChange(dismiss(state, prompt.key));
                announce(`${prompt.skill} removed from rewrite`);
              }}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <>
          <p id={labelId} className="text-sm text-ink">
            {prompt.question}
          </p>
          <label htmlFor={inputId} className="sr-only">
            {`Achievement or metric for ${prompt.skill}`}
          </label>
          <textarea
            ref={inputRef}
            id={inputId}
            rows={2}
            value={draft}
            maxLength={MAX_METRIC_CHARS}
            disabled={disabled}
            aria-describedby={counterId}
            onChange={(event) => {
              onChange(setDraft(state, prompt.key, event.currentTarget.value));
            }}
            className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
          />
          <p id={counterId} className="mt-0.5 text-xs text-ink-muted">
            {`${draft.length} / ${MAX_METRIC_CHARS}`} - only what you type and add is used.
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-disabled={!approvable}
              aria-describedby={canApprove(draft) ? undefined : hintId}
              aria-label={`Add to rewrite, ${prompt.skill}`}
              className={`${SECONDARY_BUTTON} aria-disabled:cursor-not-allowed aria-disabled:text-ink-faint`}
              onClick={() => {
                if (!approvable) return;
                onChange(approve(state, prompt.key));
                announce(`Added to rewrite for ${prompt.skill}`);
              }}
            >
              Add to rewrite
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Not now, ${prompt.skill}`}
              className={QUIET_BUTTON}
              onClick={() => {
                onChange(dismiss(state, prompt.key));
                announce(`${prompt.skill} skipped`);
              }}
            >
              Not now
            </button>
            {canApprove(draft) ? null : (
              <span id={hintId} className="text-xs text-ink-muted">
                {draft.trim() === ''
                  ? 'Type something first'
                  : 'That text cannot be used. Reword it.'}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
