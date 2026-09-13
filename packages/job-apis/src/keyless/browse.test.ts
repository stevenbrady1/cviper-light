// @vitest-environment jsdom
/**
 * ============================================================================
 * THE POINT OF THE WHOLE FEATURE: A DEAD FEED MUST NOT LOOK LIKE A QUIET MARKET
 * ============================================================================
 * Free feeds rot. They move, they get rate-limited, they change shape, they are
 * switched off. What makes that dangerous is not the failure — it is that every
 * one of those failures produces the same thing on screen unless somebody
 * stops it: an empty list, which the user reads as "there are no jobs like
 * that", and which they have no way to question.
 *
 * So every test in the first block below BREAKS A FEED ON PURPOSE and asserts
 * that a message comes back naming the source. The second block asserts the
 * opposite case just as hard: a feed that worked and a filter that matched
 * nothing must NOT produce an error, because "we found nothing for you" and
 * "we could not look" are different sentences and only one of them is the
 * user's to act on.
 *
 * jsdom, because a browse of both sources parses the Guardian feed with
 * `DOMParser`.
 */
import { describe, expect, it, vi } from 'vitest';

import { err, ok, type Result } from '@cviper/core-types';

import { type JobApiHttpResponse } from '../types';
import arbeitnowFixture from '../fixtures/arbeitnow-page1.json';
import guardianFixture from '../fixtures/guardian-jobsrss.xml?raw';

import { browseKeylessJobs } from './browse';
import { keylessError, type KeylessError } from './errors';
import { KEYLESS_SOURCE_IDS, type KeylessSourceId } from './types';

const ARBEITNOW_BODY = JSON.stringify(arbeitnowFixture);

const REQUEST = {
  sources: KEYLESS_SOURCE_IDS,
  filter: { keywords: '', location: '' },
  createdAt: '2026-09-13T09:00:00.000Z' as const,
  newId: (() => {
    let next = 0;
    return () => `id-${++next}`;
  })(),
};

type Reply = Result<JobApiHttpResponse, KeylessError>;

/**
 * A transport that answers from a script. Records what it was asked for, so a
 * test can prove a source was never contacted.
 */
function fakeTransport(reply: (source: KeylessSourceId, page: number) => Reply | Promise<Reply>): {
  transport: { fetch: (source: KeylessSourceId, page: number) => Promise<Reply> };
  asked: () => string[];
} {
  const asked: string[] = [];
  return {
    transport: {
      fetch: async (source, page) => {
        asked.push(`${source}:${page}`);
        return await reply(source, page);
      },
    },
    asked: () => asked,
  };
}

/** Both feeds working, from the recorded pages. */
function workingReply(source: KeylessSourceId): Reply {
  return ok({ status: 200, body: source === 'arbeitnow' ? ARBEITNOW_BODY : guardianFixture });
}

function outcomeFor(
  outcome: Awaited<ReturnType<typeof browseKeylessJobs>>,
  source: KeylessSourceId,
) {
  const found = outcome.outcomes.find((entry) => entry.source === source);
  if (found === undefined) throw new Error(`no outcome for ${source}`);
  return found;
}

describe('browseKeylessJobs — both feeds working', () => {
  it('returns the adverts both feeds published', async () => {
    const { transport } = fakeTransport(workingReply);
    const outcome = await browseKeylessJobs(transport, REQUEST);

    // 19 recorded Arbeitnow adverts across two pages (the fake answers the
    // same page twice, which is what a feed that has not moved on looks like)
    // and the Guardian's 20.
    expect(outcomeFor(outcome, 'arbeitnow').fetched).toBe(38);
    expect(outcomeFor(outcome, 'guardian').fetched).toBe(20);
    expect(outcome.jobs).toHaveLength(58);
    expect(outcome.outcomes.every((entry) => entry.error === null)).toBe(true);
  });

  it('asks for exactly three pages, and no more', async () => {
    // The stated cost of one browse: two pages of Arbeitnow and the Guardian's
    // one. Nothing the user typed can raise it.
    const { transport, asked } = fakeTransport(workingReply);
    await browseKeylessJobs(transport, REQUEST);

    expect([...asked()].sort()).toEqual(['arbeitnow:1', 'arbeitnow:2', 'guardian:1']);
  });

  it('asks one feed for its second page only after the first has answered', async () => {
    // Two requests to the same host in the same millisecond is the shape of
    // thing that gets a free feed closed to everybody — and Arbeitnow's terms
    // ask, in words, that it not be abused. Sources overlap with each other
    // (different servers); pages within a source do not.
    const { transport, asked } = fakeTransport(workingReply);
    await browseKeylessJobs(transport, REQUEST);

    expect(asked().indexOf('arbeitnow:1')).toBeLessThan(asked().indexOf('arbeitnow:2'));
  });

  it('contacts nothing the caller did not ask for', async () => {
    const { transport, asked } = fakeTransport(workingReply);
    const outcome = await browseKeylessJobs(transport, { ...REQUEST, sources: ['guardian'] });

    expect(asked()).toEqual(['guardian:1']);
    expect(outcome.outcomes).toHaveLength(1);
  });

  it('boundary: asking for no source contacts nobody and reports nothing', async () => {
    const { transport, asked } = fakeTransport(workingReply);
    const outcome = await browseKeylessJobs(transport, { ...REQUEST, sources: [] });

    expect(asked()).toEqual([]);
    expect(outcome.outcomes).toEqual([]);
    expect(outcome.jobs).toEqual([]);
  });
});

describe('browseKeylessJobs — a feed that has rotted says so, loudly', () => {
  it('a 404 becomes a message naming the source, not an empty list', async () => {
    const { transport } = fakeTransport((source) =>
      source === 'arbeitnow' ? ok({ status: 404, body: 'Not Found' }) : workingReply(source),
    );

    const outcome = await browseKeylessJobs(transport, REQUEST);
    const dead = outcomeFor(outcome, 'arbeitnow');

    expect(dead.error).not.toBeNull();
    expect(dead.error?.source).toBe('arbeitnow');
    expect(dead.error?.kind).toBe('server');
    expect(dead.error?.status).toBe(404);
    expect(dead.error?.message).toContain('Arbeitnow');
    expect(dead.jobs).toEqual([]);

    // And the other feed's adverts are still here. One dead source must never
    // cost the user the results of the one that worked.
    expect(outcomeFor(outcome, 'guardian').jobs.length).toBeGreaterThan(0);
    expect(outcome.jobs.length).toBeGreaterThan(0);
  });

  it('a feed that changed shape becomes a message, not an empty list', async () => {
    // The commonest way a free feed dies: it still answers 200, with something
    // else entirely — a maintenance page, an HTML redirect, a new envelope.
    const { transport } = fakeTransport((source) =>
      source === 'arbeitnow'
        ? ok({ status: 200, body: '<html><body>We have moved</body></html>' })
        : workingReply(source),
    );

    const broken = outcomeFor(await browseKeylessJobs(transport, REQUEST), 'arbeitnow');

    expect(broken.error?.kind).toBe('bad-response');
    expect(broken.error?.message).toContain('Arbeitnow');
    expect(broken.jobs).toEqual([]);
  });

  it('the same, for the RSS feed', async () => {
    const { transport } = fakeTransport((source) =>
      source === 'guardian' ? ok({ status: 200, body: '{"error":"gone"}' }) : workingReply(source),
    );

    const broken = outcomeFor(await browseKeylessJobs(transport, REQUEST), 'guardian');

    expect(broken.error?.kind).toBe('bad-response');
    expect(broken.error?.message).toContain('Guardian Jobs');
  });

  it('a feed that answers perfectly with NO adverts is a failure, not a quiet day', async () => {
    // THE SILENT ONE. 200, valid JSON, right shape, zero adverts. Every layer
    // is happy and the user sees an empty list. A feed of "the most recent
    // jobs" is never legitimately empty.
    const { transport } = fakeTransport((source) =>
      source === 'arbeitnow' ? ok({ status: 200, body: '{"data":[]}' }) : workingReply(source),
    );

    const quiet = outcomeFor(await browseKeylessJobs(transport, REQUEST), 'arbeitnow');

    expect(quiet.error?.kind).toBe('empty-feed');
    expect(quiet.error?.message).toContain('Arbeitnow');
    expect(quiet.fetched).toBe(0);
  });

  it('an RSS feed with no items is the same failure', async () => {
    const { transport } = fakeTransport((source) =>
      source === 'guardian'
        ? ok({ status: 200, body: '<?xml version="1.0"?><rss><channel></channel></rss>' })
        : workingReply(source),
    );

    const quiet = outcomeFor(await browseKeylessJobs(transport, REQUEST), 'guardian');
    expect(quiet.error?.kind).toBe('empty-feed');
  });

  it('a request that never completed says so', async () => {
    const { transport } = fakeTransport((source) =>
      source === 'guardian'
        ? err(keylessError('guardian', 'network', 'CViper could not reach Guardian Jobs.'))
        : workingReply(source),
    );

    const down = outcomeFor(await browseKeylessJobs(transport, REQUEST), 'guardian');
    expect(down.error?.kind).toBe('network');
  });

  it('a transport that throws is still an error the user can read', async () => {
    // A transport is not supposed to throw. A broken IPC or an unregistered
    // Rust command does exactly that, and it must not take the browse down.
    const { transport } = fakeTransport((source) => {
      if (source === 'arbeitnow') throw new Error('command not found');
      return workingReply(source);
    });

    const outcome = await browseKeylessJobs(transport, REQUEST);
    expect(outcomeFor(outcome, 'arbeitnow').error?.kind).toBe('network');
    expect(outcomeFor(outcome, 'guardian').jobs.length).toBeGreaterThan(0);
  });

  it('boundary: page two failing keeps page one’s adverts AND reports the failure', async () => {
    // Both halves matter. Throwing away 19 good adverts because the second
    // page 500'd would be a silent loss; reporting nothing would be a lie
    // about how much of the feed was read.
    const { transport } = fakeTransport((source, page) => {
      if (source === 'arbeitnow' && page === 2) return ok({ status: 500, body: '' });
      return workingReply(source);
    });

    const partial = outcomeFor(await browseKeylessJobs(transport, REQUEST), 'arbeitnow');

    expect(partial.jobs).toHaveLength(19);
    expect(partial.error?.kind).toBe('server');
  });

  it('stops asking a feed for more pages once one has failed', async () => {
    const { transport, asked } = fakeTransport((source, page) => {
      if (source === 'arbeitnow' && page === 1) return ok({ status: 503, body: '' });
      return workingReply(source);
    });

    await browseKeylessJobs(transport, REQUEST);
    expect(asked()).not.toContain('arbeitnow:2');
  });
});

describe('browseKeylessJobs — nothing matched is a DIFFERENT answer', () => {
  it('reports no error when the feeds worked and the filter matched nothing', async () => {
    const { transport } = fakeTransport(workingReply);

    const outcome = await browseKeylessJobs(transport, {
      ...REQUEST,
      filter: { keywords: 'lighthouse keeper', location: 'Reykjavik' },
    });

    for (const entry of outcome.outcomes) {
      // The distinction the whole feature exists for: the feed answered, so
      // there is nothing to apologise for and nothing for the user to fix
      // except their own words.
      expect(entry.error, entry.source).toBeNull();
      expect(entry.jobs, entry.source).toEqual([]);
      expect(entry.fetched, entry.source).toBeGreaterThan(0);
    }
    expect(outcome.jobs).toEqual([]);
  });

  it('carries the numbers a screen needs to say which of the two happened', async () => {
    const { transport } = fakeTransport(workingReply);

    const outcome = await browseKeylessJobs(transport, {
      ...REQUEST,
      filter: { keywords: '', location: 'London' },
    });

    const arbeitnow = outcomeFor(outcome, 'arbeitnow');
    expect(arbeitnow.fetched).toBe(38);
    expect(arbeitnow.jobs.length).toBeGreaterThan(0);
    expect(arbeitnow.jobs.length).toBeLessThan(arbeitnow.fetched);
    expect(arbeitnow.error).toBeNull();
  });

  it('spends no quota, because these feeds have no allowance to spend', async () => {
    // Reed's hundred-a-day is real and counted. A feed with no account has no
    // allowance, and counting a browse against Reed's would take real searches
    // away from the user for nothing. There is no quota argument here at all,
    // and this test is the reminder not to add one.
    const { transport } = fakeTransport(workingReply);
    const outcome = await browseKeylessJobs(transport, REQUEST);

    expect(Object.keys(outcome)).toEqual(['outcomes', 'jobs']);
  });
});

describe('the fake transport is not lying to these tests', () => {
  it('really is called, with the pages the browse claims to ask for', async () => {
    // Anti-inert. If the transport were never invoked, most assertions above
    // would pass on an empty outcome.
    const fetch = vi.fn(async (source: KeylessSourceId) => workingReply(source));
    await browseKeylessJobs({ fetch }, REQUEST);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledWith('arbeitnow', 1);
    expect(fetch).toHaveBeenCalledWith('arbeitnow', 2);
    expect(fetch).toHaveBeenCalledWith('guardian', 1);
  });
});
