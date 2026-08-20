import { useCallback, useEffect, useMemo, useState } from 'react';

import { type ChatTransport } from '@cviper/ai-providers';

import { PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';

import { readAvailability as readRealAvailability } from '../analysis/availability';
import { optionByKey, type Availability, type ProviderOption } from '../analysis/providers';

import {
  NO_PROVIDER_NOTE,
  draftFromOutcome,
  draftWithPastedText,
  extractionOptions,
  extractionProgressNote,
} from './extraction';
import { runExtraction } from './runExtraction';
import { type ApplicationDraft } from './model';

/**
 * Paste a job advert; a model reads it; YOU check it before anything is saved.
 *
 * ============================================================================
 * THIS COMPONENT CANNOT SAVE ANYTHING. IT HAS NO PORT AND NO WRITE.
 * ============================================================================
 * It hands a filled-in `ApplicationDraft` upwards and stops. The only thing in
 * the tracker that creates a row is `NewApplicationForm`'s submit handler, so
 * an unreviewed extraction has nowhere to go even if somebody wanted it to —
 * there is no code path from here to storage to accidentally take.
 *
 * ============================================================================
 * NO REGEX FALLBACK. DELIBERATELY.
 * ============================================================================
 * With no AI configured this offers a sentence and two ways forward, not a
 * pattern-matched guess. A "title" scraped off the first line of an email is
 * wrong often enough to be worse than an empty box, and it would be wrong
 * INVISIBLY: the review form has no way to mark which fields were guessed, so
 * the user would be checking a form that looks equally confident about all of
 * it. See `extraction.ts`.
 *
 * ============================================================================
 * THE WAIT IS EXPLAINED WHILE IT HAPPENS
 * ============================================================================
 * A local model that is not already resident spends 5-30 seconds loading
 * several gigabytes into memory before it emits a single token. Thirty seconds
 * of a still screen is indistinguishable from a crash, so the wait says what is
 * happening, says why it is slow, and counts.
 */

/** How often the elapsed counter ticks while a model is reading. */
const TICK_MS = 1000;

export interface PasteJobFormProps {
  /**
   * Hand the review form its starting point.
   *
   * `notice` is non-null when the extraction did not work, and the draft still
   * carries the paste — see `draftFromOutcome`. Both cases go through the same
   * callback because both lead to the same screen.
   */
  readonly onExtracted: (draft: ApplicationDraft, notice: string | null) => void;
  readonly onCancel: () => void;
  /** The shell owns which view is showing, so "open Settings" comes back up. */
  readonly onOpenSettings?: (() => void) | undefined;
  /** Injected by tests so a fake provider can answer without a socket. */
  readonly createTransport?: (() => ChatTransport) | undefined;
  /** Injected by tests so the machine's real credentials are never consulted. */
  readonly readAvailability?: (() => Promise<Availability>) | undefined;
}

export function PasteJobForm({
  onExtracted,
  onCancel,
  onOpenSettings,
  createTransport,
  readAvailability,
}: PasteJobFormProps) {
  const probe = useMemo(() => readAvailability ?? readRealAvailability, [readAvailability]);

  const [text, setText] = useState('');
  const [options, setOptions] = useState<readonly ProviderOption[]>([]);
  /** False until the probe answers. Without it the note flashes on every open. */
  const [probed, setProbed] = useState(false);
  const [optionKey, setOptionKey] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void probe().then((availability) => {
      if (cancelled) return;
      const usable = extractionOptions(availability);
      setOptions(usable);
      // Local before cloud, which is the order `providerOptions` already
      // returns: free, private, and it does not spend the user's money.
      setOptionKey(usable[0]?.key ?? null);
      setProbed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [probe]);

  const selected = optionKey === null ? null : optionByKey(options, optionKey);

  useEffect(() => {
    if (!running) return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  const onExtract = useCallback(async () => {
    if (selected === null || text.trim() === '') return;

    setRunning(true);
    const outcome = await runExtraction({ option: selected, text }, createTransport);
    setRunning(false);

    // Straight to the review form on BOTH paths. A failure is not a dead end:
    // it is the blank form with everything the user pasted still in it.
    onExtracted(draftFromOutcome(outcome, text), outcome.available ? null : outcome.reason);
  }, [createTransport, onExtracted, selected, text]);

  const nothingConfigured = probed && options.length === 0;
  const emptyPaste = text.trim() === '';

  /** Why the button will not go, or `null`. Always on screen when it applies. */
  const disabledReason = running
    ? null
    : nothingConfigured
      ? NO_PROVIDER_NOTE
      : emptyPaste
        ? 'Paste the advert above first — the title, the company and the description.'
        : null;

  return (
    <div className="space-y-3" data-testid="paste-job-form">
      <div>
        <label htmlFor="paste-job-text" className="block text-xs font-medium text-ink-muted">
          The advert
        </label>
        <textarea
          id="paste-job-text"
          data-testid="paste-job-text"
          rows={12}
          value={text}
          disabled={running}
          placeholder="Paste the whole advert or recruiter email here."
          onChange={(event) => setText(event.currentTarget.value)}
          className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
        />
        <p className="mt-1 text-xs text-ink-faint">
          Nothing is saved until you have checked every field on the next screen.
        </p>
      </div>

      {/*
        The picker only appears when there is a choice to make. One installed
        model is not a decision, and a dropdown with one entry is a control that
        asks the user to confirm something they cannot change.
      */}
      {options.length > 1 ? (
        <div>
          <label htmlFor="paste-job-provider" className="block text-xs font-medium text-ink-muted">
            Read it with
          </label>
          <select
            id="paste-job-provider"
            data-testid="paste-job-provider"
            value={optionKey ?? ''}
            disabled={running}
            onChange={(event) => {
              // Read the value NOW — React nulls `currentTarget` the moment
              // this handler returns.
              const key = event.currentTarget.value;
              setOptionKey(key);
            }}
            className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
          >
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : selected === null ? null : (
        <p data-testid="paste-job-provider-note" className="text-xs text-ink-faint">
          Read with {selected.label}.
        </p>
      )}

      <div className="flex items-center gap-2">
        {/*
          The view's ONE blue button while this pane is open — the header's
          "Add application" is disabled for exactly as long as it is. DISABLED
          rather than hidden: a control that comes and goes is a control the
          user cannot learn.
        */}
        <button
          type="button"
          data-testid="paste-job-extract"
          data-primary="true"
          disabled={running || nothingConfigured || emptyPaste}
          onClick={() => void onExtract()}
          className={PRIMARY_BUTTON}
        >
          {running ? 'Reading the advert…' : 'Read the advert'}
        </button>

        {/*
          Always available, and never framed as giving up. Adding a job by hand
          is a first-class way to use this app — and this button is the one that
          rescues the paste when there is no AI at all to read it.
        */}
        <button
          type="button"
          data-testid="paste-job-manual"
          disabled={running}
          onClick={() => onExtracted(draftWithPastedText(text), null)}
          className={SECONDARY_BUTTON}
        >
          Fill it in myself
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={running}
          className="rounded-control px-3 py-1.5 text-ink-muted hover:bg-sunken hover:text-ink"
        >
          Cancel
        </button>
      </div>

      {disabledReason === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Not an alert. A machine with no AI on it is the default state of a
            freshly installed app, and everything else on this screen works.
          */}
          <p data-testid="paste-job-reason" className="text-xs text-ink-faint">
            {disabledReason}
          </p>
          {nothingConfigured && onOpenSettings !== undefined ? (
            <button
              type="button"
              data-testid="paste-job-settings"
              onClick={onOpenSettings}
              className={`${QUIET_BUTTON} px-0 text-xs text-blue hover:bg-card hover:text-navy`}
            >
              Open Settings →
            </button>
          ) : null}
        </div>
      )}

      {running && selected !== null ? (
        <p
          data-testid="paste-job-progress"
          role="status"
          className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
        >
          {extractionProgressNote(selected)}{' '}
          <span className="font-mono tabular-nums">{elapsed}s</span>
        </p>
      ) : null}
    </div>
  );
}
