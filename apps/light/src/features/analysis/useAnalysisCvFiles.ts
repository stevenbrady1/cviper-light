import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { type Cv, type Result } from '@cviper/core-types';

import { type FileError, type FilePort, type PickedCv } from '../../platform/files';
import { ingestCv, uploadCv, type IngestedCv, type IngestProblem } from '../cv/ingestCv';
import { APP_NAME } from '../settings/backup';

import { exportJsonResume, jsonResumeFileName } from './model';
import { type AnalysisPort } from './port';
import { type AnalysisSession } from './session';

export interface AnalysisCvFilesInput {
  readonly analysisPort: AnalysisPort;
  readonly files: FilePort;
  readonly now: Date | undefined;
  readonly session: AnalysisSession;
  readonly selectedCv: Cv | null;
  /** A CV the OS asked the app to open (L-83), or the refusal Rust gave it. */
  readonly incomingCv: Result<PickedCv, FileError> | null | undefined;
  readonly onIncomingCvHandled: (() => void) | undefined;
  readonly setCvs: Dispatch<SetStateAction<readonly Cv[]>>;
  readonly setError: (message: string | null) => void;
}

/**
 * CV files in and out of the Analysis screen: an upload, a file the OS opened
 * for us, and the JSON Resume export — with what each one says on screen.
 */
export function useAnalysisCvFiles({
  analysisPort,
  files,
  now,
  session,
  selectedCv,
  incomingCv,
  onIncomingCvHandled,
  setCvs,
  setError,
}: AnalysisCvFilesInput) {
  /** "Saved to …" after a JSON Resume export (L-20b). */
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [uploadProblem, setUploadProblem] = useState<string | null>(null);

  /** What an upload came to — a stored CV, a message, or (cancelled) nothing — on screen. */
  const settle = useCallback(
    (ingested: Result<IngestedCv | null, IngestProblem>) => {
      if (!ingested.ok) {
        if (ingested.error.kind === 'not-saved') {
          setError(ingested.error.message);
          return;
        }
        // VERBATIM. Every message in `@cviper/cv-parsing` says what happened,
        // why, and what to do — "that PDF has 2 pages but no readable text at
        // all, which means it is almost certainly a scan". Replacing that with
        // "could not read file" throws away the only useful thing on the
        // screen.
        setUploadProblem(ingested.error.message);
        session.update({ warnings: [] });
        return;
      }
      // Cancelled. Nothing happened, and nothing is said about it.
      if (ingested.value === null) return;

      const { cv, warnings: cvWarnings } = ingested.value;
      setCvs((current) => [cv, ...current]);
      // A run still in flight was for the previous CV: its answer is dropped.
      session.supersede();
      session.update({
        selectedCvId: cv.id,
        result: null,
        runError: null,
        // Warnings ride along with a SUCCESSFUL extraction — some pages were
        // images and their contents are missing from the text. The user has to
        // be told, because the analysis below is about to be run on a partial CV.
        warnings: cvWarnings,
      });
      setExportMessage(null);
    },
    [session, setCvs, setError],
  );

  /** The same CV store, the same parser, as every other screen's upload (L-240). */
  const ingestDeps = useMemo(
    () => ({ saveCv: (cv: Cv) => analysisPort.saveCv(cv), now: now ?? new Date() }),
    [analysisPort, now],
  );

  /**
   * A file's bytes, wherever they came from — the dialog or the share sheet —
   * become a CV row, or a message.
   */
  const ingest = useCallback(
    async (picked: PickedCv) => settle(await ingestCv(picked, ingestDeps)),
    [ingestDeps, settle],
  );

  /**
   * Save the selected CV back out as the JSON Resume it arrived as (L-20b).
   *
   * Only reachable when `selectedCv.json_resume` is a string — the button is
   * disabled otherwise — but `exportJsonResume` re-checks, because a disabled
   * button is a UI fact and this is a data one.
   */
  const onSaveJsonResume = useCallback(async () => {
    if (selectedCv === null) return;
    setError(null);
    setExportMessage(null);

    const text = exportJsonResume({
      cv: selectedCv,
      app: APP_NAME,
      exportedAt: (now ?? new Date()).toISOString(),
    });
    if (!text.ok) {
      setError(text.error.message);
      return;
    }

    setExporting(true);
    const saved = await files.saveCvJson(text.value, jsonResumeFileName(selectedCv.name));
    setExporting(false);

    if (!saved.ok) {
      setError(`That CV could not be saved as a JSON Resume: ${saved.error.message}`);
      return;
    }
    // Cancelled. Nothing was written, and nothing is said about it.
    if (saved.value === null) return;

    setExportMessage(
      `Saved to ${saved.value}. The file is the one that came in, with a note of when it left.`,
    );
  }, [files, now, selectedCv, setError]);

  const onUpload = useCallback(async () => {
    setError(null);
    setUploadProblem(null);
    settle(await uploadCv(files, ingestDeps));
  }, [files, ingestDeps, setError, settle]);

  // A file the OS opened for us (L-83). Same path as a pick from here on.
  useEffect(() => {
    if (incomingCv === undefined || incomingCv === null) return;

    let cancelled = false;
    setError(null);
    setUploadProblem(null);

    void (async () => {
      if (!incomingCv.ok) {
        setUploadProblem(incomingCv.error.message);
        session.update({ warnings: [] });
      } else {
        await ingest(incomingCv.value);
      }
      if (!cancelled) onIncomingCvHandled?.();
    })();

    return () => {
      cancelled = true;
    };
  }, [incomingCv, ingest, onIncomingCvHandled, session, setError]);

  /** Another CV was picked: what was said about the last one no longer applies. */
  const clearCvMessages = useCallback(() => {
    setUploadProblem(null);
    setExportMessage(null);
  }, []);

  return {
    exportMessage,
    exporting,
    uploadProblem,
    clearCvMessages,
    onUpload,
    onSaveJsonResume,
  };
}
