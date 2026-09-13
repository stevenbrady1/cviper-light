/**
 * The local filter, against the messy location strings the real feed sends.
 *
 * ============================================================================
 * THESE ARE NOT INVENTED EXAMPLES
 * ============================================================================
 * Every location string in the London block below appeared in one live page of
 * 250 Arbeitnow adverts. Free text, written by whoever posted the advert:
 * "London", "London HQ", "London Office", "London - The River Building HQ",
 * "London, Greater London, United Kingdom", "London, England", "UK - London",
 * "UK, London" — and 8 adverts with no location at all.
 *
 * A plain substring test is wrong in BOTH directions on that data: it misses
 * "Greater London" typed against a bare "London", and it matches "Londonderry"
 * — a different city, 500 miles away — against "London". So the filter works in
 * whole words, and these are the cases that say so.
 */
import { describe, expect, it } from 'vitest';

import fixture from '../fixtures/arbeitnow-page1.json';

import { normaliseArbeitnowFeed } from './arbeitnow';
import { filterKeylessJobs, matchesKeywords, matchesLocation } from './filter';

const CONTEXT = {
  createdAt: '2026-09-13T09:00:00.000Z' as const,
  newId: (() => {
    let next = 0;
    return () => `id-${++next}`;
  })(),
};

const PAGE = (() => {
  const parsed = normaliseArbeitnowFeed(JSON.stringify(fixture), CONTEXT);
  if (!parsed.ok) throw new Error('the fixture must parse');
  return parsed.value;
})();

describe('matchesLocation — the spellings the feed actually uses', () => {
  const LONDON_AS_WRITTEN = [
    'London',
    'London HQ',
    'London Office',
    'London - The River Building HQ',
    'London, Greater London, United Kingdom',
    'London, England',
    'UK - London',
    'UK, London',
    'london',
    '  London  ',
  ];

  it('matches every way a real advert wrote London', () => {
    for (const where of LONDON_AS_WRITTEN) {
      expect(matchesLocation(where, 'London'), where).toBe(true);
    }
  });

  it('matches when the user types more than the advert did', () => {
    // "Greater London" against an advert that says only "London". A substring
    // test fails this, and the user concludes the filter is broken.
    expect(matchesLocation('London', 'Greater London')).toBe(true);
    expect(matchesLocation('London', 'City of London')).toBe(true);
    expect(matchesLocation('London, England', 'london')).toBe(true);
  });

  it('negative: does not match a different place that merely starts the same', () => {
    // The other direction, and the expensive one: Londonderry is in Northern
    // Ireland. A substring test says yes.
    expect(matchesLocation('Londonderry', 'London')).toBe(false);
    expect(matchesLocation('Paris', 'London')).toBe(false);
    expect(matchesLocation('Berlin, Berlin, Germany', 'London')).toBe(false);
    expect(matchesLocation('Remote', 'London')).toBe(false);
  });

  it('treats the country’s several spellings as one place', () => {
    // "UK", "U.K.", "United Kingdom" and "Great Britain" are the same country,
    // written four ways, and the feed uses at least two of them.
    for (const typed of ['UK', 'U.K.', 'United Kingdom', 'Great Britain', 'GB']) {
      expect(matchesLocation('London, Greater London, United Kingdom', typed), typed).toBe(true);
      expect(matchesLocation('UK - London', typed), typed).toBe(true);
      expect(matchesLocation('United Kingdom', typed), typed).toBe(true);
    }
  });

  it('negative: a country query does not match an advert that named only a city', () => {
    // Honest rather than helpful: the advert did not say which country, and
    // guessing that "London" means the UK one is a guess. The screen says so,
    // rather than the filter pretending.
    expect(matchesLocation('London', 'UK')).toBe(false);
    expect(matchesLocation('Paris', 'United Kingdom')).toBe(false);
  });

  it('boundary: no location filter matches everything, including adverts with no location', () => {
    for (const typed of ['', '   ']) {
      expect(matchesLocation('London', typed), typed).toBe(true);
      expect(matchesLocation(null, typed), typed).toBe(true);
    }
  });

  it('boundary: an advert with no location cannot match a location filter', () => {
    // 8 of 250 real adverts had none. Letting them through would put a Berlin
    // job under a London filter with nothing on the card to explain it.
    expect(matchesLocation(null, 'London')).toBe(false);
    expect(matchesLocation('', 'London')).toBe(false);
  });

  it('boundary: accents are not a different city', () => {
    expect(matchesLocation('München, Bayern, Germany', 'munchen')).toBe(true);
    expect(matchesLocation('Munchen', 'München')).toBe(true);
    expect(matchesLocation('Saarbrücken', 'saarbrucken')).toBe(true);
  });
});

describe('matchesKeywords — words in the title and the employer', () => {
  it('matches a word in the title', () => {
    expect(matchesKeywords('Compliance Analyst', 'ACME', 'analyst')).toBe(true);
    expect(matchesKeywords('Compliance Analyst', 'ACME', 'Compliance Analyst')).toBe(true);
  });

  it('matches the start of a longer word, so a plural still finds it', () => {
    expect(matchesKeywords('Senior Developers Wanted', 'ACME', 'developer')).toBe(true);
    expect(matchesKeywords('Data Engineering Lead', 'ACME', 'engineer')).toBe(true);
  });

  it('matches the employer, because people search for one', () => {
    expect(matchesKeywords('Analyst', 'Cloudflare', 'cloudflare')).toBe(true);
  });

  it('keeps the punctuation that is part of a technology’s name', () => {
    // ".NET" and "C#" are the names. A tokeniser that drops the symbols turns
    // both into "net" and "c" and the filter stops meaning anything.
    expect(matchesKeywords('Software Engineer (.NET C#)', 'ACME', 'C#')).toBe(true);
    expect(matchesKeywords('Software Engineer (.NET C#)', 'ACME', '.net')).toBe(true);
  });

  it('requires every word the user typed', () => {
    expect(matchesKeywords('Compliance Analyst', 'ACME', 'credit risk analyst')).toBe(false);
    expect(matchesKeywords('Credit Risk Analyst', 'ACME', 'credit risk analyst')).toBe(true);
  });

  it('negative: an unrelated word matches nothing', () => {
    expect(matchesKeywords('Compliance Analyst', 'ACME', 'plumber')).toBe(false);
  });

  it('negative: does not match inside a word', () => {
    // "AI" must not find "Retail". Matching anywhere inside a word is how a
    // two-letter search returns the entire page.
    expect(matchesKeywords('Retail Assistant', 'ACME', 'ai')).toBe(false);
    expect(matchesKeywords('AI Engineer', 'ACME', 'ai')).toBe(true);
  });

  it('boundary: no keyword filter matches everything', () => {
    for (const typed of ['', '   ']) {
      expect(matchesKeywords('Anything', 'ACME', typed), typed).toBe(true);
    }
  });

  it('boundary: punctuation on its own filters nothing out', () => {
    expect(matchesKeywords('Compliance Analyst', 'ACME', '  ,,, ')).toBe(true);
  });
});

describe('filterKeylessJobs — over the recorded page', () => {
  it('narrows 19 adverts to the London ones', () => {
    const london = filterKeylessJobs(PAGE, { keywords: '', location: 'London' });
    // Eight of the nineteen wrote London in one spelling or another.
    expect(london).toHaveLength(8);
    for (const entry of london) {
      expect(entry.job.location?.toLowerCase(), entry.job.title).toContain('london');
    }
  });

  it('narrows by both boxes at once', () => {
    const engineers = filterKeylessJobs(PAGE, { keywords: 'engineer', location: 'London' });
    expect(engineers.length).toBeGreaterThan(0);
    expect(engineers.length).toBeLessThan(8);
    for (const entry of engineers) {
      expect(entry.job.title.toLowerCase()).toContain('engineer');
    }
  });

  it('boundary: an empty filter returns the page untouched, in order', () => {
    const all = filterKeylessJobs(PAGE, { keywords: '', location: '' });
    expect(all).toEqual(PAGE);
  });

  it('negative: a filter nothing matches returns nothing — and that is not an error', () => {
    // The state the whole feature is careful about: EMPTY IS A VALID ANSWER
    // HERE, and it is the UI's job to say "nothing matched" rather than let it
    // look like a dead feed. `browse.ts` carries the counts that make that
    // sentence possible.
    expect(filterKeylessJobs(PAGE, { keywords: 'lighthouse keeper', location: '' })).toEqual([]);
  });

  it('removes nothing it was not asked to — no advert is invented or reordered', () => {
    const filtered = filterKeylessJobs(PAGE, { keywords: 'engineer', location: '' });
    const order = PAGE.filter((entry) => filtered.includes(entry));
    expect(filtered).toEqual(order);
  });
});
