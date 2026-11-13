import { type Cv } from '@cviper/core-types';

import { SECONDARY_BUTTON } from '../../app/buttons';
import { FIELD } from '../../app/fields';
import { Hint } from '../../app/Hint';
import { JSON_RESUME_HINT, SAVE_JSON_RESUME_HINT } from '../../app/hints';
import { LiveStatus } from '../../app/LiveStatus';
import { ErrorBox } from '../../ui';

export interface AnalysisCvPickerProps {
  readonly cvs: readonly Cv[];
  readonly cvsLoaded: boolean;
  readonly selectedCvId: string | null;
  readonly selectedCv: Cv | null;
  /** A CV picked from the list, or `null` for none. */
  readonly onPick: (id: string | null) => void;
  readonly onUpload: () => void;
  readonly onSaveJsonResume: () => void;
  readonly exporting: boolean;
  /** "Saved to …" after a JSON Resume export (L-20b). */
  readonly exportMessage: string | null;
  /** The parser's own words about a file it could not read. */
  readonly uploadProblem: string | null;
  /** Pages a successful read could not see, said before the check runs on them. */
  readonly warnings: readonly string[];
}

/** Analysis, step 1: which CV, an upload, the JSON Resume export, and what the read found. */
export function AnalysisCvPicker({
  cvs,
  cvsLoaded,
  selectedCvId,
  selectedCv,
  onPick,
  onUpload,
  onSaveJsonResume,
  exporting,
  exportMessage,
  uploadProblem,
  warnings,
}: AnalysisCvPickerProps) {
  const saveJson = (
    <button
      type="button"
      data-testid="analysis-save-json"
      disabled={selectedCv === null || selectedCv.json_resume === null || exporting}
      onClick={onSaveJsonResume}
      className={SECONDARY_BUTTON}
    >
      {exporting ? 'Saving…' : 'Save as JSON Resume'}
    </button>
  );

  return (
    <div>
      <label htmlFor="analysis-cv" className="block text-xs font-medium text-ink-muted">
        Your CV
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select
          id="analysis-cv"
          data-testid="analysis-cv"
          value={selectedCvId ?? ''}
          disabled={cvs.length === 0 || !cvsLoaded}
          onChange={(event) => {
            const id = event.currentTarget.value;
            onPick(id === '' ? null : id);
          }}
          className={`${FIELD} min-w-0 flex-1`}
        >
          {cvs.length > 0 ? null : (
            <option value="">{cvsLoaded ? 'No CV uploaded yet' : 'Reading your CVs…'}</option>
          )}
          {cvs.map((cv) => (
            <option key={cv.id} value={cv.id}>
              {cv.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          data-testid="analysis-upload"
          onClick={onUpload}
          className={SECONDARY_BUTTON}
        >
          Upload a CV
        </button>

        {/*
          Disabled, never hidden, for a CV that came from a PDF or a
          .docx: there is no JSON Resume to give back for those, and a
          control that comes and goes is one the user cannot learn.
          The reason is a Hint with an "i", not the render-function form:
          a disabled button takes no focus and no tap (L-387).
        */}
        {selectedCv !== null && selectedCv.json_resume === null ? (
          <Hint text={SAVE_JSON_RESUME_HINT}>{saveJson}</Hint>
        ) : (
          saveJson
        )}
      </div>

      <p data-testid="analysis-cv-note" className="mt-1 text-xs text-ink-faint">
        PDF, Word (.docx) or{' '}
        <Hint text={JSON_RESUME_HINT}>
          <span data-testid="json-resume-hint">JSON Resume</span>
        </Hint>{' '}
        (.json). The file is read on this computer. Its text only goes to an AI you choose, and only
        when you ask it to read your CV.
      </p>

      <LiveStatus text={exportMessage} />
      {exportMessage === null ? null : (
        <p
          data-testid="analysis-export-message"
          className="mt-2 rounded-control bg-teal/10 px-3 py-2 break-all text-teal-ink"
        >
          {exportMessage}
        </p>
      )}

      {uploadProblem === null ? null : (
        <ErrorBox variant="box" gapAbove="mt-2" testId="analysis-upload-problem">
          {uploadProblem}
        </ErrorBox>
      )}

      {warnings.length === 0 ? null : (
        <ul
          data-testid="analysis-cv-warnings"
          className="mt-2 space-y-1 rounded-control bg-gold/10 px-3 py-2 text-gold-ink"
        >
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
