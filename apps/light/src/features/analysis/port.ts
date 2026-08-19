/**
 * The five things the analysis view does to storage, and nothing else.
 *
 * Same reasoning as `features/tracker/port.ts`: `src/db` talks to
 * `tauri-plugin-sql`, which needs a Tauri runtime a Vitest process does not
 * have, so a component that imported it directly could only be tested by
 * pretending to be SQLite. And naming the view's whole appetite for storage in
 * one place means adding a sixth call is a decision somebody makes on purpose.
 *
 * No SQL, and no SQL-shaped thinking, reaches a component.
 */
import {
  listAnalysesForCv,
  listCvs,
  listJobs,
  upsertAnalysis,
  upsertCv,
  type DbError,
} from '../../db';
import { type Analysis, type Cv, type Job, type Result } from '@cviper/core-types';

export interface AnalysisPort {
  /** Every CV the user has uploaded, newest first. */
  loadCvs(): Promise<Result<Cv[], DbError>>;
  /**
   * Every job on the tracker board, so an advert already saved can be reused
   * instead of pasted again.
   */
  loadJobs(): Promise<Result<Job[], DbError>>;
  saveCv(cv: Cv): Promise<Result<void, DbError>>;
  /** Past analyses of ONE CV, newest first. */
  loadHistory(cvId: string): Promise<Result<Analysis[], DbError>>;
  saveAnalysis(analysis: Analysis): Promise<Result<void, DbError>>;
}

export function createDbAnalysisPort(): AnalysisPort {
  return {
    loadCvs: listCvs,
    loadJobs: listJobs,
    saveCv: upsertCv,
    loadHistory: listAnalysesForCv,
    saveAnalysis: upsertAnalysis,
  };
}
