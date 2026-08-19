import { describe, expect, it, vi } from 'vitest';

import { err, ok, type Result } from '@cviper/core-types';

import { jobApiError, type JobApiError } from './errors';
import adzunaFixture from './fixtures/adzuna-search.json';
import reedFixture from './fixtures/reed-search.json';
import { QUOTA_BLOCK_AT, emptyQuota, type QuotaState } from './quota';
import { searchJobs } from './search';
import { type JobApiHttpResponse, type JobProviderId, type JobSearchTransport } from './types';

const TODAY = '2026-08-19';

const BODIES: Readonly<Record<JobProviderId, string>> = {
  adzuna: JSON.stringify(adzunaFixture),
  reed: JSON.stringify(reedFixture),
};

/**
 * A transport that answers from the recorded fixtures. Every call is recorded,
 * so "this provider was not contacted" is an assertion rather than a hope.
 */
function fakeTransport(
  overrides: Partial<Record<JobProviderId, Result<JobApiHttpResponse, JobApiError>>> = {},
): JobSearchTransport & { calls: JobProviderId[] } {
  const calls: JobProviderId[] = [];
  return {
    calls,
    search(provider) {
      calls.push(provider);
      const override = overrides[provider];
      if (override !== undefined) return Promise.resolve(override);
      return Promise.resolve(ok({ status: 200, body: BODIES[provider] }));
    },
  };
}

function request(providers: readonly JobProviderId[], quota: QuotaState = emptyQuota(TODAY)) {
  let next = 0;
  return {
    providers,
    input: { keywords: 'credit risk analyst', location: 'London' },
    quota,
    today: TODAY,
    createdAt: '2026-08-19T09:00:00.000Z',
    newId: () => `id-${++next}`,
  };
}

describe('searchJobs — a normal search across both providers', () => {
  it('calls each enabled provider exactly once', async () => {
    const transport = fakeTransport();

    await searchJobs(transport, request(['adzuna', 'reed']));

    expect(transport.calls).toEqual(['adzuna', 'reed']);
  });

  it('returns the adverts from both, with the duplicate cross-post flagged', async () => {
    const outcome = await searchJobs(fakeTransport(), request(['adzuna', 'reed']));

    expect(outcome.jobs).toHaveLength(6);
    expect(outcome.clusters).toHaveLength(1);
    expect(outcome.clusters[0]?.jobIds).toHaveLength(2);
  });

  it('never drops a job because it was clustered', async () => {
    // Flag, never merge. Six adverts came back and six adverts are returned.
    const outcome = await searchJobs(fakeTransport(), request(['adzuna', 'reed']));

    const clustered = outcome.clusters.flatMap((cluster) => cluster.jobIds);
    for (const id of clustered) {
      expect(outcome.jobs.some((entry) => entry.job.id === id)).toBe(true);
    }
    expect(new Set(outcome.jobs.map((entry) => entry.job.url)).size).toBe(6);
  });

  it('counts one request per provider against the quota', async () => {
    const outcome = await searchJobs(fakeTransport(), request(['adzuna', 'reed']));

    expect(outcome.quota.counts).toEqual({ adzuna: 1, reed: 1 });
  });

  it('lists outcomes in a stable order however the caller passes them', async () => {
    const outcome = await searchJobs(fakeTransport(), request(['reed', 'adzuna']));

    expect(outcome.outcomes.map((entry) => entry.provider)).toEqual(['adzuna', 'reed']);
  });

  it('ignores a repeated provider rather than searching it twice', async () => {
    const transport = fakeTransport();

    await searchJobs(transport, request(['reed', 'reed', 'reed']));

    expect(transport.calls).toEqual(['reed']);
  });
});

describe('searchJobs — unchecking a provider', () => {
  it('genuinely skips the call, rather than making it and hiding the results', async () => {
    const transport = fakeTransport();

    const outcome = await searchJobs(transport, request(['reed']));

    expect(transport.calls).toEqual(['reed']);
    expect(transport.calls).not.toContain('adzuna');
    expect(outcome.outcomes.map((entry) => entry.provider)).toEqual(['reed']);
  });

  it('does not spend quota on a provider it did not call', async () => {
    const outcome = await searchJobs(fakeTransport(), request(['reed']));

    expect(outcome.quota.counts).toEqual({ adzuna: 0, reed: 1 });
  });

  it('boundary: no providers at all is an empty search, not an error', async () => {
    const transport = fakeTransport();

    const outcome = await searchJobs(transport, request([]));

    expect(transport.calls).toEqual([]);
    expect(outcome.jobs).toEqual([]);
    expect(outcome.outcomes).toEqual([]);
    expect(outcome.clusters).toEqual([]);
  });
});

describe('searchJobs — one provider failing', () => {
  it("shows the failure beside the other provider's results", async () => {
    // The whole point of per-provider isolation: Reed being down must not cost
    // the user the Adzuna results they were also waiting for.
    const transport = fakeTransport({
      reed: err(jobApiError('reed', 'network', 'Could not reach Reed.')),
    });

    const outcome = await searchJobs(transport, request(['adzuna', 'reed']));

    const adzuna = outcome.outcomes.find((entry) => entry.provider === 'adzuna');
    const reed = outcome.outcomes.find((entry) => entry.provider === 'reed');

    expect(adzuna?.error).toBeNull();
    expect(adzuna?.jobs).toHaveLength(3);
    expect(reed?.error).toMatchObject({ kind: 'network' });
    expect(reed?.jobs).toEqual([]);
    expect(outcome.jobs).toHaveLength(3);
  });

  it('classifies a 401 as an auth problem the user can fix', async () => {
    const transport = fakeTransport({ reed: ok({ status: 401, body: '' }) });

    const outcome = await searchJobs(transport, request(['reed']));

    expect(outcome.outcomes[0]?.error).toMatchObject({ kind: 'auth', status: 401 });
    expect(outcome.outcomes[0]?.error?.message).toContain('Settings');
  });

  it('classifies a 429 as a rate limit and a 503 as their end', async () => {
    const rateLimited = await searchJobs(
      fakeTransport({ reed: ok({ status: 429, body: '' }) }),
      request(['reed']),
    );
    const theirFault = await searchJobs(
      fakeTransport({ reed: ok({ status: 503, body: '' }) }),
      request(['reed']),
    );

    expect(rateLimited.outcomes[0]?.error?.kind).toBe('rate-limit');
    expect(theirFault.outcomes[0]?.error?.kind).toBe('server');
  });

  it('a 200 with an unreadable body is a bad response, not an empty search', async () => {
    // "No jobs found" and "we could not read the reply" are different answers
    // and must not look the same on screen.
    const transport = fakeTransport({ adzuna: ok({ status: 200, body: '<html>oops</html>' }) });

    const outcome = await searchJobs(transport, request(['adzuna']));

    expect(outcome.outcomes[0]?.error?.kind).toBe('bad-response');
  });

  it('still counts a FAILED request against the quota', async () => {
    // A 401 or a timeout consumed the provider's allowance just the same.
    // Counting only successes under-reports exactly when it matters most.
    const transport = fakeTransport({ reed: ok({ status: 401, body: '' }) });

    const outcome = await searchJobs(transport, request(['reed']));

    expect(outcome.quota.counts.reed).toBe(1);
  });

  it('never lets a transport that throws take down the search', async () => {
    const exploding: JobSearchTransport = {
      search: vi.fn(() => {
        throw new Error('synchronous explosion');
      }),
    };

    const outcome = await searchJobs(exploding, request(['adzuna']));

    expect(outcome.outcomes[0]?.error?.kind).toBe('network');
    expect(outcome.jobs).toEqual([]);
  });
});

describe('searchJobs — the quota gate', () => {
  it('boundary: at the block point the provider is NOT contacted', async () => {
    const transport = fakeTransport();
    const spent: QuotaState = { date: TODAY, counts: { reed: QUOTA_BLOCK_AT, adzuna: 0 } };

    const outcome = await searchJobs(transport, request(['reed'], spent));

    expect(transport.calls).toEqual([]);
    expect(outcome.outcomes[0]?.error?.kind).toBe('quota');
    expect(outcome.outcomes[0]?.error?.message).toContain('midnight UTC');
  });

  it('boundary: one below the block point the provider IS contacted', async () => {
    const transport = fakeTransport();
    const nearly: QuotaState = { date: TODAY, counts: { reed: QUOTA_BLOCK_AT - 1, adzuna: 0 } };

    await searchJobs(transport, request(['reed'], nearly));

    expect(transport.calls).toEqual(['reed']);
  });

  it('a blocked provider does not stop the other one', async () => {
    const transport = fakeTransport();
    const spent: QuotaState = { date: TODAY, counts: { reed: QUOTA_BLOCK_AT, adzuna: 0 } };

    const outcome = await searchJobs(transport, request(['adzuna', 'reed'], spent));

    expect(transport.calls).toEqual(['adzuna']);
    expect(outcome.jobs).toHaveLength(3);
  });

  it('a blocked provider spends no further quota', async () => {
    const spent: QuotaState = { date: TODAY, counts: { reed: QUOTA_BLOCK_AT, adzuna: 0 } };

    const outcome = await searchJobs(fakeTransport(), request(['reed'], spent));

    expect(outcome.quota.counts.reed).toBe(QUOTA_BLOCK_AT);
  });

  it('yesterday’s spent quota does not block today', async () => {
    const yesterday: QuotaState = { date: '2026-08-18', counts: { reed: 99, adzuna: 99 } };
    const transport = fakeTransport();

    const outcome = await searchJobs(transport, request(['adzuna', 'reed'], yesterday));

    expect(transport.calls).toEqual(['adzuna', 'reed']);
    expect(outcome.quota).toEqual({ date: TODAY, counts: { adzuna: 1, reed: 1 } });
  });
});

describe('searchJobs — a search that cannot be built', () => {
  it('negative: an empty search never reaches the network', async () => {
    const transport = fakeTransport();

    const outcome = await searchJobs(transport, {
      ...request(['adzuna', 'reed']),
      input: { keywords: '  ', location: '' },
    });

    expect(transport.calls).toEqual([]);
    expect(outcome.outcomes.every((entry) => entry.error?.kind === 'bad-request')).toBe(true);
    expect(outcome.quota.counts).toEqual({ adzuna: 0, reed: 0 });
  });
});
