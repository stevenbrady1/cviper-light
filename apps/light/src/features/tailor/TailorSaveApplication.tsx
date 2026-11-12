import { type Application } from '@cviper/core-types';

import { SECONDARY_BUTTON } from '../../app/buttons';
import { FIELD_COMPACT } from '../../app/fields';

export interface TailorSaveApplicationProps {
  readonly applications: readonly Application[];
  readonly selectedApplicationId: string | null;
  readonly onSelectApplication: (id: string | null) => void;
  /** The tracked job, or `null` for a pasted advert — which has no applications. */
  readonly selectedJobId: string | null;
  /** The job whose applications have been read; saving waits for them. */
  readonly applicationsFor: string | null;
  readonly busy: boolean;
  readonly saving: boolean;
  readonly onSave: () => void;
}

/** Save the draft (and letter, and edited advert) into one of the job's applications. */
export function TailorSaveApplication({
  applications,
  selectedApplicationId,
  onSelectApplication,
  selectedJobId,
  applicationsFor,
  busy,
  saving,
  onSave,
}: TailorSaveApplicationProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {applications.length === 0 ? null : (
        <select
          data-testid="tailor-application"
          aria-label="Application to save into"
          value={selectedApplicationId ?? ''}
          onChange={(event) => onSelectApplication(event.currentTarget.value || null)}
          className={`${FIELD_COMPACT} min-w-0`}
        >
          {applications.map((application) => (
            <option key={application.id} value={application.id}>
              {application.status}
              {application.applied_date === null ? '' : ` · applied ${application.applied_date}`}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        data-testid="tailor-save-application"
        disabled={
          busy ||
          selectedJobId === null ||
          // Wait for the job's applications, so a quick press cannot
          // start a second one beside the one it already has.
          applicationsFor !== selectedJobId
        }
        onClick={onSave}
        className={SECONDARY_BUTTON}
      >
        {saving ? 'Saving…' : 'Save to an application'}
      </button>
      {selectedJobId !== null ? null : (
        <p data-testid="tailor-save-application-reason" className="text-xs text-ink-muted">
          Choose a tracked job above to save into one of its applications.
        </p>
      )}
    </div>
  );
}
