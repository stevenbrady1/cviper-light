import { ok, type Job, type Result } from '@cviper/core-types';
import {
  browseKeylessJobs,
  findCrossPostClusters,
  type JobSearchOutcome,
  type JobSearchRequest,
  type KeylessBrowseOutcome,
  type KeylessBrowseRequest,
  type KeylessFetchTransport,
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
  /** Every keyless browse the screen actually asked for. */
  readonly browses: () => readonly KeylessBrowseRequest[];
  /** What the next search resolves with. */
  readonly nextOutcome: (outcome: JobSearchOutcome) => void;
  /** Everything currently "on the tracker board". */
  readonly savedJobs: () => readonly Job[];
  /** What `latestCvText` answers. Set BEFORE rendering: the screen reads it once, on mount. */
  readonly nextCvText: (text: string | null) => void;
  /** What `dealBreakers` answers. Set BEFORE rendering, for the same reason. */
  readonly nextDealBreakers: (entries: readonly string[]) => void;
  /** Make the next call to the named method fail. */
  readonly failNext: (method: FailableMethod) => void;
  readonly calls: Record<
    'search' | 'browseKeyless' | 'loadTracked' | 'saveToTracker' | 'latestCvText' | 'dealBreakers',
    number
  >;
}

type FailableMethod = 'loadTracked' | 'saveToTracker' | 'latestCvText' | 'dealBreakers';

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

/**
 * An in-memory `SearchPort`.
 *
 * ============================================================================
 * THE KEYLESS HALF RUNS THE REAL CODE WHEN IT IS GIVEN A TRANSPORT
 * ============================================================================
 * Pass `keylessTransport` and `browseKeyless` runs the SHIPPED
 * `browseKeylessJobs` against the recorded bodies it hands back — real
 * parsing, real filtering, and above all the real decision about whether a
 * feed failed or simply matched nothing. A fake that returned a hand-built
 * outcome would let a test assert "the error is shown" while the code that
 * decides there IS an error went untested, which is precisely the shape of
 * guard this repository keeps finding it has.
 *
 * With no transport it answers "nothing came back and nothing failed", which
 * is what the keyed-path tests want: they are about the other half of the
 * screen, and two error lines appearing in all of them would be noise.
 */
export function createFakeSearchPort(
  initial: readonly Job[] = [],
  keylessTransport?: KeylessFetchTransport,
): FakeSearchPort {
  let stored: Job[] = [...initial];
  const sent: JobSearchRequest[] = [];
  const browsed: KeylessBrowseRequest[] = [];
  const failing = new Set<FailableMethod>();
  const calls = {
    search: 0,
    browseKeyless: 0,
    loadTracked: 0,
    saveToTracker: 0,
    latestCvText: 0,
    dealBreakers: 0,
  };

  let outcome: JobSearchOutcome | null = null;
  // No CV and no profile by default: every user's first launch, and what the
  // tests about the other half of the screen want — no pills in the way.
  let cvText: string | null = null;
  let dealBreakers: readonly string[] = [];

  function refuses(method: FailableMethod): boolean {
    if (!failing.has(method)) return false;
    failing.delete(method);
    return true;
  }

  return {
    calls,
    requests: () => sent,
    browses: () => browsed,
    savedJobs: () => stored,
    nextOutcome: (next) => {
      outcome = next;
    },
    failNext: (method) => failing.add(method),
    nextCvText: (text) => {
      cvText = text;
    },
    nextDealBreakers: (entries) => {
      dealBreakers = entries;
    },

    async search(request) {
      calls.search += 1;
      sent.push(request);
      return outcome ?? emptyOutcome(request.quota);
    },

    async browseKeyless(request): Promise<KeylessBrowseOutcome> {
      calls.browseKeyless += 1;
      browsed.push(request);
      if (keylessTransport === undefined) return { outcomes: [], jobs: [] };
      return await browseKeylessJobs(keylessTransport, request);
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

    async latestCvText(): Promise<Result<string | null, DbError>> {
      calls.latestCvText += 1;
      if (refuses('latestCvText')) return { ok: false, error: { ...FAILURE, table: 'cvs' } };
      return ok(cvText);
    },

    async dealBreakers(): Promise<Result<string[], DbError>> {
      calls.dealBreakers += 1;
      if (refuses('dealBreakers')) return { ok: false, error: { ...FAILURE, table: 'profile' } };
      return ok([...dealBreakers]);
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
