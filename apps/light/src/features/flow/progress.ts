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
import {
  listAnalyses,
  listApplications,
  listDocuments,
  listDocumentsForApplication,
} from '../../db';

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

/** Every job's saved progress at once — the tracker board's cards (L-200). */
export interface BoardProgressPort {
  /** Keyed by job id. A job with nothing saved has no entry. */
  loadAll(): Promise<ReadonlyMap<string, SavedProgress>>;
}

/**
 * Three reads for the whole board, not three per card: every analysis, every
 * application and every document, joined here. Any read that fails leaves
 * its half out — the cards lose a ✓, never the board.
 */
export function createDbBoardProgressPort(): BoardProgressPort {
  return {
    async loadAll() {
      const [analyses, applications, documents] = await Promise.all([
        listAnalyses(),
        listApplications(),
        listDocuments(),
      ]);
      const progress = new Map<string, SavedProgress>();
      const mark = (jobId: string, change: Partial<SavedProgress>) =>
        progress.set(jobId, { ...(progress.get(jobId) ?? NO_SAVED_PROGRESS), ...change });

      if (analyses.ok) {
        for (const analysis of analyses.value) {
          if (analysis.job_id !== null) mark(analysis.job_id, { analysed: true });
        }
      }
      if (applications.ok && documents.ok) {
        const jobOf = new Map(applications.value.map((app) => [app.id, app.job_id]));
        for (const document of documents.value) {
          const jobId = jobOf.get(document.application_id);
          if (document.kind === 'cv' && jobId !== undefined) mark(jobId, { exported: true });
        }
      }
      return progress;
    },
  };
}
