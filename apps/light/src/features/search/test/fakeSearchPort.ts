import { ok, type Job, type Result } from '@cviper/core-types';
import {
  findCrossPostClusters,
  type JobSearchOutcome,
  type JobSearchRequest,
  type ProviderOutcome,
  type SearchResultJob,
} from '@cviper/job-apis';

import { type DbError } from '../../../db';
import { externalKey } from '../model';
import { type SaveOutcome, type SearchPort } from '../port';

/**
 * An in-memory `SearchPort`, for driving the screen in a test.
 *
 * ============================================================================
 * THE STORE IS REAL, AND IT ENFORCES THE REAL RULE
 * ============================================================================
 * `saveToTracker` keys adverts by `source:external_id` exactly as the partial
 * unique index does, so "saving the same advert twice does not duplicate it" is
 * a fact about a round trip rather than a fact about a mock's call count. A
 * fake that simply pushed onto an array would let that test pass while the real
 * database threw a constraint violation at the user.
 *
 * `port.test.ts` covers the other half: that `createDbSearchPort` calls the
 * right data-layer functions in the right order.
 */

export interface FakeSearchPort extends SearchPort {
  /** Every search request the screen actually sent. */
  readonly requests: () => readonly JobSearchRequest[];
  /** What the next search resolves with. */
  readonly nextOutcome: (outcome: JobSearchOutcome) => void;
  /** Everything currently "on the tracker board". */
  readonly savedJobs: () => readonly Job[];
  /** Make the next call to the named method fail. */
  readonly failNext: (method: 'loadTracked' | 'saveToTracker') => void;
  readonly calls: Record<'search' | 'loadTracked' | 'saveToTracker', number>;
}

const FAILURE: DbError = {
  code: 'QUERY_FAILED',
  message: 'The database is locked by another copy of CViper.',
  table: 'jobs',
};

/** An outcome with no adverts and no errors — what an empty search looks like. */
export function emptyOutcome(quota: JobSearchOutcome['quota']): JobSearchOutcome {
  return { outcomes: [], jobs: [], clusters: [], quota };
}

/**
 * Build an outcome the way `searchJobs` would, including its clustering.
 *
 * The REAL `findCrossPostClusters` runs over the adverts, so a test that
 * asserts "2 similar postings" is asserting the shipped fingerprint rule rather
 * than a hand-written cluster list that agrees with itself.
 */
export function outcomeOf(
  entries: readonly SearchResultJob[],
  quota: JobSearchOutcome['quota'],
  errors: readonly ProviderOutcome[] = [],
): JobSearchOutcome {
  const byProvider = new Map<ProviderOutcome['provider'], SearchResultJob[]>();
  for (const entry of entries) {
    const source = entry.job.source === 'adzuna' ? 'adzuna' : 'reed';
    const bucket = byProvider.get(source) ?? [];
    bucket.push(entry);
    byProvider.set(source, bucket);
  }

  const outcomes: ProviderOutcome[] = [...byProvider.entries()].map(([provider, jobs]) => ({
    provider,
    jobs,
    error: null,
  }));

  return {
    outcomes: [...outcomes, ...errors],
    jobs: entries,
    clusters: findCrossPostClusters(entries.map((entry) => entry.job)),
    quota,
  };
}

export function createFakeSearchPort(initial: readonly Job[] = []): FakeSearchPort {
  let stored: Job[] = [...initial];
  const sent: JobSearchRequest[] = [];
  const failing = new Set<'loadTracked' | 'saveToTracker'>();
  const calls = { search: 0, loadTracked: 0, saveToTracker: 0 };

  let outcome: JobSearchOutcome | null = null;

  function refuses(method: 'loadTracked' | 'saveToTracker'): boolean {
    if (!failing.has(method)) return false;
    failing.delete(method);
    return true;
  }

  return {
    calls,
    requests: () => sent,
    savedJobs: () => stored,
    nextOutcome: (next) => {
      outcome = next;
    },
    failNext: (method) => failing.add(method),

    async search(request) {
      calls.search += 1;
      sent.push(request);
      return outcome ?? emptyOutcome(request.quota);
    },

    async loadTracked(): Promise<Result<ReadonlySet<string>, DbError>> {
      calls.loadTracked += 1;
      if (refuses('loadTracked')) return { ok: false, error: FAILURE };

      const tracked = new Set<string>();
      for (const job of stored) {
        const key = externalKey(job.source, job.external_id);
        if (key !== null) tracked.add(key);
      }
      return ok(tracked);
    },

    async saveToTracker(job): Promise<Result<SaveOutcome, DbError>> {
      calls.saveToTracker += 1;
      if (refuses('saveToTracker')) return { ok: false, error: FAILURE };

      // The partial unique index, in eight lines. The same advert can only be
      // stored once, whatever id this search happened to give it.
      const key = externalKey(job.source, job.external_id);
      if (key !== null) {
        const already = stored.some(
          (candidate) => externalKey(candidate.source, candidate.external_id) === key,
        );
        if (already) return ok('already-saved');
      }

      stored = [...stored, job];
      return ok('saved');
    },
  };
}
