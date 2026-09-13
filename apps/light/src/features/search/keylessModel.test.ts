/**
 * What the screen SAYS about a keyless browse, decided without React.
 *
 * The sentences matter more than usual here. Three states look identical if
 * nobody separates them — the feed failed, the feed was empty, the filter
 * matched nothing — and only the last of the three is the user's to act on.
 */
import { describe, expect, it } from 'vitest';

import {
  keylessError,
  type KeylessBrowseOutcome,
  type KeylessSourceOutcome,
  type SearchResultJob,
} from '@cviper/job-apis';
import { type Job } from '@cviper/core-types';

import { KEYLESS_INTRO, combineResults, nothingMatchedNote, submitLabel } from './keylessModel';
import { searchDisabledReason } from './model';

/**
 * Long enough to fingerprint. `MIN_FINGERPRINT_TOKENS` is 20, so an advert with
 * a three-word title and no description is deliberately never clustered — the
 * duplicate rule refuses to guess from a handful of words.
 */
const LONG_TEXT =
  'A senior credit risk analyst is required to support the impairment modelling team of a ' +
  'large retail bank in the City with IFRS 9 model monitoring duties across mortgages and ' +
  'unsecured lending and a strong focus on control and accuracy every single day';

function job(
  id: string,
  source: Job['source'],
  title: string,
  description: string | null = null,
): SearchResultJob {
  return {
    job: {
      id,
      source,
      external_id: id,
      title,
      company: 'ACME',
      location: 'London',
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      description,
      url: null,
      posted_date: null,
      created_at: '2026-09-13T09:00:00.000Z',
    },
    contractType: 'Permanent',
  };
}

function sourceOutcome(over: Partial<KeylessSourceOutcome> = {}): KeylessSourceOutcome {
  return { source: 'arbeitnow', fetched: 0, jobs: [], error: null, ...over };
}

describe('submitLabel — the button says what it will do', () => {
  it('says Search when only keyed boards are ticked', () => {
    expect(submitLabel(2, 0)).toBe('Search');
  });

  it('never calls a keyless browse a search', () => {
    // The feeds ignore every query. Calling this a search would be a claim the
    // user cannot check and that is not true.
    const label = submitLabel(0, 2);
    expect(label.toLowerCase()).not.toContain('search');
    expect(label.toLowerCase()).toContain('browse');
  });

  it('says both when both are ticked', () => {
    const label = submitLabel(2, 2).toLowerCase();
    expect(label).toContain('search');
    expect(label).toContain('browse');
  });

  it('boundary: with nothing ticked it still says something pressable', () => {
    expect(submitLabel(0, 0).length).toBeGreaterThan(0);
  });
});

describe('searchDisabledReason — now counts the free feeds too', () => {
  it('boundary: a machine with no keys at all can still press the button', () => {
    // The change this feature is for. Before it, zero keys meant a disabled
    // button; now a ticked free feed is something to look at, so the only
    // reason left is "you have ticked nothing".
    expect(searchDisabledReason(1)).toBeNull();
    expect(searchDisabledReason(0)).not.toBeNull();
  });

  it('still points at what works before it points at Settings', () => {
    const reason = searchDisabledReason(0) ?? '';
    expect(reason).toContain('below');
    expect(reason).toContain('no key');
  });
});

describe('nothingMatchedNote — the sentence that is NOT an error', () => {
  it('is said when the feed answered and the filter matched none of it', () => {
    const note = nothingMatchedNote(sourceOutcome({ fetched: 38, jobs: [] })) ?? '';

    expect(note).toContain('Arbeitnow');
    expect(note).toContain('38');
    // The user's words are the thing to change, and the sentence says so
    // without implying anything is broken.
    expect(note.toLowerCase()).not.toContain('error');
    expect(note.toLowerCase()).not.toContain('failed');
  });

  it('is NOT said when the feed failed — that is a different sentence', () => {
    // The whole point. A failure already has its own visible line; adding
    // "nothing matched" beside it would tell the user their words were the
    // problem when the feed never answered.
    expect(
      nothingMatchedNote(
        sourceOutcome({ fetched: 0, error: keylessError('arbeitnow', 'server', 'It is down.') }),
      ),
    ).toBeNull();
  });

  it('is not said when the feed did answer with matches', () => {
    expect(
      nothingMatchedNote(sourceOutcome({ fetched: 38, jobs: [job('a', 'arbeitnow', 'x')] })),
    ).toBeNull();
  });

  it('boundary: a feed that published nothing is a failure, so no note', () => {
    // `browse.ts` gives that outcome an `empty-feed` error, so this branch only
    // ever sees a fetched count above zero — but if the error were ever
    // dropped, saying "0 jobs, none matched" would be the silent failure this
    // feature exists to prevent.
    expect(nothingMatchedNote(sourceOutcome({ fetched: 0, jobs: [] }))).toBeNull();
  });

  it('names the Guardian feed by its own name', () => {
    const note = nothingMatchedNote(sourceOutcome({ source: 'guardian', fetched: 20 })) ?? '';
    expect(note).toContain('Guardian Jobs');
  });
});

describe('combineResults — two sources, one list', () => {
  const keyed = {
    outcomes: [
      { provider: 'adzuna' as const, jobs: [job('a1', 'adzuna', 'Analyst')], error: null },
    ],
    jobs: [job('a1', 'adzuna', 'Analyst')],
    clusters: [],
    quota: { date: '2026-09-13', counts: { reed: 0, adzuna: 1 } },
  };

  const keyless: KeylessBrowseOutcome = {
    outcomes: [sourceOutcome({ fetched: 1, jobs: [job('k1', 'guardian', 'Social Worker')] })],
    jobs: [job('k1', 'guardian', 'Social Worker')],
  };

  it('puts every advert in one list, keyed first', () => {
    const combined = combineResults(keyed, keyless);
    expect(combined.jobs.map((entry) => entry.job.id)).toEqual(['a1', 'k1']);
  });

  it('boundary: either half may be missing', () => {
    expect(combineResults(keyed, null).jobs).toHaveLength(1);
    expect(combineResults(null, keyless).jobs).toHaveLength(1);
    expect(combineResults(null, null).jobs).toEqual([]);
  });

  it('looks for cross-posts ACROSS the two halves, not within each', () => {
    // The same advert on Adzuna and on a free feed is exactly the case worth
    // flagging, and it can only be seen by fingerprinting the merged list.
    const onAdzuna = job('a2', 'adzuna', 'Credit Risk Analyst', LONG_TEXT);
    const onGuardian = job('g2', 'guardian', 'Credit Risk Analyst', LONG_TEXT);

    const combined = combineResults(
      { ...keyed, jobs: [onAdzuna] },
      { outcomes: [], jobs: [onGuardian] },
    );

    expect(combined.clusters.length).toBeGreaterThan(0);
    expect(combined.clusters[0]?.jobIds).toContain('a2');
    expect(combined.clusters[0]?.jobIds).toContain('g2');
    // Nothing is removed. Both are still on the page with their own links.
    expect(combined.jobs).toHaveLength(2);
  });

  it('reports whether anything was actually looked at', () => {
    // "Nothing searched yet" and "nothing found" are different screens.
    expect(combineResults(null, null).ran).toBe(false);
    expect(combineResults(keyed, null).ran).toBe(true);
    expect(combineResults(null, keyless).ran).toBe(true);
  });
});

describe('KEYLESS_INTRO — what the screen promises about these feeds', () => {
  it('never calls it a search', () => {
    expect(KEYLESS_INTRO.toLowerCase()).not.toMatch(/\bsearch\b/);
  });

  it('says where the jobs come from, rather than implying the whole market', () => {
    // Arbeitnow is Germany-first with a UK minority, and the Guardian feed is
    // twenty items. A reader who is told "browse jobs, no key needed" and then
    // sees four adverts has been misled by the copy, not by the feeds.
    expect(KEYLESS_INTRO).toContain('Arbeitnow');
    expect(KEYLESS_INTRO).toContain('Guardian');
    expect(KEYLESS_INTRO.toLowerCase()).toContain('recent');
  });

  it('says the narrowing happens on this computer', () => {
    expect(KEYLESS_INTRO.toLowerCase()).toMatch(/on your computer|on this computer/);
  });
});
