import { wordCount, type Cv } from '@cviper/core-types';

import { QUIET_BUTTON } from '../../app/buttons';
import { ChipSelect } from '../../app/ChipSelect';

import { CvTextPanel } from './CvTextPanel';

export interface TailorCvPickerProps {
  readonly cvs: readonly Cv[];
  readonly cvsLoaded: boolean;
  readonly selectedCvId: string | null;
  readonly selectedCv: Cv | null;
  /** A CV picked from the list, or `null` for none. */
  readonly onPick: (id: string | null) => void;
  /** Whether the user has opened the CV text. A CV with no text shows anyway. */
  readonly previewOpen: boolean;
  readonly onTogglePreview: () => void;
  readonly running: boolean;
  /** Store a corrected (or restored) CV (L-218); a message on failure. */
  readonly onSaveCv: (next: Cv) => Promise<string | null>;
}

/** "185 words", "1 word" — and nothing for a CV with no text, never "0 words" (L-343). */
function withWordCount(cv: Cv): string | undefined {
  const count = wordCount(cv.extracted_text ?? '');
  return count === 0
    ? undefined
    : `${cv.name} · ${String(count)} ${count === 1 ? 'word' : 'words'}`;
}

/** Tailor's line of choices starts "Rewrite [Your CV]" (L-445). */
export function TailorCvChip({
  cvs,
  cvsLoaded,
  selectedCvId,
  onPick,
}: Pick<TailorCvPickerProps, 'cvs' | 'cvsLoaded' | 'selectedCvId' | 'onPick'>) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-2">
      <span className="text-ink-muted">Rewrite</span>
      <ChipSelect
        id="tailor-cv-pick"
        name="Your CV"
        testId="tailor-cv-pick"
        value={selectedCvId ?? ''}
        disabled={cvs.length === 0 || !cvsLoaded}
        onChange={(id) => onPick(id === '' ? null : id)}
        empty={cvs.length > 0 ? undefined : cvsLoaded ? 'No CV uploaded yet' : 'Reading your CVs…'}
        options={cvs.map((cv) => ({ value: cv.id, label: cv.name, shown: withWordCount(cv) }))}
      />
    </span>
  );
}

/**
 * The end of the line: Show CV and Upload a CV, both quiet.
 *
 * Upload is here too, not only on Analysis (L-240), and never disabled for want
 * of a model: a first run with nothing set up can still get its CV ready, and
 * it lands in the one store every screen reads. Its problem and warning lines
 * sit under the line (`CvUploadNotes`).
 *
 * A CV with no text has no Show CV: its panel always shows, so "Type or paste
 * your CV text" is never behind a toggle, and a toggle that cannot fold the
 * panel would lie. No CV has none either: the chip says so.
 */
export function TailorCvActions({
  selectedCv,
  previewOpen,
  onTogglePreview,
  onUpload,
}: Pick<TailorCvPickerProps, 'selectedCv' | 'previewOpen' | 'onTogglePreview'> & {
  readonly onUpload: () => void;
}) {
  const hasText = (selectedCv?.extracted_text ?? '').trim() !== '';
  return (
    <span className="ml-auto flex flex-wrap items-center gap-2">
      {!hasText ? null : (
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
      )}
      <button type="button" data-testid="tailor-upload" onClick={onUpload} className={QUIET_BUTTON}>
        Upload a CV
      </button>
    </span>
  );
}

/**
 * The chosen CV, as the rewrite will read it (L-192): the stored
 * `extracted_text` — the same `cvText` every run is sent — not the file, so
 * anything the parser dropped is visible BEFORE the run. Read-only by look
 * until the user chooses "Correct the text"; a correction is kept on the CV,
 * so every screen and job uses it (L-218, `CvTextPanel`). No CV at all draws
 * nothing: the chip says so.
 *
 * Folded until the user opens it (L-340), so the advert is above the fold;
 * folded, nothing of it shows, because the CV chip already names the CV and
 * its word count (L-445). A CV with no text is always shown. That is derived
 * from the CV, not a reset of the user's choice: a normal CV picked next is
 * back to whatever they chose (L-192).
 */
export function TailorCvPreview({
  selectedCv,
  previewOpen,
  running,
  onSaveCv,
}: Pick<TailorCvPickerProps, 'selectedCv' | 'previewOpen' | 'running' | 'onSaveCv'>) {
  if (selectedCv === null) return null;
  const shown = previewOpen || (selectedCv.extracted_text ?? '').trim() === '';
  return (
    <section
      id="tailor-cv-preview"
      data-testid="tailor-cv-preview"
      aria-labelledby="tailor-cv-preview-heading"
      hidden={!shown}
    >
      {/* No longer shown (L-445), but still the panel's spoken name. */}
      <span id="tailor-cv-preview-heading" className="sr-only">
        Your CV as the rewrite reads it
      </span>
      <CvTextPanel
        // A fresh panel per CV: an edit in progress never follows the
        // picker to another CV.
        key={selectedCv.id}
        cv={selectedCv}
        disabled={running}
        onSave={onSaveCv}
      />
    </section>
  );
}
