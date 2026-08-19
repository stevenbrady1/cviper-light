/**
 * Ported from `backend/ai/fallbacks.py::FallbackService.matching` (line 398)
 * and the scoring constants at lines 75-94.
 */
import { describe, expect, it } from 'vitest';
import type { CvProfile, JobPosting } from './profile';
import {
  COVERAGE_SCALE,
  KEYWORD_SCORING_VERSION,
  MATCH_SCORE_HARD_FLOOR,
  RAW_SCORE_CAP,
  RAW_SCORE_UNMATCHED,
  TITLE_SCORE_FLOOR,
  matchProfileToJob,
} from './match';

function profile(over: Partial<CvProfile> = {}): CvProfile {
  return {
    skills: [],
    relatedSkills: [],
    suggestedTitles: [],
    jobTitles: [],
    relatedTitles: [],
    ...over,
  };
}

function job(over: Partial<JobPosting> = {}): JobPosting {
  return {
    title: '',
    description: '',
    keySkills: [],
    essentialSkills: [],
    keyRequirements: [],
    ...over,
  };
}

describe('ported scoring constants', () => {
  it('carries the source values', () => {
    expect(KEYWORD_SCORING_VERSION).toBe(3);
    expect(COVERAGE_SCALE).toBe(70);
    expect(RAW_SCORE_CAP).toBe(95);
    expect(RAW_SCORE_UNMATCHED).toBe(30);
    expect(MATCH_SCORE_HARD_FLOOR).toBe(10);
    expect(TITLE_SCORE_FLOOR).toEqual({ exact: 65, strong: 65, partial: 0, none: 0 });
  });
});

// ============================================================================
// RARITY WEIGHTING — the reason this package exists.
// ============================================================================
describe('rarity-weighted coverage', () => {
  const REQUIRED = ['kubernetes', 'terraform', 'agile', 'git', 'jira'];
  const advert = job({
    title: 'Platform Role',
    description: 'We need kubernetes, terraform, agile, git and jira experience here.',
    keySkills: REQUIRED,
  });

  const rareCv = profile({ skills: ['kubernetes', 'terraform'] });
  const commonCv = profile({ skills: ['agile', 'git', 'jira'] });

  it('scores TWO RARE skills above THREE COMMON ones', () => {
    // This is the assertion that proves the weighting is real. Counting
    // matches instead of weighting them inverts the result — the three-skill
    // CV wins — so a `skillWeight` stubbed to a constant fails right here.
    const rare = matchProfileToJob(rareCv, advert);
    const common = matchProfileToJob(commonCv, advert);

    expect(rare.matchScore).toBeGreaterThan(common.matchScore);
    expect(common.covered.length).toBeGreaterThan(rare.covered.length);
  });

  it('produces the exact ported arithmetic', () => {
    // total weight = 1.0 + 1.0 + 0.4 + 0.4 + 0.4 = 3.2
    const rare = matchProfileToJob(rareCv, advert);
    expect(rare.coverage).toBeCloseTo(2.0 / 3.2, 10); // 0.625
    expect(rare.coveragePoints).toBeCloseTo(43.75, 10);
    expect(rare.rawScore).toBe(44); // round(43.75 + 0 title bonus)
    expect(rare.missingPenalty).toBe(6); // round(0.375 * 15) = round(5.625)
    expect(rare.matchScore).toBe(38);

    const common = matchProfileToJob(commonCv, advert);
    expect(common.coverage).toBeCloseTo(1.2 / 3.2, 10); // 0.375
    expect(common.coveragePoints).toBeCloseTo(26.25, 10);
    expect(common.rawScore).toBe(26);
    expect(common.missingPenalty).toBe(9); // round(0.625 * 15) = round(9.375)
    expect(common.matchScore).toBe(17);
  });

  it('separates a single rare match from a single common match', () => {
    const twoRequirements = job({
      title: 'Platform Role',
      description: 'kubernetes and agile experience wanted',
      keySkills: ['kubernetes', 'agile'],
    });
    const rare = matchProfileToJob(profile({ skills: ['kubernetes'] }), twoRequirements);
    const common = matchProfileToJob(profile({ skills: ['agile'] }), twoRequirements);
    expect(rare.matchScore).toBe(46);
    expect(common.matchScore).toBe(MATCH_SCORE_HARD_FLOOR);
    expect(rare.matchScore).not.toBe(common.matchScore);
  });
});

describe('requirement coverage', () => {
  it('counts a synonym as covered', () => {
    const advert = job({
      title: 'Platform Engineer',
      description: 'kubernetes required',
      keySkills: ['kubernetes'],
    });
    const withAlias = matchProfileToJob(profile({ skills: ['k8s'] }), advert);
    expect(withAlias.missingEssential).toEqual([]);
    expect(withAlias.coverage).toBe(1);
  });

  it('prefers essentialSkills over keySkills when both are present', () => {
    const advert = job({
      title: 'Role',
      description: 'python and excel',
      keySkills: ['python', 'excel'],
      essentialSkills: ['python'],
    });
    const result = matchProfileToJob(profile({ skills: ['python'] }), advert);
    expect(result.required).toEqual(['python']);
    expect(result.coverage).toBe(1);
  });

  it('lists what the candidate cannot do in missingEssential', () => {
    const advert = job({
      title: 'Role',
      description: 'python and kubernetes and terraform',
      keySkills: ['python', 'kubernetes', 'terraform'],
    });
    const result = matchProfileToJob(profile({ skills: ['python'] }), advert);
    expect(result.missingEssential).toEqual(['kubernetes', 'terraform']);
  });
});

describe('title matching', () => {
  it('treats a seniority-only difference as an exact match', () => {
    const result = matchProfileToJob(
      profile({ jobTitles: ['Business Analyst'], skills: ['sql'] }),
      job({ title: 'Senior Business Analyst', description: 'sql needed', keySkills: ['sql'] }),
    );
    expect(result.titleMatchStrength).toBe('exact');
    expect(result.titleMatchBonus).toBe(30);
  });

  it('applies the title-aware floor so an exact title is never buried', () => {
    // Covers nothing at all, but the title is exact: the floor protects it.
    const result = matchProfileToJob(
      profile({ jobTitles: ['Business Analyst'] }),
      job({
        title: 'Business Analyst',
        description: 'terraform kubernetes',
        keySkills: ['terraform', 'kubernetes'],
      }),
    );
    expect(result.coverage).toBe(0);
    expect(result.matchScore).toBe(TITLE_SCORE_FLOOR.exact);
  });

  // NEGATIVE
  it('gives no bonus for an unrelated title', () => {
    const result = matchProfileToJob(
      profile({ jobTitles: ['Dental Nurse'] }),
      job({ title: 'Kubernetes Platform Engineer', description: 'x', keySkills: [] }),
    );
    expect(result.titleMatchStrength).toBe('none');
    expect(result.titleMatchBonus).toBe(0);
  });
});

describe('adverts with no extractable requirements', () => {
  it('falls back to matched breadth with diminishing returns', () => {
    const result = matchProfileToJob(
      profile({ skills: ['python', 'sql'] }),
      job({ title: 'Role', description: 'we like python and sql here', keySkills: [] }),
    );
    expect(result.required).toEqual([]);
    expect(result.coveragePoints).toBe(20); // 2 matches * 10
    expect(result.missingPenalty).toBe(0);
  });

  it('caps the breadth proxy at the coverage scale', () => {
    const skills = ['python', 'sql', 'aws', 'docker', 'kubernetes', 'react', 'linux', 'azure'];
    const result = matchProfileToJob(
      profile({ skills }),
      job({ title: 'Role', description: skills.join(' and '), keySkills: [] }),
    );
    expect(result.coveragePoints).toBe(COVERAGE_SCALE);
  });

  // BOUNDARY — nothing to go on at all is "unknown", not "bad". The source
  // calls this the neutral no-signal baseline.
  it('returns the unmatched baseline when there is no signal whatsoever', () => {
    const result = matchProfileToJob(profile(), job({ title: 'Barista', description: 'be nice' }));
    expect(result.rawScore).toBe(RAW_SCORE_UNMATCHED);
    expect(result.matchScore).toBe(RAW_SCORE_UNMATCHED);
  });

  // ...but a stated requirement the candidate misses flows through to the
  // floor rather than borrowing that baseline.
  it('does not borrow the baseline when requirements exist and none are covered', () => {
    const result = matchProfileToJob(
      profile(),
      job({ title: 'Role', description: 'terraform', keySkills: ['terraform'] }),
    );
    expect(result.matchScore).toBe(MATCH_SCORE_HARD_FLOOR);
  });
});

describe('score bounds', () => {
  it('never exceeds the keyword-only cap, even on a perfect match', () => {
    const skills = ['python', 'sql', 'aws', 'docker', 'kubernetes'];
    const result = matchProfileToJob(
      profile({ skills, jobTitles: ['Platform Engineer'] }),
      job({
        title: 'Platform Engineer',
        description: skills.join(' and '),
        keySkills: skills,
      }),
    );
    expect(result.coverage).toBe(1);
    expect(result.matchScore).toBeLessThanOrEqual(RAW_SCORE_CAP);
    expect(result.matchScore).toBeGreaterThan(80);
  });

  it('never drops below the hard floor, even with nothing in common', () => {
    const result = matchProfileToJob(
      profile({ skills: ['phlebotomy'] }),
      job({
        title: 'Kubernetes Engineer',
        description: 'kubernetes terraform',
        keySkills: ['kubernetes', 'terraform'],
      }),
    );
    expect(result.matchScore).toBe(MATCH_SCORE_HARD_FLOOR);
  });

  it('always returns an integer inside 0..100', () => {
    const cases: [CvProfile, JobPosting][] = [
      [profile(), job()],
      [profile({ skills: ['python'] }), job({ keySkills: ['python'], description: 'python' })],
      [profile({ skills: ['agile'] }), job({ keySkills: ['terraform'], description: 'terraform' })],
    ];
    for (const [p, j] of cases) {
      const { matchScore } = matchProfileToJob(p, j);
      expect(Number.isInteger(matchScore)).toBe(true);
      expect(matchScore).toBeGreaterThanOrEqual(0);
      expect(matchScore).toBeLessThanOrEqual(100);
    }
  });
});

describe('ultra-short token gating', () => {
  // "r" appears inside "R&D", "Q1 results" and a hundred other places. The
  // source credits a one- or two-character skill only when the advert's own
  // posted skill list corroborates it.
  it('does not credit a two-character skill on a bare text hit', () => {
    const result = matchProfileToJob(
      profile({ skills: ['r'] }),
      job({ title: 'Role', description: 'our R&D team is growing', keySkills: [] }),
    );
    expect(result.matched).toEqual([]);
  });

  it('credits it when the advert posts it as a skill', () => {
    const result = matchProfileToJob(
      profile({ skills: ['r'] }),
      job({ title: 'Role', description: 'our R&D team', keySkills: ['r'] }),
    );
    expect(result.matched).toContain('r');
  });

  it('still credits a short SYMBOL skill on a text hit', () => {
    const result = matchProfileToJob(
      profile({ skills: ['c#'] }),
      job({ title: 'Role', description: 'we write c# here', keySkills: [] }),
    );
    expect(result.matched).toContain('c#');
  });
});

describe('determinism', () => {
  it('gives the same answer twice for the same input', () => {
    const p = profile({ skills: ['python', 'sql'], jobTitles: ['Data Engineer'] });
    const j = job({
      title: 'Data Engineer',
      description: 'python sql',
      keySkills: ['python', 'sql'],
    });
    expect(matchProfileToJob(p, j)).toEqual(matchProfileToJob(p, j));
  });

  it('reports the scoring version so old scores are never compared to new', () => {
    expect(matchProfileToJob(profile(), job()).scoringVersion).toBe(KEYWORD_SCORING_VERSION);
  });
});
