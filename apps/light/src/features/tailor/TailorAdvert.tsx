import { type Job } from '@cviper/core-types';

import { QUIET_BUTTON } from '../../app/buttons';
import { ChipSelect } from '../../app/ChipSelect';
import { COMPOSER_EDITOR } from '../../app/fields';

import { MetricPromptBoxes } from './MetricPromptBoxes';
import { type MetricPrompt, type MetricState } from './metricPrompts';

export interface TailorAdvertProps {
  readonly jobText: string;
  /** The advert box was typed in by hand. */
  readonly onAdvertChange: (text: string) => void;
  /** The box no longer holds the tracked job's own advert (L-199). */
  readonly advertEdited: boolean;
  readonly selectedJob: Job | null;
  readonly onRestoreAdvert: (job: Job) => void;
  readonly jobs: readonly Job[];
  readonly selectedJobId: string | null;
  /** A tracked job chosen from the list. */
  readonly onPickJob: (job: Job) => void;
  /** The gaps the prompt will carry, or `null` for none (L-202). */
  readonly keywordGaps: readonly string[] | null;
  readonly metricPrompts: readonly MetricPrompt[];
  readonly metricState: MetricState;
  readonly onMetricStateChange: (next: MetricState) => void;
  readonly running: boolean;
}

/** The advert box: the top half of the composer, its name spoken, not shown (L-445). */
export function TailorAdvertBox({
  jobText,
  onAdvertChange,
}: Pick<TailorAdvertProps, 'jobText' | 'onAdvertChange'>) {
  return (
    <>
      <label htmlFor="tailor-job-text" className="sr-only">
        The job advert
      </label>
      {/*
       * About nine lines (~240px): the button stays on screen at 1000×700
       * (L-445). `relative` paints the focus ring over the bar below it.
       */}
      <textarea
        id="tailor-job-text"
        data-testid="tailor-job-text"
        rows={9}
        value={jobText}
        placeholder="Paste the whole advert, including the requirements list."
        onChange={(event) => {
          // Edited by hand. The job link is KEPT (L-199, owner decision
          // 2026-10-01): it is still that job, and the marker below says
          // the text is the user's version of its advert.
          onAdvertChange(event.currentTarget.value);
        }}
        className={`${COMPOSER_EDITOR} relative block w-full`}
      />
    </>
  );
}

/**
 * The tracked-job chip in the box's bar: the chosen job, or "Or use one you are
 * already tracking". Not drawn when nothing is tracked.
 */
export function TailorJobChip({
  jobs,
  selectedJobId,
  onPickJob,
}: Pick<TailorAdvertProps, 'jobs' | 'selectedJobId' | 'onPickJob'>) {
  if (jobs.length === 0) return null;
  return (
    <ChipSelect
      id="tailor-job-pick"
      name="Or use one you are already tracking"
      testId="tailor-job-pick"
      value={selectedJobId ?? ''}
      empty="Or use one you are already tracking"
      onChange={(id) => {
        const picked = jobs.find((candidate) => candidate.id === id);
        if (picked !== undefined) onPickJob(picked);
      }}
      options={jobs.map((job) => ({ value: job.id, label: `${job.title} — ${job.company}` }))}
    />
  );
}

/** Under the box, first: the edited-advert marker, the gaps to fill, and their questions. */
export function TailorAdvertNotes({
  advertEdited,
  selectedJob,
  onRestoreAdvert,
  keywordGaps,
  metricPrompts,
  metricState,
  onMetricStateChange,
  running,
}: Omit<TailorAdvertProps, 'jobText' | 'onAdvertChange' | 'jobs' | 'selectedJobId' | 'onPickJob'>) {
  return (
    <>
      {!advertEdited || selectedJob === null ? null : (
        <div
          data-testid="tailor-advert-edited"
          className="flex flex-wrap items-center gap-2 text-xs text-ink-muted"
        >
          <span>Advert edited — the tailoring uses your version.</span>
          <button
            type="button"
            data-testid="tailor-advert-restore"
            onClick={() => onRestoreAdvert(selectedJob)}
            className={QUIET_BUTTON}
          >
            Restore the original
          </button>
        </div>
      )}

      {keywordGaps === null ? null : (
        <p data-testid="tailor-keyword-gaps-note" className="text-xs text-ink-faint">
          From your analysis: {keywordGaps.length} {keywordGaps.length === 1 ? 'word' : 'words'} in
          the advert that your CV does not use yet. The draft uses them only where your CV already
          shows the experience.
        </p>
      )}
      <MetricPromptBoxes
        prompts={metricPrompts}
        state={metricState}
        onChange={onMetricStateChange}
        disabled={running}
      />
    </>
  );
}
