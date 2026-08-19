import { err, ok, type Analysis, type Cv, type Job, type Result } from '@cviper/core-types';

import { type DbError } from '../../../db';
import { type AnalysisPort } from '../port';

/**
 * An in-memory `AnalysisPort`, for driving the analysis view in a test.
 *
 * Same reasoning as `features/tracker/test/fakePort.ts`: the alternative is
 * stubbing `tauri-plugin-sql` and answering SELECTs with hand-written rows,
 * which tests the stub. This satisfies the same TypeScript interface the real
 * port does, so a change to the real port's shape stops this compiling.
 *
 * It can fail on purpose. A port that could only succeed would leave every
 * "that could not be saved" branch in the view unexercised — and those are the
 * branches a user meets on the day their disk fills up.
 */

type Method = 'loadCvs' | 'loadJobs' | 'saveCv' | 'loadHistory' | 'saveAnalysis';

export interface FakeAnalysisPort extends AnalysisPort {
  /** Every CV currently "stored", newest first. */
  readonly storedCvs: () => readonly Cv[];
  /** Every analysis currently "stored", newest first. */
  readonly storedAnalyses: () => readonly Analysis[];
  /** Make the next call to the named method fail. */
  readonly failNext: (method: Method) => void;
  readonly calls: Record<Method, number>;
}

const FAILURE: DbError = {
  code: 'QUERY_FAILED',
  message: 'The database is locked by another copy of CViper.',
  table: 'cvs',
};

export function createFakeAnalysisPort(
  initial: { cvs?: readonly Cv[]; jobs?: readonly Job[]; analyses?: readonly Analysis[] } = {},
): FakeAnalysisPort {
  let cvs: Cv[] = [...(initial.cvs ?? [])];
  let analyses: Analysis[] = [...(initial.analyses ?? [])];
  const jobs: Job[] = [...(initial.jobs ?? [])];

  const failing = new Set<Method>();
  const calls: Record<Method, number> = {
    loadCvs: 0,
    loadJobs: 0,
    saveCv: 0,
    loadHistory: 0,
    saveAnalysis: 0,
  };

  function failure(method: Method): Result<never, DbError> | null {
    if (!failing.has(method)) return null;
    failing.delete(method);
    return err(FAILURE);
  }

  return {
    calls,
    storedCvs: () => cvs,
    storedAnalyses: () => analyses,
    failNext: (method) => failing.add(method),

    async loadCvs() {
      calls.loadCvs += 1;
      return failure('loadCvs') ?? ok([...cvs]);
    },

    async loadJobs() {
      calls.loadJobs += 1;
      return failure('loadJobs') ?? ok([...jobs]);
    },

    async saveCv(cv) {
      calls.saveCv += 1;
      const refused = failure('saveCv');
      if (refused !== null) return refused;
      cvs = [cv, ...cvs.filter((candidate) => candidate.id !== cv.id)];
      return ok(undefined);
    },

    async loadHistory(cvId) {
      calls.loadHistory += 1;
      return failure('loadHistory') ?? ok(analyses.filter((analysis) => analysis.cv_id === cvId));
    },

    async saveAnalysis(analysis) {
      calls.saveAnalysis += 1;
      const refused = failure('saveAnalysis');
      if (refused !== null) return refused;
      analyses = [analysis, ...analyses.filter((candidate) => candidate.id !== analysis.id)];
      return ok(undefined);
    },
  };
}
