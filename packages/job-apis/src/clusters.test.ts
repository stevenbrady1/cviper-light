import { describe, expect, it } from 'vitest';

import { type Job } from '@cviper/core-types';

import { findCrossPostClusters } from './clusters';
import adzunaFixture from './fixtures/adzuna-search.json';
import reedFixture from './fixtures/reed-search.json';
import { normaliseAdzunaResponse, normaliseReedResponse } from './normalise';

function context(prefix: string) {
  let next = 0;
  return { createdAt: '2026-08-19T09:00:00.000Z', newId: () => `${prefix}-${++next}` };
}

/** The three Adzuna adverts and the three Reed adverts, as one search result. */
function everyJob(): Job[] {
  const fromAdzuna = normaliseAdzunaResponse(JSON.stringify(adzunaFixture), context('adzuna'));
  const fromReed = normaliseReedResponse(JSON.stringify(reedFixture), context('reed'));
  if (!fromAdzuna.ok || !fromReed.ok) throw new Error('both fixtures must normalise');

  return [...fromAdzuna.value, ...fromReed.value].map((entry) => entry.job);
}

describe('findCrossPostClusters — the cross-post in the fixtures', () => {
  it('finds the one role that both boards are advertising', () => {
    const clusters = findCrossPostClusters(everyJob());

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.jobIds).toEqual(['adzuna-1', 'reed-1']);
  });

  it('FLAGS, NEVER MERGES: every advert survives with its own apply link', () => {
    // ====================================================================
    // THE POLICY CHANGE FROM THE WEB APPLICATION.
    // ====================================================================
    // The source auto-merges a pair inside this band. Its own comment explains
    // why that is dangerous: "A wrong merge deletes a real posting and its
    // apply URL with no error and no way for the user to know." The web app
    // can afford it because a server-side undo exists. A local desktop app has
    // no such thing, so this function returns CLUSTER METADATA and nothing
    // else - there is no code path here that can drop a job.
    const jobs = everyJob();
    const clusters = findCrossPostClusters(jobs);

    const clustered = clusters.flatMap((cluster) => cluster.jobIds);
    for (const id of clustered) {
      const job = jobs.find((candidate) => candidate.id === id);
      expect(job).toBeDefined();
      expect(job?.url).toBeTruthy();
    }

    // Both apply links are still distinct and still there.
    const urls = jobs.filter((job) => clustered.includes(job.id)).map((job) => job.url);
    expect(urls).toHaveLength(2);
    expect(new Set(urls).size).toBe(2);
    expect(urls[0]).toContain('adzuna.co.uk');
    expect(urls[1]).toContain('reed.co.uk');
  });

  it('leaves the four unrelated adverts out of any cluster', () => {
    const clusters = findCrossPostClusters(everyJob());
    const clustered = new Set(clusters.flatMap((cluster) => cluster.jobIds));

    expect(clustered.size).toBe(2);
  });
});

// ── Synthetic jobs, for the cases the fixtures cannot reach ──────────────────

const LONG_TEXT =
  'A senior operations analyst is required to support the settlements desk of a large brokerage in the City with daily reconciliation duties across multiple asset classes and a strong focus on control and accuracy every single day';

function job(id: string, description: string | null, url = `https://example.test/${id}`): Job {
  return {
    id,
    source: 'reed',
    external_id: id,
    title: 'A Role',
    company: 'A Company',
    location: 'London',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description,
    url,
    posted_date: null,
    created_at: '2026-08-19T09:00:00.000Z',
  };
}

describe('findCrossPostClusters — grouping', () => {
  it('pulls three near-identical adverts into ONE cluster, not three pairs', () => {
    const jobs = [
      job('a', LONG_TEXT),
      job('b', LONG_TEXT),
      job('c', LONG_TEXT),
      job(
        'd',
        `${LONG_TEXT} and nothing whatever to do with the others in any respect at all here`,
      ),
    ];

    const clusters = findCrossPostClusters(jobs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.jobIds).toEqual(['a', 'b', 'c']);
  });

  it('keeps the ids in the order the adverts arrived', () => {
    // The first advert in a cluster is the one the UI shows as the head, so a
    // stable order stops the card swapping between renders.
    const clusters = findCrossPostClusters([job('z', LONG_TEXT), job('a', LONG_TEXT)]);
    expect(clusters[0]?.jobIds).toEqual(['z', 'a']);
  });
});

describe('findCrossPostClusters — negative cases', () => {
  it('an empty search has no clusters', () => {
    expect(findCrossPostClusters([])).toEqual([]);
  });

  it('a single advert is never a cluster of one', () => {
    expect(findCrossPostClusters([job('a', LONG_TEXT)])).toEqual([]);
  });

  it('two adverts with NO description are never clustered together', () => {
    // Without this, every job with a blank description would collapse into one
    // enormous false cluster - the exact failure the source guards against by
    // returning no fingerprint below the token minimum.
    expect(findCrossPostClusters([job('a', null), job('b', null)])).toEqual([]);
  });

  it('two adverts with the SAME too-short description are never clustered', () => {
    expect(findCrossPostClusters([job('a', 'Apply within'), job('b', 'Apply within')])).toEqual([]);
  });

  it('boundary: adverts that are word-for-word identical still cluster', () => {
    const clusters = findCrossPostClusters([job('a', LONG_TEXT), job('b', LONG_TEXT)]);
    expect(clusters).toHaveLength(1);
  });

  it('never throws on a job whose description is not a string', () => {
    const broken = { ...job('a', null), description: 42 as unknown as string };
    expect(() => findCrossPostClusters([broken, job('b', LONG_TEXT)])).not.toThrow();
  });
});
