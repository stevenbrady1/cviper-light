/**
 * The keyless rank: a band per advert from the CV on file, and the profile's
 * deal-breakers found in the advert's own words. No React, no network, no key.
 *
 * Every "must not match" below is a real way this goes wrong in front of a
 * user: "SC" (security clearance) lighting up every Scala advert, "C" flagging
 * every advert in the English language, "C++" being read as a regex and
 * matching "C" — each of which turns a chip that should mean "read this one
 * carefully" into noise the user learns to ignore.
 */
import { describe, expect, it } from 'vitest';

import { MIN_SCORABLE_CHARS } from '@cviper/keyword-scoring';

import { dealBreakersIn, rankResult, sortByBand, type RankBand } from './rank';
import { SHARED_DESCRIPTION, entry, job } from './test/fixtures';

/** A CV that plainly matches `SHARED_DESCRIPTION`. */
const MATCHING_CV =
  'Credit Risk Analyst at a London bank. Built IFRS 9 impairment models in Python and SQL, ' +
  'ran stress tests against regulatory scenarios, delivered Basel III capital reporting and ' +
  'presented results to the chief risk officer each quarter. Strong stakeholder communication.';

/** A CV about something else entirely. */
const UNRELATED_CV =
  'Pastry chef with twelve years in Michelin-starred kitchens. Laminated doughs, sugar work, ' +
  'menu development, supplier negotiation and training a brigade of eight. Food hygiene level 3.';

describe('rankResult', () => {
  it('bands a matching CV against a full advert, with the score it was banded on', () => {
    const band = rankResult(MATCHING_CV, job());

    expect(band).not.toBeNull();
    expect(['strong', 'possible', 'weak']).toContain(band?.verdict);
    expect(Number.isFinite(band?.score)).toBe(true);
  });

  it('ranks the matching CV above the unrelated one for the same advert', () => {
    const matching = rankResult(MATCHING_CV, job());
    const unrelated = rankResult(UNRELATED_CV, job());

    expect(matching?.score ?? -1).toBeGreaterThan(unrelated?.score ?? -1);
  });

  it('negative: no CV text is no band, not a weak one', () => {
    expect(rankResult(null, job())).toBeNull();
  });

  it('negative: an advert with no description is no band', () => {
    // A title alone is what a keyless feed sometimes gives. Scoring a CV against
    // three words would produce a confident-looking number from nothing.
    expect(rankResult(MATCHING_CV, job({ description: null }))).toBeNull();
  });

  it('boundary: a CV one character under the scorable minimum is no band', () => {
    const short = 'x'.repeat(MIN_SCORABLE_CHARS - 1);
    expect(rankResult(short, job())).toBeNull();
  });

  it('boundary: a CV of only whitespace is no band, however long', () => {
    expect(rankResult(' '.repeat(MIN_SCORABLE_CHARS * 2), job())).toBeNull();
  });

  it('boundary: a description one character under the minimum is no band', () => {
    const blurb = 'y'.repeat(MIN_SCORABLE_CHARS - 1);
    expect(rankResult(MATCHING_CV, job({ description: blurb }))).toBeNull();
  });

  it('boundary: a description exactly at the minimum is scored', () => {
    const blurb = 'credit risk analyst!'.padEnd(MIN_SCORABLE_CHARS, '.');
    expect(blurb.length).toBe(MIN_SCORABLE_CHARS);
    expect(rankResult(MATCHING_CV, job({ description: blurb }))).not.toBeNull();
  });

  it('is deterministic: the same two texts always give the same band', () => {
    expect(rankResult(MATCHING_CV, job())).toEqual(rankResult(MATCHING_CV, job()));
  });
});

describe('dealBreakersIn', () => {
  const advert = job({
    title: 'Scala Developer (on-site, SC clearance needed)',
    location: 'Manchester',
    description: `${SHARED_DESCRIPTION} Some C++ and .NET maintenance. On-site parking available.`,
  });

  it('finds a phrase in the title, case-insensitively', () => {
    expect(dealBreakersIn(['sc clearance'], advert)).toEqual(['sc clearance']);
  });

  it('finds a word in the location', () => {
    expect(dealBreakersIn(['manchester'], advert)).toEqual(['manchester']);
  });

  it('finds a word in the description', () => {
    expect(dealBreakersIn(['Basel III'], advert)).toEqual(['Basel III']);
  });

  it('keeps profile order, not the order found in the advert', () => {
    expect(dealBreakersIn(['Manchester', 'on-site', 'Scala'], advert)).toEqual([
      'Manchester',
      'on-site',
      'Scala',
    ]);
  });

  it('de-duplicates an entry the profile lists twice', () => {
    expect(dealBreakersIn(['on-site', 'On-Site', ' on-site '], advert)).toEqual(['on-site']);
  });

  it('boundary: "on-site" DOES match "on-site parking" — the hyphenated word is whole', () => {
    const parkingOnly = job({
      title: 'Analyst',
      description: `${SHARED_DESCRIPTION} On-site parking.`,
    });
    expect(dealBreakersIn(['on-site'], parkingOnly)).toEqual(['on-site']);
  });

  it('boundary: "SC" must not match inside "Scala"', () => {
    const scala = job({
      title: 'Scala Developer',
      location: null,
      description: SHARED_DESCRIPTION,
    });
    expect(dealBreakersIn(['SC'], scala)).toEqual([]);
  });

  it('boundary: "C" must not match every advert with a c in it', () => {
    // "Credit", "chief", "communication", "C++" — a c in every one and a match
    // in none. The single letter only counts when it stands alone.
    expect(dealBreakersIn(['C'], advert)).toEqual([]);
    const planC = job({ title: 'Plan C administrator', description: SHARED_DESCRIPTION });
    expect(dealBreakersIn(['C'], planC)).toEqual(['C']);
  });

  it('negative: a whitespace-only entry is ignored, and never matches', () => {
    expect(dealBreakersIn(['   ', '\t'], advert)).toEqual([]);
  });

  it('negative: an empty profile flags nothing', () => {
    expect(dealBreakersIn([], advert)).toEqual([]);
  });

  it('negative: an advert with no location and no description is searched by title alone', () => {
    const bare = job({
      title: 'Night shift warehouse operative',
      location: null,
      description: null,
    });
    expect(dealBreakersIn(['night shift', 'London'], bare)).toEqual(['night shift']);
  });

  it('escapes regex metacharacters: "C++" and ".NET" match themselves, literally', () => {
    expect(dealBreakersIn(['C++', '.NET'], advert)).toEqual(['C++', '.NET']);
  });

  it('escapes regex metacharacters: ".NET" does not match "internet"', () => {
    const internet = job({
      title: 'Internet sales',
      location: null,
      description: SHARED_DESCRIPTION,
    });
    expect(dealBreakersIn(['.NET'], internet)).toEqual([]);
  });

  it('negative: an entry that is only metacharacters neither throws nor matches', () => {
    expect(() => dealBreakersIn(['*', '(', '[a-z'], advert)).not.toThrow();
    expect(dealBreakersIn(['*', '(', '[a-z'], advert)).toEqual([]);
  });

  it('a multi-word phrase must be adjacent: "market risk" is not "market and credit risk"', () => {
    const split = job({
      title: 'Analyst',
      location: null,
      description: `${SHARED_DESCRIPTION} Covers market and credit risk.`,
    });
    expect(dealBreakersIn(['market risk'], split)).toEqual([]);
  });
});

describe('sortByBand', () => {
  const strong: RankBand = { verdict: 'strong', score: 84 };
  const possible: RankBand = { verdict: 'possible', score: 62 };
  const weak: RankBand = { verdict: 'weak', score: 20 };

  const a = entry({ id: 'a' });
  const b = entry({ id: 'b' });
  const c = entry({ id: 'c' });
  const d = entry({ id: 'd' });
  const e = entry({ id: 'e' });

  it('orders strong, then possible, then weak, then unranked', () => {
    const bands = new Map<string, RankBand | null>([
      ['a', null],
      ['b', weak],
      ['c', possible],
      ['d', strong],
    ]);

    expect(sortByBand([a, b, c, d], bands).map((item) => item.job.id)).toEqual([
      'd',
      'c',
      'b',
      'a',
    ]);
  });

  it('is stable: ties keep their incoming order', () => {
    const bands = new Map<string, RankBand | null>([
      ['a', strong],
      ['b', null],
      ['c', strong],
      ['d', null],
      ['e', possible],
    ]);

    expect(sortByBand([a, b, c, d, e], bands).map((item) => item.job.id)).toEqual([
      'a',
      'c',
      'e',
      'b',
      'd',
    ]);
  });

  it('treats an advert missing from the map as unranked', () => {
    const bands = new Map<string, RankBand | null>([['b', weak]]);

    expect(sortByBand([a, b], bands).map((item) => item.job.id)).toEqual(['b', 'a']);
  });

  it('boundary: an empty list stays empty, and the input is not mutated', () => {
    expect(sortByBand([], new Map())).toEqual([]);

    const input = [a, b];
    const bands = new Map<string, RankBand | null>([['b', strong]]);
    sortByBand(input, bands);
    expect(input.map((item) => item.job.id)).toEqual(['a', 'b']);
  });
});
