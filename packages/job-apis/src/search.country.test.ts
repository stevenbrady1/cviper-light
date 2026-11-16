/**
 * One search, for a country (L-415).
 *
 * The country travels from the search input to the transport as a code from a
 * closed list, and back as the currency on each advert. Reed lists UK jobs
 * only, so for any other country it is refused before the transport is called
 * — which also means none of its hundred daily requests is spent.
 */
import { describe, expect, it } from 'vitest';

import { ok } from '@cviper/core-types';

import adzunaFixture from './fixtures/adzuna-search.json';
import reedFixture from './fixtures/reed-search.json';
import { emptyQuota } from './quota';
import { searchJobs, type JobSearchRequest } from './search';
import { type JobProviderId, type JobSearchTransport } from './types';

const TODAY = '2026-08-19';

const BODIES: Readonly<Record<JobProviderId, string>> = {
  adzuna: JSON.stringify(adzunaFixture),
  reed: JSON.stringify(reedFixture),
};

/** Answers from the recorded fixtures, and records what each board was sent. */
function recordingTransport() {
  const sent: { provider: JobProviderId; country: string | undefined }[] = [];
  const transport: JobSearchTransport = {
    search(provider, params) {
      sent.push({ provider, country: params.country });
      return Promise.resolve(ok({ status: 200, body: BODIES[provider] }));
    },
  };
  return { transport, sent };
}

function request(
  providers: readonly JobProviderId[],
  country?: JobSearchRequest['input']['country'],
): JobSearchRequest {
  let next = 0;
  return {
    providers,
    input: {
      keywords: 'credit risk analyst',
      location: 'London',
      ...(country === undefined ? {} : { country }),
    },
    quota: emptyQuota(TODAY),
    today: TODAY,
    createdAt: '2026-08-19T09:00:00.000Z',
    newId: () => `id-${++next}`,
  };
}

describe('searchJobs — a search that names no country', () => {
  it('sends none to either board, and every salary is pounds, as before', async () => {
    const { transport, sent } = recordingTransport();

    const outcome = await searchJobs(transport, request(['adzuna', 'reed']));

    expect(sent).toEqual([
      { provider: 'adzuna', country: undefined },
      { provider: 'reed', country: undefined },
    ]);
    const currencies = new Set(
      outcome.jobs.map((entry) => entry.job.salary_currency).filter((value) => value !== null),
    );
    expect([...currencies]).toEqual(['GBP']);
  });
});

describe('searchJobs — a search for another country', () => {
  it('happy: a US search reaches Adzuna as "us" and its salaries are dollars', async () => {
    const { transport, sent } = recordingTransport();

    const outcome = await searchJobs(transport, request(['adzuna'], 'us'));

    expect(sent).toEqual([{ provider: 'adzuna', country: 'us' }]);
    expect(outcome.outcomes[0]?.error).toBeNull();
    const paid = outcome.jobs.filter((entry) => entry.job.salary_min !== null);
    expect(paid.length).toBeGreaterThan(0);
    for (const entry of paid) expect(entry.job.salary_currency).toBe('USD');
  });

  it('negative: Reed is never contacted for another country, and says why', async () => {
    const { transport, sent } = recordingTransport();

    const outcome = await searchJobs(transport, request(['adzuna', 'reed'], 'de'));

    // Adzuna still answers: one board refusing is not the search failing.
    expect(sent).toEqual([{ provider: 'adzuna', country: 'de' }]);
    const reed = outcome.outcomes.find((entry) => entry.provider === 'reed');
    expect(reed?.jobs).toEqual([]);
    expect(reed?.error?.kind).toBe('bad-request');
    expect(reed?.error?.message).toBe('Reed lists UK jobs only.');
    expect(outcome.jobs.length).toBeGreaterThan(0);
    expect(outcome.jobs.every((entry) => entry.job.source === 'adzuna')).toBe(true);
  });

  it('a refused Reed search spends none of Reed’s daily allowance', async () => {
    const { transport } = recordingTransport();

    const outcome = await searchJobs(transport, request(['adzuna', 'reed'], 'us'));

    expect(outcome.quota.counts).toEqual({ adzuna: 1, reed: 0 });
  });

  it('boundary: naming the United Kingdom searches both boards, as no country does', async () => {
    const { transport, sent } = recordingTransport();

    const outcome = await searchJobs(transport, request(['adzuna', 'reed'], 'gb'));

    expect(sent).toEqual([
      { provider: 'adzuna', country: 'gb' },
      { provider: 'reed', country: 'gb' },
    ]);
    expect(outcome.outcomes.every((entry) => entry.error === null)).toBe(true);
    expect(outcome.quota.counts).toEqual({ adzuna: 1, reed: 1 });
  });

  it('negative: a country off the list contacts nobody and spends nothing', async () => {
    const { transport, sent } = recordingTransport();

    const outcome = await searchJobs(transport, request(['adzuna', 'reed'], '../us' as never));

    expect(sent).toEqual([]);
    expect(outcome.jobs).toEqual([]);
    expect(outcome.outcomes.map((entry) => entry.error?.kind)).toEqual([
      'bad-request',
      'bad-request',
    ]);
    expect(outcome.quota.counts).toEqual({ adzuna: 0, reed: 0 });
  });
});
