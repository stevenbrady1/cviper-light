/**
 * The search screen's rules, with no React and no network in sight.
 *
 * What the form accepts, which boards can actually be searched, and how an
 * advert is described — all decided here so they can be tested exactly rather
 * than by rendering a screen and reading the words back off it.
 */
import { describe, expect, it } from 'vitest';

import { MAX_QUERY_CHARS } from '@cviper/job-apis';

import {
  CONTRACT_CHOICES,
  EMPTY_FORM,
  clusterSiblings,
  describeCluster,
  externalKey,
  postedLabel,
  providerAvailability,
  searchDisabledReason,
  toSearchInput,
  validateForm,
  type SearchForm,
} from './model';

function form(overrides: Partial<SearchForm> = {}): SearchForm {
  return { ...EMPTY_FORM, keywords: 'credit risk analyst', location: 'London', ...overrides };
}

describe('the empty form', () => {
  it('starts with nothing filled in and no contract filter', () => {
    expect(EMPTY_FORM).toEqual({
      keywords: '',
      location: '',
      distanceMiles: '',
      salaryMin: '',
      contractType: 'any',
    });
  });

  it('offers exactly three contract choices, the middle one meaning "no filter"', () => {
    expect(CONTRACT_CHOICES.map((choice) => choice.value)).toEqual([
      'any',
      'Contract',
      'Permanent',
    ]);
  });
});

describe('validating the form', () => {
  it('accepts a keyword-only search and a location-only search', () => {
    expect(validateForm(form({ location: '' }))).toEqual({});
    expect(validateForm(form({ keywords: '' }))).toEqual({});
  });

  it('negative: refuses a search with neither keywords nor a location', () => {
    // Both boards would answer this with everything they have, and it would
    // spend a request to fetch a page nobody asked for.
    const errors = validateForm(EMPTY_FORM);

    expect(errors.keywords).toBeDefined();
    expect(errors.keywords).toContain('job title');
  });

  it('negative: refuses a search long enough to be a paste accident', () => {
    const errors = validateForm(form({ keywords: 'a'.repeat(MAX_QUERY_CHARS + 1) }));

    expect(errors.keywords).toBeDefined();
    // Neither the text nor its length is repeated back.
    expect(errors.keywords).not.toContain('a'.repeat(20));
  });

  it('boundary: accepts text at exactly the query limit', () => {
    expect(validateForm(form({ keywords: 'a'.repeat(MAX_QUERY_CHARS) }))).toEqual({});
    expect(validateForm(form({ location: 'a'.repeat(MAX_QUERY_CHARS) }))).toEqual({});
  });

  it('negative: refuses a distance that is not a number, rather than dropping it', () => {
    // `buildSearchParams` DROPS an unreadable filter, which is right for a
    // backstop and wrong for a form: a user who typed a distance and got
    // results from three hundred miles away has been quietly ignored.
    const errors = validateForm(form({ distanceMiles: 'near-ish' }));

    expect(errors.distanceMiles).toBeDefined();
  });

  it('boundary: a distance of zero is refused and one mile is accepted', () => {
    expect(validateForm(form({ distanceMiles: '0' })).distanceMiles).toBeDefined();
    expect(validateForm(form({ distanceMiles: '1' }))).toEqual({});
  });

  it('boundary: an empty distance is not an error — it means no radius at all', () => {
    expect(validateForm(form({ distanceMiles: '' }))).toEqual({});
    expect(validateForm(form({ distanceMiles: '   ' }))).toEqual({});
  });

  it('negative: refuses a salary floor that will not read', () => {
    expect(validateForm(form({ salaryMin: '£45k' })).salaryMin).toBeDefined();
    expect(validateForm(form({ salaryMin: '-1' })).salaryMin).toBeDefined();
    expect(validateForm(form({ salaryMin: '0' })).salaryMin).toBeDefined();
  });

  it('boundary: accepts a whole-pound salary floor', () => {
    expect(validateForm(form({ salaryMin: '45000' }))).toEqual({});
    expect(validateForm(form({ salaryMin: '1' }))).toEqual({});
  });
});

describe('turning the form into a search', () => {
  it('passes the text through and leaves absent filters absent', () => {
    expect(toSearchInput(form())).toEqual({
      keywords: 'credit risk analyst',
      location: 'London',
      distanceMiles: null,
      salaryMin: null,
      employmentType: null,
    });
  });

  it('carries every filter the user actually set', () => {
    expect(
      toSearchInput(form({ distanceMiles: '15', salaryMin: '60000', contractType: 'Contract' })),
    ).toEqual({
      keywords: 'credit risk analyst',
      location: 'London',
      distanceMiles: 15,
      salaryMin: 60000,
      employmentType: 'Contract',
    });
  });

  it('sends no employment filter for "any", rather than sending both', () => {
    // Reed's default for an unmentioned flag is "include", so `null` here and
    // three explicit booleans there are the same thing said correctly once.
    expect(toSearchInput(form({ contractType: 'any' })).employmentType).toBeNull();
  });
});

describe('which boards can be searched', () => {
  it('a saved key makes the board usable, with nothing to explain', () => {
    expect(providerAvailability('reed', 'configured')).toEqual({ usable: true, reason: null });
  });

  it('negative: no key means unusable, and says where to go', () => {
    const { usable, reason } = providerAvailability('adzuna', 'missing');

    expect(usable).toBe(false);
    expect(reason).toContain('Settings');
    // Not an apology and not a fault: it is free, and the browser buttons work
    // regardless.
    expect(reason).toContain('free');
  });

  it('negative: half a credential is its own reason, not "no key"', () => {
    const { usable, reason } = providerAvailability('adzuna', 'incomplete');

    expect(usable).toBe(false);
    expect(reason).toContain('one');
    expect(reason).not.toContain('No Adzuna key');
  });

  it('negative: a locked credential store is not the same as no key', () => {
    const { usable, reason } = providerAvailability('reed', 'unreadable');

    expect(usable).toBe(false);
    // Telling somebody their saved key is missing when the keychain is merely
    // locked invites them to paste a key they already have.
    expect(reason).toContain('could not be read');
  });
});

describe('duplicate clusters — flagged, never merged', () => {
  const clusters = [{ jobIds: ['a', 'b', 'c'] }, { jobIds: ['d', 'e'] }];

  it('finds the other adverts in a job’s cluster', () => {
    expect(clusterSiblings('a', clusters)).toEqual(['a', 'b', 'c']);
    expect(clusterSiblings('e', clusters)).toEqual(['d', 'e']);
  });

  it('reports no cluster for an advert that is on its own', () => {
    expect(clusterSiblings('z', clusters)).toBeNull();
  });

  it('counts the whole group, so nothing is implied to have been removed', () => {
    // "2 similar postings" and both still on screen with both apply links. A
    // wrong merge deletes a real advert and its apply URL with no error, and a
    // local app has no undo.
    expect(describeCluster(2)).toContain('2');
    expect(describeCluster(2)).toContain('similar');
    expect(describeCluster(3)).toContain('3');
  });
});

describe('an advert’s identity', () => {
  it('keys an advert by its board and the board’s own id', () => {
    expect(externalKey('reed', '55512345')).toBe('reed:55512345');
  });

  it('negative: an advert with no provider id has no key at all', () => {
    // Every manually entered job has `external_id IS NULL`. Keying them all as
    // `manual:` would make every hand-typed job look like the same advert.
    expect(externalKey('manual', null)).toBeNull();
    expect(externalKey('reed', '')).toBeNull();
  });
});

describe('when an advert was posted', () => {
  const TODAY = '2026-08-19';

  it('says today, yesterday, and a count of days', () => {
    expect(postedLabel('2026-08-19', TODAY)).toBe('Posted today');
    expect(postedLabel('2026-08-18', TODAY)).toBe('Posted yesterday');
    expect(postedLabel('2026-08-14', TODAY)).toBe('Posted 5 days ago');
  });

  it('boundary: falls back to the date once "days ago" stops being useful', () => {
    expect(postedLabel('2026-06-19', TODAY)).toBe('Posted 2026-06-19');
  });

  it('boundary: a date in the future reads as today rather than as negative days', () => {
    // A board with a clock a few hours ahead is not a reason to say
    // "posted -1 days ago".
    expect(postedLabel('2026-08-20', TODAY)).toBe('Posted today');
  });

  it('negative: says nothing at all when the board did not give a date', () => {
    expect(postedLabel(null, TODAY)).toBeNull();
    expect(postedLabel('not-a-date', TODAY)).toBeNull();
  });
});

describe('why the Search button cannot be pressed', () => {
  it('says nothing when there is a board to search', () => {
    expect(searchDisabledReason(1)).toBeNull();
    expect(searchDisabledReason(2)).toBeNull();
  });

  it('boundary: with no usable board, it points at the browser buttons FIRST', () => {
    const reason = searchDisabledReason(0) ?? '';

    // Not an apology, and not "go and set up a key" — the thing that works
    // right now is two inches below the button and needs nothing.
    expect(reason).toContain('below');
    expect(reason).toContain('no key');
    expect(reason.indexOf('below')).toBeLessThan(reason.length);
  });
});
