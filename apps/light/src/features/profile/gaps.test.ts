/**
 * The skills-gap count, pinned at its edges.
 *
 * Every term used here is in `COMMON_SKILLS` — the vocabulary
 * `buildJobPosting` scans an advert with — so a test that fails is a test
 * about counting, not about whether the lexicon happens to know a word.
 */
import { describe, expect, it } from 'vitest';

import { type Job } from '@cviper/core-types';
import { COMMON_SKILLS, extractSkills } from '@cviper/keyword-scoring';

import { MAX_GAPS, describeGaps, describedJobs, skillGaps } from './gaps';

const NOW = '2026-09-14T09:00:00.000Z';

function job(id: string, description: string | null): Job {
  return {
    id,
    source: 'manual',
    external_id: null,
    title: `Job ${id}`,
    company: 'Acme',
    location: 'London',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description,
    url: null,
    posted_date: null,
    created_at: NOW,
  };
}

// No fixture ends a sentence on a skill: `.` is a token character in the
// scanner's whole-token boundary (so `node.js` and `.net` stay whole), and
// "Kubernetes." is therefore not a mention of kubernetes. That is the ported
// scorer's behaviour, pinned by its parity tests, and this file tests counting.
const CV = 'Five years of Python and SQL, deploying with Docker daily';

describe('skillGaps', () => {
  it('counts each skill the adverts name that the CV does not, with its share', () => {
    const gaps = skillGaps({
      cvText: CV,
      jobs: [
        job('a', 'Python, Kubernetes and Azure please'),
        job('b', 'Kubernetes and React please'),
        job('c', 'SQL and Kubernetes please'),
      ],
    });

    expect(gaps).toEqual([
      { skill: 'kubernetes', wantedBy: 3, share: 1 },
      { skill: 'azure', wantedBy: 1, share: 1 / 3 },
      { skill: 'react', wantedBy: 1, share: 1 / 3 },
    ]);
  });

  it('sorts by how many adverts want the skill, then by name to break the tie', () => {
    const gaps = skillGaps({
      cvText: CV,
      jobs: [job('a', 'vue, angular, react, typescript'), job('b', 'react, angular')],
    });

    expect(gaps.map((gap) => gap.skill)).toEqual(['angular', 'react', 'typescript', 'vue']);
  });

  it('counts a skill once per advert however often the advert repeats it', () => {
    const gaps = skillGaps({
      cvText: CV,
      jobs: [job('a', 'React, more React, did we mention React? React again')],
    });

    expect(gaps).toEqual([{ skill: 'react', wantedBy: 1, share: 1 }]);
  });

  it('credits a synonym and a US/UK spelling as coverage, the way the scorer does', () => {
    // The advert spells it the US way; the lexicon term and the CV are UK.
    const american = skillGaps({
      cvText: 'Ran search engine optimisation for a retailer',
      jobs: [job('a', 'Must know search engine optimization, ideally')],
    });
    expect(american).toEqual([]);

    // And the other way round.
    const british = skillGaps({
      cvText: 'Search engine optimization for a retailer',
      jobs: [job('a', 'Must know search engine optimisation, ideally')],
    });
    expect(british).toEqual([]);
  });

  it('boundary: excludes adverts with no description from the share', () => {
    const gaps = skillGaps({
      cvText: CV,
      jobs: [
        job('a', 'Kubernetes please'),
        job('b', null),
        job('c', '   \n'),
        job('d', 'Kubernetes too'),
      ],
    });

    expect(gaps).toEqual([{ skill: 'kubernetes', wantedBy: 2, share: 1 }]);
  });

  it('boundary: no adverts with a description is an empty list, not a division by zero', () => {
    expect(skillGaps({ cvText: CV, jobs: [] })).toEqual([]);
    expect(skillGaps({ cvText: CV, jobs: [job('a', null), job('b', '')] })).toEqual([]);
  });

  it('boundary: no CV means nothing is covered, so every skill named is a gap', () => {
    const gaps = skillGaps({ cvText: null, jobs: [job('a', 'Python and Docker please')] });

    expect(gaps).toEqual([
      { skill: 'docker', wantedBy: 1, share: 1 },
      { skill: 'python', wantedBy: 1, share: 1 },
    ]);
  });

  it('boundary: a CV that mentions everything leaves no gaps', () => {
    expect(skillGaps({ cvText: CV, jobs: [job('a', 'Python, SQL, Docker please')] })).toEqual([]);
  });

  it('negative: an advert that names no lexicon skill still counts in the share', () => {
    const gaps = skillGaps({
      cvText: CV,
      jobs: [job('a', 'Kubernetes please'), job('b', 'A lovely office with free fruit.')],
    });

    expect(gaps).toEqual([{ skill: 'kubernetes', wantedBy: 1, share: 0.5 }]);
  });

  it(`boundary: caps the list at ${MAX_GAPS}, keeping the sort order`, () => {
    const many = COMMON_SKILLS.slice(0, 60).join(', ') + ' required';
    const gaps = skillGaps({ cvText: null, jobs: [job('a', many)] });

    const named = extractSkills(many, COMMON_SKILLS);
    expect(named.length).toBeGreaterThan(MAX_GAPS);

    expect(gaps).toHaveLength(MAX_GAPS);
    // Every skill is wanted by the one advert, so the tie-break decides: the
    // first MAX_GAPS names in order.
    expect(gaps.map((gap) => gap.skill)).toEqual([...named].sort().slice(0, MAX_GAPS));
    expect(gaps.every((gap) => gap.wantedBy === 1 && gap.share === 1)).toBe(true);
  });
});

describe('describedJobs', () => {
  it('keeps only the adverts with something to read', () => {
    const kept = describedJobs([job('a', 'x'), job('b', null), job('c', ' '), job('d', 'y')]);
    expect(kept.map((kept) => kept.id)).toEqual(['a', 'd']);
  });
});

describe('describeGaps', () => {
  const gap = (skill: string) => ({ skill, wantedBy: 1, share: 1 });

  it('boundary: no adverts to read', () => {
    expect(describeGaps([], 0)).toBe('None of the adverts on your tracker has a description.');
  });

  it('boundary: adverts, no gaps', () => {
    expect(describeGaps([], 1)).toBe('Your CV mentions every skill this advert names.');
    expect(describeGaps([], 4)).toBe('Your CV mentions every skill these 4 adverts name.');
  });

  it('counts the gaps and the adverts, singular and plural', () => {
    expect(describeGaps([gap('react')], 1)).toBe(
      '1 skill this advert asks for that your CV does not mention.',
    );
    expect(describeGaps([gap('react'), gap('vue')], 7)).toBe(
      '2 skills these 7 adverts ask for that your CV does not mention.',
    );
  });

  it('boundary: at the cap it says these are the most wanted, not all of them', () => {
    const capped = Array.from({ length: MAX_GAPS }, (_, at) => gap(`skill-${at}`));
    expect(describeGaps(capped, 9)).toBe(
      `The ${MAX_GAPS} skills these 9 adverts ask for most that your CV does not mention.`,
    );
  });
});
