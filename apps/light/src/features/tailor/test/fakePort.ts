import {
  err,
  ok,
  type Application,
  type Cv,
  type Document,
  type Job,
  type Profile,
  type Result,
} from '@cviper/core-types';

import { type DbError } from '../../../db';
import { type TailorPort } from '../port';

/**
 * An in-memory `TailorPort`, for driving the tailor view in a test.
 *
 * Same reasoning as `features/analysis/test/fakePort.ts`: it satisfies the
 * same TypeScript interface the real port does, so a change to the real
 * port's shape stops this compiling, and it can fail on purpose so the
 * "could not be saved" branches are exercised.
 */

type Method =
  | 'loadCvs'
  | 'saveCv'
  | 'loadJobs'
  | 'loadApplicationsFor'
  | 'profile'
  | 'saveDocument'
  | 'loadDocumentsFor'
  | 'createApplication';

export interface FakeTailorPort extends TailorPort {
  /** Every CV currently "stored", including any correction (L-218). */
  readonly storedCvs: () => readonly Cv[];
  /** Every document currently "stored", newest first. */
  readonly storedDocuments: () => readonly Document[];
  /** Every application currently "stored", including any this screen created. */
  readonly storedApplications: () => readonly Application[];
  /** Make the next call to the named method fail. */
  readonly failNext: (method: Method) => void;
  readonly calls: Record<Method, number>;
}

const FAILURE: DbError = {
  code: 'QUERY_FAILED',
  message: 'The database is locked by another copy of CViper.',
  table: 'documents',
};

export function createFakeTailorPort(
  initial: {
    cvs?: readonly Cv[];
    jobs?: readonly Job[];
    applications?: readonly Application[];
    profile?: Profile | null;
    documents?: readonly Document[];
  } = {},
): FakeTailorPort {
  let cvs: Cv[] = [...(initial.cvs ?? [])];
  const jobs: Job[] = [...(initial.jobs ?? [])];
  const applications: Application[] = [...(initial.applications ?? [])];
  const profile: Profile | null = initial.profile ?? null;
  let documents: Document[] = [...(initial.documents ?? [])];

  const failing = new Set<Method>();
  const calls: Record<Method, number> = {
    loadCvs: 0,
    saveCv: 0,
    loadJobs: 0,
    loadApplicationsFor: 0,
    profile: 0,
    saveDocument: 0,
    loadDocumentsFor: 0,
    createApplication: 0,
  };

  function failure(method: Method): Result<never, DbError> | null {
    if (!failing.has(method)) return null;
    failing.delete(method);
    return err(FAILURE);
  }

  return {
    calls,
    storedCvs: () => cvs,
    storedDocuments: () => documents,
    storedApplications: () => applications,
    failNext: (method) => failing.add(method),

    async loadCvs() {
      calls.loadCvs += 1;
      return failure('loadCvs') ?? ok([...cvs]);
    },

    async saveCv(cv) {
      calls.saveCv += 1;
      const refused = failure('saveCv');
      if (refused !== null) return refused;
      cvs = cvs.map((candidate) => (candidate.id === cv.id ? cv : candidate));
      return ok(undefined);
    },

    async loadJobs() {
      calls.loadJobs += 1;
      return failure('loadJobs') ?? ok([...jobs]);
    },

    async loadApplicationsFor(jobId) {
      calls.loadApplicationsFor += 1;
      return (
        failure('loadApplicationsFor') ??
        ok(applications.filter((application) => application.job_id === jobId))
      );
    },

    async profile() {
      calls.profile += 1;
      return failure('profile') ?? ok(profile);
    },

    async saveDocument(document) {
      calls.saveDocument += 1;
      const refused = failure('saveDocument');
      if (refused !== null) return refused;
      documents = [document, ...documents.filter((candidate) => candidate.id !== document.id)];
      return ok(undefined);
    },

    async createApplication(application) {
      calls.createApplication += 1;
      const refused = failure('createApplication');
      if (refused !== null) return refused;
      applications.push(application);
      return ok(undefined);
    },

    async loadDocumentsFor(applicationId) {
      calls.loadDocumentsFor += 1;
      return (
        failure('loadDocumentsFor') ??
        ok(documents.filter((document) => document.application_id === applicationId))
      );
    },
  };
}
