import { type Job } from '@cviper/core-types';

import { ChipSelect } from '../../app/ChipSelect';
import { COMPOSER_EDITOR } from '../../app/fields';
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

/** The advert box: the top half of the composer, its name spoken, not shown (L-446). */
export function AnalysisAdvert({
  jobNote,
  jobText,
  onJobTextChange,
}: Pick<AnalysisAdvertProps, 'jobNote' | 'jobText' | 'onJobTextChange'>) {
  return (
    <>
      {/* Always drawn, so the note below the line is read out when it arrives (L-299). */}
      <LiveStatus text={jobNote} />
      <label htmlFor="analysis-job-text" className="sr-only">
        The job advert
      </label>
      {/*
        About nine lines (~240px): "Check this CV" stays on screen at
        1000×700, with a job's step bar and its note. `relative` paints the
        focus ring over the bar below it.
      */}
      <textarea
        id="analysis-job-text"
        data-testid="analysis-job-text"
        rows={9}
        value={jobText}
        placeholder="Paste the whole advert, including the requirements list."
        onChange={(event) => onJobTextChange(event.currentTarget.value)}
        className={`${COMPOSER_EDITOR} relative block w-full`}
      />
    </>
  );
}

/**
 * What came with a job handed over from Search (L-190) — usually that only a
 * preview of the advert arrived. ABOVE the box, because it is about what is in
 * the box and has to be read first; gold, because it is something to act on,
 * not a failure.
 */
export function AnalysisJobNote({ jobNote }: Pick<AnalysisAdvertProps, 'jobNote'>) {
  return jobNote === null ? null : (
    <p
      data-testid="analysis-job-note"
      className="rounded-control bg-gold/10 px-3 py-2 text-gold-ink"
    >
      {jobNote}
    </p>
  );
}

/** The tracked-job chip in the box's bar. Not drawn when nothing is tracked. */
export function AnalysisJobChip({
  jobs,
  onPickJob,
}: Pick<AnalysisAdvertProps, 'jobs' | 'onPickJob'>) {
  if (jobs.length === 0) return null;
  return (
    <ChipSelect
      id="analysis-job-pick"
      name="Or use one you are already tracking"
      testId="analysis-job-pick"
      value=""
      empty="Or use one you are already tracking"
      options={jobs.map((job) => ({ value: job.id, label: `${job.title} — ${job.company}` }))}
      onChange={(id) => {
        const job = jobs.find((candidate) => candidate.id === id);
        if (job !== undefined) onPickJob(job);
      }}
    />
  );
}
