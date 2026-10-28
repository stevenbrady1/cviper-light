import { type Cv } from '@cviper/core-types';

import { QUIET_BUTTON } from '../../app/buttons';
import { type FilePort } from '../../platform/files';
import { CvUpload } from '../cv/CvUpload';
import { type CvStorePort } from '../cv/ingestCv';

import { CvTextPanel } from './CvTextPanel';

export interface TailorCvPickerProps {
  readonly cvs: readonly Cv[];
  readonly cvsLoaded: boolean;
  readonly selectedCvId: string | null;
  readonly selectedCv: Cv | null;
  /** A CV picked from the list, or `null` for none. */
  readonly onPick: (id: string | null) => void;
  readonly files: Pick<FilePort, 'pickCv'>;
  readonly saveCv: CvStorePort['saveCv'];
  readonly now?: Date | undefined;
  readonly onUploaded: (cv: Cv) => void;
  readonly previewOpen: boolean;
  readonly onTogglePreview: () => void;
  readonly running: boolean;
  /** Store a corrected (or restored) CV (L-218); a message on failure. */
  readonly onSaveCv: (next: Cv) => Promise<string | null>;
}

/** Tailor, step 1: which CV, an upload, and the CV as the rewrite reads it. */
export function TailorCvPicker({
  cvs,
  cvsLoaded,
  selectedCvId,
  selectedCv,
  onPick,
  files,
  saveCv,
  now,
  onUploaded,
  previewOpen,
  onTogglePreview,
  running,
  onSaveCv,
}: TailorCvPickerProps) {
  return (
    <div>
      <label htmlFor="tailor-cv-pick" className="block text-xs font-medium text-ink-muted">
        Your CV
      </label>
      <select
        id="tailor-cv-pick"
        data-testid="tailor-cv-pick"
        value={selectedCvId ?? ''}
        disabled={cvs.length === 0 || !cvsLoaded}
        onChange={(event) => {
          const id = event.currentTarget.value;
          onPick(id === '' ? null : id);
        }}
        className="mt-1 w-full rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink"
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
      <p className="mt-1 text-xs text-ink-faint">
        The CVs you have uploaded here, on Analysis or on Profile. The rewrite uses only what is
        written in the one you choose.
      </p>
      {/*
       * Here too, not only on Analysis (L-240) — and never disabled for
       * want of a model: a first run with nothing set up can still get
       * its CV ready, and it lands in the one store every screen reads.
       */}
      <div className="mt-2">
        <CvUpload
          idPrefix="tailor"
          files={files}
          saveCv={saveCv}
          now={now}
          onUploaded={onUploaded}
        />
      </div>

      {/*
       * The chosen CV, as the rewrite will read it (L-192): the stored
       * `extracted_text` — the same `cvText` every run is sent — not the
       * file, so anything the parser dropped is visible BEFORE the run.
       * Read-only by look until the user chooses "Correct the text"; a
       * correction is kept on the CV, so every screen and job uses it
       * (L-218, `CvTextPanel`). No CV at all draws nothing: the picker
       * says so.
       */}
      {selectedCv === null ? null : (
        <div className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id="tailor-cv-preview-heading" className="text-xs font-medium text-ink-muted">
              Your CV as the rewrite reads it
            </p>
            <button
              type="button"
              data-testid="tailor-cv-preview-toggle"
              aria-expanded={previewOpen}
              aria-controls="tailor-cv-preview"
              onClick={onTogglePreview}
              className={QUIET_BUTTON}
            >
              {previewOpen ? 'Hide CV' : 'Show CV'}
            </button>
          </div>
          <section
            id="tailor-cv-preview"
            data-testid="tailor-cv-preview"
            aria-labelledby="tailor-cv-preview-heading"
            hidden={!previewOpen}
            className="mt-1"
          >
            <CvTextPanel
              // A fresh panel per CV: an edit in progress never follows the
              // picker to another CV.
              key={selectedCv.id}
              cv={selectedCv}
              disabled={running}
              onSave={onSaveCv}
            />
          </section>
        </div>
      )}
    </div>
  );
}
