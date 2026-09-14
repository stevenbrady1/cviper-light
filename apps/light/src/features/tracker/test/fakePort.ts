import {
  err,
  ok,
  type Application,
  type Document,
  type Profile,
  type Result,
} from '@cviper/core-types';

import { type DbError } from '../../../db';
import { type TrackerEntry } from '../model';
import { type TrackerPort } from '../port';

/**
 * An in-memory `TrackerPort`, for driving the board in a test.
 *
 * ============================================================================
 * WHY NOT MOCK SQLITE
 * ============================================================================
 * The alternative is stubbing `tauri-plugin-sql` and answering SELECTs with
 * hand-written rows, which is a test of the stub. The port exists precisely so
 * the board can be exercised against something that satisfies the SAME
 * TypeScript interface the real one does — so if the real port's shape changes,
 * this stops compiling.
 *
 * `port.test.ts` covers the other half: that `createDbTrackerPort` calls the
 * right data-layer functions, in the right order.
 *
 * ============================================================================
 * IT CAN FAIL ON PURPOSE
 * ============================================================================
 * `failNext` makes the next write return a `DbError`, which is how the board's
 * "the change did not stick" path gets tested. A port that can only succeed
 * would leave every error branch in the tracker unexercised.
 */

type PortMethod =
  'load' | 'create' | 'saveApplication' | 'remove' | 'documentsFor' | 'saveDocument' | 'profile';

export interface FakeTrackerPort extends TrackerPort {
  /** Everything currently "stored". */
  readonly entries: () => readonly TrackerEntry[];
  /** Every document currently "archived", in the order they were saved. */
  readonly documents: () => readonly Document[];
  /** Make the next call to the named method fail. */
  readonly failNext: (method: PortMethod) => void;
  /** How many times each method has been called. */
  readonly calls: Record<PortMethod, number>;
}

/** What else the fake starts with. Both optional, both empty by default. */
export interface FakePortSeed {
  readonly documents?: readonly Document[] | undefined;
  readonly profile?: Profile | null | undefined;
}

const FAILURE: DbError = {
  code: 'QUERY_FAILED',
  message: 'The database is locked by another copy of CViper.',
  table: 'applications',
};

export function createFakeTrackerPort(
  initial: readonly TrackerEntry[] = [],
  seed: FakePortSeed = {},
): FakeTrackerPort {
  let stored: TrackerEntry[] = [...initial];
  let documents: Document[] = [...(seed.documents ?? [])];
  const profile: Profile | null = seed.profile ?? null;
  const failing = new Set<string>();
  const calls: Record<PortMethod, number> = {
    load: 0,
    create: 0,
    saveApplication: 0,
    remove: 0,
    documentsFor: 0,
    saveDocument: 0,
    profile: 0,
  };

  function checkFailure(method: string): Result<void, DbError> | null {
    if (!failing.has(method)) return null;
    failing.delete(method);
    return err(FAILURE);
  }

  return {
    calls,
    entries: () => stored,
    documents: () => documents,
    failNext: (method) => failing.add(method),

    async load() {
      calls.load += 1;
      const failure = checkFailure('load');
      if (failure !== null) return err(FAILURE);
      return ok([...stored]);
    },

    async create(entry: TrackerEntry) {
      calls.create += 1;
      const failure = checkFailure('create');
      if (failure !== null) return failure;
      stored = [...stored, entry];
      return ok(undefined);
    },

    async saveApplication(application: Application) {
      calls.saveApplication += 1;
      const failure = checkFailure('saveApplication');
      if (failure !== null) return failure;
      stored = stored.map((entry) =>
        entry.application.id === application.id ? { ...entry, application } : entry,
      );
      return ok(undefined);
    },

    async remove(entry: TrackerEntry) {
      calls.remove += 1;
      const failure = checkFailure('remove');
      if (failure !== null) return failure;
      stored = stored.filter((candidate) => candidate.application.id !== entry.application.id);
      return ok(undefined);
    },

    async documentsFor(applicationId: string) {
      calls.documentsFor += 1;
      const failure = checkFailure('documentsFor');
      if (failure !== null) return err(FAILURE);
      return ok(documents.filter((document) => document.application_id === applicationId));
    },

    async saveDocument(document: Document) {
      calls.saveDocument += 1;
      const failure = checkFailure('saveDocument');
      if (failure !== null) return failure;
      documents = [...documents.filter((existing) => existing.id !== document.id), document];
      return ok(undefined);
    },

    async profile() {
      calls.profile += 1;
      const failure = checkFailure('profile');
      if (failure !== null) return err(FAILURE);
      return ok(profile);
    },
  };
}
