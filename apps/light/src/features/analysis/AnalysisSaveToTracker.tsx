import { useRef, useState } from 'react';

import { type Analysis as AnalysisRow, type Job } from '@cviper/core-types';

import { SECONDARY_BUTTON } from '../../app/buttons';
import { LiveStatus } from '../../app/LiveStatus';
import { type DraftErrors } from '../tracker/model';

import { type AnalysisPort } from './port';
import { canOfferSave, trackedJobForAdvert, trackerEntryForAdvert } from './saveToTracker';

export interface AnalysisSaveToTrackerProps {
  /** The advert the result on screen CHECKED — not the box's current text. */
  readonly checkedAdvert: string | null;
  /** The tracked job the advert belongs to, or `null` for a paste. */
  readonly jobId: string | null;
  readonly jobs: readonly Job[];
  /** The history row the check saved, re-saved against the job. */
  readonly record: AnalysisRow | null;
  readonly addToTracker: NonNullable<AnalysisPort['addToTracker']>;
  readonly saveAnalysis: AnalysisPort['saveAnalysis'];
  readonly now: Date | undefined;
  /** The check now belongs to `job`: the screen treats it as a tracked job. */
  readonly onLinked: (job: Job, record: AnalysisRow | null) => void;
}

const FIELD = 'mt-1 w-full rounded-control border bg-card px-2.5 py-1.5 text-ink';
const SAVED = 'Saved to your tracker, under Saved.';

/**
 * "Save this job to the tracker" (L-325), under the result of a check on a
 * pasted advert. Mounted only beside a result, so switching CV or deleting
 * everything — both clear the result — takes the half-typed form with it.
 */
export function AnalysisSaveToTracker({
  checkedAdvert,
  jobId,
  jobs,
  record,
  addToTracker,
  saveAnalysis,
  now,
  onLinked,
}: AnalysisSaveToTrackerProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  // State updates land on the next render; a second press in the same tick must not.
  const busy = useRef(false);

  const offered = canOfferSave(checkedAdvert, jobId);
  const duplicate = offered ? trackedJobForAdvert(checkedAdvert ?? '', jobs) : null;

  function say(text: string | null, isProblem: boolean) {
    setMessage(text);
    setProblem(isProblem);
  }

  /** Re-save the check against `job`, then hand the job to the screen. */
  async function link(job: Job, saved: string | null) {
    let linked = record;
    let relinkProblem: string | null = null;
    if (record !== null && record.job_id !== job.id) {
      const relinked = { ...record, job_id: job.id };
      const written = await saveAnalysis(relinked);
      if (written.ok) linked = relinked;
      else relinkProblem = `This check could not be added to the job: ${written.error.message}`;
    }
    // The job is linked either way: a history row that would not re-save is a
    // note, not a reason to take the job back off the board.
    onLinked(job, linked);
    if (relinkProblem === null) say(saved, false);
    else say(saved === null ? relinkProblem : `${saved} ${relinkProblem}`, true);
  }

  /** "Use that job": the advert is already tracked, so nothing new is written. */
  async function onUseJob(job: Job) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      await link(job, null);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  async function onSave() {
    if (busy.current || checkedAdvert === null) return;
    const built = trackerEntryForAdvert(
      { title, company },
      checkedAdvert,
      { jobId: crypto.randomUUID(), applicationId: crypto.randomUUID() },
      (now ?? new Date()).toISOString(),
    );
    setErrors(built.ok ? {} : built.errors);
    if (!built.ok) return;

    busy.current = true;
    setSaving(true);
    say(null, false);
    try {
      const created = await addToTracker(built.entry);
      if (created.ok) await link(built.entry.job, SAVED);
      else say(`The job could not be saved to your tracker: ${created.error.message}`, true);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const field = (
    id: 'title' | 'company',
    label: string,
    value: string,
    onChange: (value: string) => void,
  ) => (
    <div>
      <label
        htmlFor={`analysis-tracker-${id}`}
        className="block text-xs font-medium text-ink-muted"
      >
        {label}
      </label>
      <input
        id={`analysis-tracker-${id}`}
        data-testid={`analysis-tracker-${id}`}
        value={value}
        aria-invalid={errors[id] === undefined ? undefined : true}
        aria-describedby={errors[id] === undefined ? undefined : `analysis-tracker-${id}-error`}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={`${FIELD} ${errors[id] === undefined ? 'border-field-line' : 'border-danger'}`}
      />
      {errors[id] === undefined ? null : (
        <p
          id={`analysis-tracker-${id}-error`}
          data-testid={`analysis-tracker-${id}-error`}
          className="mt-1 text-xs text-danger"
        >
          {errors[id]}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <LiveStatus text={message} testId="analysis-tracker-status" />
      {!offered ? null : duplicate !== null ? (
        <div data-testid="analysis-tracker-duplicate" className="flex items-center gap-3">
          <p className="text-ink-muted">You’re already tracking this advert.</p>
          <button
            type="button"
            data-testid="analysis-tracker-use-job"
            disabled={saving}
            onClick={() => void onUseJob(duplicate)}
            className={SECONDARY_BUTTON}
          >
            Use that job
          </button>
        </div>
      ) : !open ? (
        <button
          type="button"
          data-testid="analysis-save-to-tracker"
          onClick={() => setOpen(true)}
          className={SECONDARY_BUTTON}
        >
          Save this job to the tracker
        </button>
      ) : (
        <div data-testid="analysis-tracker-form" className="space-y-3">
          <p data-testid="analysis-tracker-hint" className="text-ink-muted">
            Add the job title and company so you can spot it on the board. The advert you pasted is
            saved with it.
          </p>
          {field('title', 'Job title', title, setTitle)}
          {field('company', 'Company', company, setCompany)}
          {errors.description === undefined ? null : (
            <p data-testid="analysis-tracker-description-error" className="text-xs text-danger">
              {errors.description}
            </p>
          )}
          <button
            type="button"
            data-testid="analysis-tracker-save"
            disabled={saving}
            onClick={() => void onSave()}
            className={SECONDARY_BUTTON}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      {message === null ? null : (
        <p
          data-testid="analysis-tracker-message"
          className={problem ? 'text-danger' : 'text-ink-muted'}
        >
          {message}
        </p>
      )}
    </div>
  );
}
