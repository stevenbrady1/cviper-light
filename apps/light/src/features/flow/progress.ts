/**
 * How far one job has got, as far as the database can say (L-200).
 *
 * Two of the step bar's answers live in SQLite: whether the job has an
 * analysis saved against it, and whether a tailored CV has been saved to one
 * of its applications. The third — whether there is a draft — is the Tailor
 * session's, and the view that shows the bar adds it.
 *
 * A HINT, NOT A GATE. Steps are never locked, so a failed read costs nothing
 * but a ✓: it reads as "not done", and the user can still go anywhere.
 */
import { listAnalyses, listApplications, listDocumentsForApplication } from '../../db';

export interface SavedProgress {
  readonly analysed: boolean;
  readonly exported: boolean;
}

export const NO_SAVED_PROGRESS: SavedProgress = { analysed: false, exported: false };

export interface JobProgressPort {
  load(jobId: string): Promise<SavedProgress>;
}

export function createDbJobProgressPort(): JobProgressPort {
  return {
    async load(jobId) {
      const [analyses, applications] = await Promise.all([listAnalyses(), listApplications()]);
      const analysed = analyses.ok && analyses.value.some((analysis) => analysis.job_id === jobId);
      if (!applications.ok) return { analysed, exported: false };

      for (const application of applications.value) {
        if (application.job_id !== jobId) continue;
        const documents = await listDocumentsForApplication(application.id);
        if (documents.ok && documents.value.some((document) => document.kind === 'cv')) {
          return { analysed, exported: true };
        }
      }
      return { analysed, exported: false };
    },
  };
}
