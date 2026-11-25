import { type Cv } from '@cviper/core-types';

import { QUIET_BUTTON } from '../../app/buttons';
import { ChipSelect } from '../../app/ChipSelect';
import { Hint } from '../../app/Hint';
import { JSON_RESUME_HINT, SAVE_JSON_RESUME_HINT } from '../../app/hints';
import { LiveStatus } from '../../app/LiveStatus';
import { MoreMenu } from '../../app/MoreMenu';
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

/** The CV part of the line (L-446): "Check" and the CV chip. */
export function AnalysisCvPicker({
  cvs,
  cvsLoaded,
  selectedCvId,
  onPick,
  exportMessage,
}: AnalysisCvPickerProps) {
  return (
    <span className="flex max-w-full min-w-0 items-center gap-2">
      <span className="text-ink-muted">Check</span>
      <ChipSelect
        id="analysis-cv"
        name="Your CV"
        testId="analysis-cv"
        value={selectedCvId ?? ''}
        options={cvs.map((cv) => ({ value: cv.id, label: cv.name }))}
        empty={cvs.length > 0 ? undefined : cvsLoaded ? 'No CV uploaded yet' : 'Reading your CVs…'}
        disabled={cvs.length === 0 || !cvsLoaded}
        onChange={(id) => onPick(id === '' ? null : id)}
      />
      <LiveStatus text={exportMessage} />
    </span>
  );
}

/**
 * The end of the line (L-463): "Upload a CV", quiet, then the CV's "…", which
 * holds "Save as JSON Resume". One group, so the "…" never starts a line of
 * its own: its list hangs leftwards from it, and at the left edge of a phone
 * it would be cut off.
 */
export function AnalysisCvUpload({
  selectedCv,
  onUpload,
  onSaveJsonResume,
  exporting,
}: Pick<AnalysisCvPickerProps, 'selectedCv' | 'onUpload' | 'onSaveJsonResume' | 'exporting'>) {
  return (
    <span className="ml-auto flex items-center gap-2">
      <button
        type="button"
        data-testid="analysis-upload"
        onClick={onUpload}
        className={QUIET_BUTTON}
      >
        Upload a CV
      </button>
      {/*
        Disabled, never hidden, for a CV that came from a PDF or a .docx:
        there is no JSON Resume to give back for those, and a control that
        comes and goes is one the user cannot learn. The reason is the item's
        "i" (L-387): a disabled button takes no focus and no tap.
      */}
      <MoreMenu
        label="More for this CV"
        testId="analysis-cv-more"
        items={[
          {
            label: exporting ? 'Saving…' : 'Save as JSON Resume',
            onSelect: onSaveJsonResume,
            disabled: selectedCv === null || selectedCv.json_resume === null || exporting,
            hint:
              selectedCv !== null && selectedCv.json_resume === null
                ? SAVE_JSON_RESUME_HINT
                : undefined,
            testId: 'analysis-save-json',
          },
        ]}
      />
    </span>
  );
}

/** Between the line and the box, only when there is one: what saving or reading a CV found. */
export function AnalysisCvNotices({
  exportMessage,
  uploadProblem,
  warnings,
}: Pick<AnalysisCvPickerProps, 'exportMessage' | 'uploadProblem' | 'warnings'>) {
  return (
    <>
      {exportMessage === null ? null : (
        <p
          data-testid="analysis-export-message"
          className="rounded-control bg-teal/10 px-3 py-2 break-all text-teal-ink"
        >
          {exportMessage}
        </p>
      )}

      {uploadProblem === null ? null : (
        <ErrorBox variant="box" testId="analysis-upload-problem">
          {uploadProblem}
        </ErrorBox>
      )}

      {warnings.length === 0 ? null : (
        <ul
          data-testid="analysis-cv-warnings"
          className="space-y-1 rounded-control bg-gold/10 px-3 py-2 text-gold-ink"
        >
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Under the box: what files are read, and where their text goes. */
export function AnalysisCvNote() {
  return (
    <p data-testid="analysis-cv-note" className="text-xs text-ink-faint">
      PDF, Word (.docx) or{' '}
      <Hint text={JSON_RESUME_HINT}>
        <span data-testid="json-resume-hint">JSON Resume</span> (.json)
      </Hint>
      . The file is read on this computer. Its text only goes to an AI you choose, and only when you
      ask it to read your CV.
    </p>
  );
}
