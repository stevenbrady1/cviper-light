import { type Job } from '@cviper/core-types';

import { QUIET_BUTTON } from '../../app/buttons';

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

/** Tailor, step 2: the advert, a tracked job to take it from, and the gaps to fill. */
export function TailorAdvert({
  jobText,
  onAdvertChange,
  advertEdited,
  selectedJob,
  onRestoreAdvert,
  jobs,
  selectedJobId,
  onPickJob,
  keywordGaps,
  metricPrompts,
  metricState,
  onMetricStateChange,
  running,
}: TailorAdvertProps) {
  return (
    <div>
      <label htmlFor="tailor-job-text" className="block text-xs font-medium text-ink-muted">
        The job advert
      </label>
      <textarea
        id="tailor-job-text"
        data-testid="tailor-job-text"
        rows={7}
        value={jobText}
        placeholder="Paste the whole advert, including the requirements list."
        onChange={(event) => {
          // Edited by hand. The job link is KEPT (L-199, owner decision
          // 2026-10-01): it is still that job, and the marker below says
          // the text is the user's version of its advert.
          onAdvertChange(event.currentTarget.value);
        }}
        className="mt-1 w-full rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink"
      />

      {!advertEdited || selectedJob === null ? null : (
        <div
          data-testid="tailor-advert-edited"
          className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted"
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

      {jobs.length === 0 ? null : (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <label htmlFor="tailor-job-pick" className="text-xs text-ink-faint">
            Or use one you are already tracking
          </label>
          <select
            id="tailor-job-pick"
            data-testid="tailor-job-pick"
            value={selectedJobId ?? ''}
            onChange={(event) => {
              const picked = jobs.find((candidate) => candidate.id === event.currentTarget.value);
              if (picked !== undefined) onPickJob(picked);
            }}
            className="min-w-0 flex-1 rounded-control border border-field-line bg-card px-2.5 py-1 text-ink"
          >
            <option value="">Choose a tracked job…</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title} — {job.company}
              </option>
            ))}
          </select>
        </div>
      )}

      {keywordGaps === null ? null : (
        <p data-testid="tailor-keyword-gaps-note" className="mt-1 text-xs text-ink-faint">
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
    </div>
  );
}
