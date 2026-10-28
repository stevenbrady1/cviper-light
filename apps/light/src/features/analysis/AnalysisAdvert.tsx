import { type Job } from '@cviper/core-types';

import { LiveStatus } from '../../app/LiveStatus';

export interface AnalysisAdvertProps {
  /** What came with a job handed over from Search (L-190), or `null`. */
  readonly jobNote: string | null;
  readonly jobText: string;
  readonly onJobTextChange: (text: string) => void;
  readonly jobs: readonly Job[];
  /** A tracked job chosen from the list. */
  readonly onPickJob: (job: Job) => void;
}

/** Analysis, step 2: the advert, and a tracked job to take it from. */
export function AnalysisAdvert({
  jobNote,
  jobText,
  onJobTextChange,
  jobs,
  onPickJob,
}: AnalysisAdvertProps) {
  return (
    <div>
      {/*
        What came with a job handed over from Search (L-190) — usually
        that only a preview of the advert arrived. ABOVE the box, because
        it is about what is in the box and has to be read first; gold,
        because it is something to act on, not a failure.
      */}
      <LiveStatus text={jobNote} />
      {jobNote === null ? null : (
        <p
          data-testid="analysis-job-note"
          className="mb-2 rounded-control bg-gold/10 px-3 py-2 text-gold-ink"
        >
          {jobNote}
        </p>
      )}
      <label htmlFor="analysis-job-text" className="block text-xs font-medium text-ink-muted">
        The job advert
      </label>
      <textarea
        id="analysis-job-text"
        data-testid="analysis-job-text"
        rows={7}
        value={jobText}
        placeholder="Paste the whole advert, including the requirements list."
        onChange={(event) => onJobTextChange(event.currentTarget.value)}
        className="mt-1 w-full rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink"
      />

      {jobs.length === 0 ? null : (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <label htmlFor="analysis-job-pick" className="text-xs text-ink-faint">
            Or use one you are already tracking
          </label>
          <select
            id="analysis-job-pick"
            data-testid="analysis-job-pick"
            value=""
            onChange={(event) => {
              const job = jobs.find((candidate) => candidate.id === event.currentTarget.value);
              if (job !== undefined) onPickJob(job);
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
    </div>
  );
}
