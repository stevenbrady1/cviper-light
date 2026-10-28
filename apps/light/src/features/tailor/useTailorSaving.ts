import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

import { type Application, type Cv, type Job } from '@cviper/core-types';

import { type FilePort } from '../../platform/files';
import { type SavedProgress } from '../flow/progress';

import { type LetterResult, type TailorResult } from './jobSessions';
import {
  documentTitle,
  editedAdvertTitle,
  exportFileName,
  newDocument,
  newSavedApplication,
  savedMessage,
} from './model';
import { buildCoverLetterPdf, buildCvPdf } from './pdf';
import { type TailorPort } from './port';

export interface TailorSavingInput {
  readonly tailorPort: TailorPort;
  readonly files: FilePort;
  readonly now: Date | undefined;
  readonly result: TailorResult | null;
  readonly letter: LetterResult | null;
  readonly jobText: string;
  readonly jobTitle: string;
  readonly advertEdited: boolean;
  readonly selectedJob: Job | null;
  readonly selectedApplicationId: string | null;
  readonly setApplications: Dispatch<SetStateAction<readonly Application[]>>;
  readonly setSelectedApplicationId: Dispatch<SetStateAction<string | null>>;
  readonly setCvs: Dispatch<SetStateAction<readonly Cv[]>>;
  readonly setSaved: Dispatch<SetStateAction<SavedProgress>>;
  readonly setError: (message: string | null) => void;
  readonly setSaveMessage: (message: string | null) => void;
}

/**
 * Every save on the Tailor screen: into an application, a corrected CV, and
 * the text, Word and PDF files.
 *
 * `saving` says which is running, one at a time. A file save is mostly the
 * user choosing a place in the save window, so the screen says that rather
 * than "Saving…" — which used to appear on "Save to an application" for every
 * save, pointing at the wrong button (L-217).
 */
export function useTailorSaving({
  tailorPort,
  files,
  now,
  result,
  letter,
  jobText,
  jobTitle,
  advertEdited,
  selectedJob,
  selectedApplicationId,
  setApplications,
  setSelectedApplicationId,
  setCvs,
  setSaved,
  setError,
  setSaveMessage,
}: TailorSavingInput) {
  const [saving, setSaving] = useState<'application' | 'file' | null>(null);

  const onSaveToApplication = useCallback(async () => {
    if (result === null) return;
    // A paste has no job, so no application to save into. A tracked job with
    // none gets one, below: the user should never be sent to the tracker first.
    if (selectedApplicationId === null && selectedJob === null) return;
    setError(null);
    setSaveMessage(null);
    setSaving('application');

    const stamp = (now ?? new Date()).toISOString();

    let applicationId = selectedApplicationId;
    if (applicationId === null && selectedJob !== null) {
      const application = newSavedApplication({
        id: crypto.randomUUID(),
        jobId: selectedJob.id,
        now: stamp,
      });
      const created = await tailorPort.createApplication(application);
      if (!created.ok) {
        setSaving(null);
        setError(`The tailored CV could not be saved: ${created.error.message}`);
        return;
      }
      setApplications([application]);
      setSelectedApplicationId(application.id);
      applicationId = application.id;
    }
    if (applicationId === null) return;

    const saved = await tailorPort.saveDocument(
      newDocument({
        id: crypto.randomUUID(),
        applicationId,
        kind: 'cv',
        title: documentTitle('cv', jobTitle),
        text: result.text,
        now: stamp,
      }),
    );
    if (!saved.ok) {
      setSaving(null);
      setError(`The tailored CV could not be saved: ${saved.error.message}`);
      return;
    }

    // The CV was written for THIS text, so the record keeps it (L-199, owner
    // decision 2026-10-01): an edited advert is saved beside the CV, marked.
    let advertSaved = false;
    if (advertEdited) {
      const savedAdvert = await tailorPort.saveDocument(
        newDocument({
          id: crypto.randomUUID(),
          applicationId,
          kind: 'advert',
          title: editedAdvertTitle(jobTitle),
          text: jobText,
          now: stamp,
        }),
      );
      if (!savedAdvert.ok) {
        setSaving(null);
        setError(`The CV was saved, but the edited advert was not: ${savedAdvert.error.message}`);
        return;
      }
      advertSaved = true;
    }

    let letterSaved = false;
    if (letter !== null) {
      const savedLetter = await tailorPort.saveDocument(
        newDocument({
          id: crypto.randomUUID(),
          applicationId,
          kind: 'cover_letter',
          title: documentTitle('cover_letter', jobTitle),
          text: letter.text,
          now: stamp,
        }),
      );
      if (!savedLetter.ok) {
        setSaving(null);
        setError(`The CV was saved, but the letter was not: ${savedLetter.error.message}`);
        return;
      }
      letterSaved = true;
    }

    setSaving(null);
    setSaveMessage(savedMessage({ advert: advertSaved, letter: letterSaved }));
    setSaved((current) => ({ ...current, exported: true }));
  }, [
    advertEdited,
    jobText,
    jobTitle,
    letter,
    now,
    result,
    selectedApplicationId,
    selectedJob,
    setApplications,
    setError,
    setSaveMessage,
    setSaved,
    setSelectedApplicationId,
    tailorPort,
  ]);

  /** Store a corrected (or restored) CV, and show it at once (L-218). */
  const onSaveCv = useCallback(
    async (next: Cv): Promise<string | null> => {
      const saved = await tailorPort.saveCv(next);
      if (!saved.ok) return `That could not be saved: ${saved.error.message}`;
      setCvs((current) => current.map((cv) => (cv.id === next.id ? next : cv)));
      return null;
    },
    [setCvs, tailorPort],
  );

  const onSaveText = useCallback(
    async (kind: 'cv' | 'cover_letter') => {
      const text = kind === 'cv' ? result?.text : letter?.text;
      if (text === undefined) return;
      setError(null);
      setSaveMessage(null);
      setSaving('file');

      const saved = await files.saveText(text, exportFileName(kind, jobTitle), 'txt');
      setSaving(null);

      if (!saved.ok) {
        setError(`That could not be saved: ${saved.error.message}`);
        return;
      }
      // Cancelled. Nothing was written, and nothing is said about it.
      if (saved.value === null) return;
      setSaveMessage(`Saved to ${saved.value}.`);
    },
    [files, jobTitle, letter, result, setError, setSaveMessage],
  );

  // The Word (L-165) and PDF (L-201) exports: the same structured result the
  // text render reads, built into a file on this machine and handed to the
  // same dialog-in-Rust save. Success and cancel are worded exactly as the
  // text path's, so the buttons side by side behave as one feature.
  const onSaveDocument = useCallback(
    async (kind: 'cv' | 'cover_letter', format: 'docx' | 'pdf') => {
      // `null` for the name: the app never asks the model for one, and this
      // screen has nothing else to offer (see `renderTailoredCv`).
      const build = async (): Promise<{ bytes: Uint8Array; missing: readonly string[] }> => {
        // The Word builder (`docx` + `jszip`, ~400 kB) is loaded on the first
        // Word export, not at launch: `word-code-loads-on-demand.contract.test.ts`.
        if (kind === 'cv' && result !== null) {
          if (format === 'pdf') return buildCvPdf(result.cv, null);
          const { buildCvDocx } = await import('./docx');
          return { bytes: await buildCvDocx(result.cv, null), missing: [] };
        }
        if (kind === 'cover_letter' && letter !== null) {
          if (format === 'pdf') return buildCoverLetterPdf(letter.letter);
          const { buildCoverLetterDocx } = await import('./docx');
          return { bytes: await buildCoverLetterDocx(letter.letter), missing: [] };
        }
        throw new Error('nothing to export');
      };
      if ((kind === 'cv' ? result : letter) === null) return;
      setError(null);
      setSaveMessage(null);
      setSaving('file');

      let built: { bytes: Uint8Array; missing: readonly string[] };
      try {
        built = await build();
      } catch {
        // The builder runs over our own validated result, so this is our bug;
        // it still ends in a sentence on screen rather than a stuck spinner.
        setSaving(null);
        setError('That document could not be built. Try running the tailoring again.');
        return;
      }

      const saved = await files.saveBytes(
        built.bytes,
        exportFileName(kind, jobTitle, format),
        format,
      );
      setSaving(null);

      if (!saved.ok) {
        setError(`That could not be saved: ${saved.error.message}`);
        return;
      }
      if (saved.value === null) return;
      setSaveMessage(
        built.missing.length === 0
          ? `Saved to ${saved.value}.`
          : `Saved to ${saved.value}. The PDF's built-in font cannot show ` +
              `${built.missing.join(' ')}, so they appear as ? or a plain letter. ` +
              'Save as Word to keep them exactly.',
      );
    },
    [files, jobTitle, letter, result, setError, setSaveMessage],
  );

  return { saving, onSaveToApplication, onSaveCv, onSaveText, onSaveDocument };
}
