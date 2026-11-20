import { useCallback, useState } from 'react';

import { type Cv } from '@cviper/core-types';

import { SECONDARY_BUTTON } from '../../app/buttons';
import { type FilePort } from '../../platform/files';
import { ErrorBox } from '../../ui';

import { uploadCv, type CvStorePort } from './ingestCv';

/**
 * "Upload a CV", for a screen that is not Analysis (L-240).
 *
 * Profile draws this, and Tailor its two halves (`useCvUpload`, `CvUploadNotes`,
 * L-445); Analysis keeps its own layout around the same
 * `uploadCv`, because its button shares a row with "Save as JSON Resume" and
 * its problem line is shared with the share-sheet path. Either way it is one
 * parser and one store, so a CV uploaded here is on every screen.
 *
 * Every outcome is on screen: the parser's own words for a file it refused,
 * a separate sentence for one that read but would not save, the warnings for
 * a CV that only partly read — and nothing at all for a cancelled dialog.
 * The button is never disabled by the screen around it: a machine with no AI
 * set up can still get its CV ready.
 */
export interface CvUploadProps {
  /** Prefixes every `data-testid`: `<prefix>-upload`, `<prefix>-upload-problem`, `<prefix>-cv-warnings`. */
  readonly idPrefix: string;
  readonly files: Pick<FilePort, 'pickCv'>;
  readonly saveCv: CvStorePort['saveCv'];
  /** Injected by tests so stored timestamps are deterministic. */
  readonly now?: Date | undefined;
  /** The CV just stored, so the screen can list and select it. */
  readonly onUploaded: (cv: Cv) => void;
}

/**
 * The upload and what it has to say (L-445): Tailor draws the button in its
 * line of choices and these words under the line, so the two halves live
 * apart. `CvUpload` below puts them back together for Profile.
 */
export function useCvUpload({ files, saveCv, now, onUploaded }: Omit<CvUploadProps, 'idPrefix'>) {
  const [problem, setProblem] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);

  const onUpload = useCallback(async () => {
    setProblem(null);
    const uploaded = await uploadCv(files, { saveCv, now: now ?? new Date() });
    if (!uploaded.ok) {
      setWarnings([]);
      setProblem(uploaded.error.message);
      return;
    }
    // Cancelled. Nothing happened, and nothing is said about it.
    if (uploaded.value === null) return;

    setWarnings(uploaded.value.warnings);
    onUploaded(uploaded.value.cv);
  }, [files, now, onUploaded, saveCv]);

  return { problem, warnings, onUpload };
}

/** The upload's problem line and the warnings for a CV that only partly read. */
export function CvUploadNotes({
  idPrefix,
  problem,
  warnings,
}: {
  readonly idPrefix: string;
  readonly problem: string | null;
  readonly warnings: readonly string[];
}) {
  return (
    <>
      {problem === null ? null : (
        <ErrorBox variant="box" gapAbove="mt-2" testId={`${idPrefix}-upload-problem`}>
          {problem}
        </ErrorBox>
      )}

      {warnings.length === 0 ? null : (
        <ul
          data-testid={`${idPrefix}-cv-warnings`}
          className="mt-2 space-y-1 rounded-control bg-gold/10 px-3 py-2 text-gold-ink"
        >
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export function CvUpload({ idPrefix, files, saveCv, now, onUploaded }: CvUploadProps) {
  const { problem, warnings, onUpload } = useCvUpload({ files, saveCv, now, onUploaded });

  return (
    <div>
      <button
        type="button"
        data-testid={`${idPrefix}-upload`}
        onClick={() => void onUpload()}
        className={SECONDARY_BUTTON}
      >
        Upload a CV
      </button>

      <CvUploadNotes idPrefix={idPrefix} problem={problem} warnings={warnings} />
    </div>
  );
}
