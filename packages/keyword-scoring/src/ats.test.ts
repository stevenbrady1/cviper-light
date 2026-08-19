/**
 * Ported from `backend/ai/fallbacks.py::FallbackService.ats_score` (line 965),
 * `_cv_covers_term` (line 949) and `_ATS_STOPWORDS` (line 940).
 */
import { describe, expect, it } from 'vitest';
import { ATS_STOPWORDS, atsScore, cvCoversTerm } from './ats';

const ADVERT = [
  'Senior Business Analyst — Markets Technology',
  'We need strong SQL, stakeholder management and requirements gathering skills',
  'across derivatives and regulatory reporting programmes within investment banking',
].join('\n');

describe('cvCoversTerm', () => {
  it('credits a direct mention', () => {
    expect(cvCoversTerm('sql', 'strong sql skills')).toBe(true);
  });

  it('credits a synonym', () => {
    expect(cvCoversTerm('kubernetes', 'ran k8s clusters')).toBe(true);
  });

  it('credits a US/UK spelling variant', () => {
    expect(cvCoversTerm('optimisation', 'cost optimization programme')).toBe(true);
  });

  // NEGATIVE
  it('does not credit a term the CV never uses', () => {
    expect(cvCoversTerm('terraform', 'strong sql skills')).toBe(false);
  });

  it('does not credit a substring hit', () => {
    expect(cvCoversTerm('java', 'javascript everywhere')).toBe(false);
  });

  // BOUNDARY
  it.each(['', '   '])('returns false for the empty term %j', (term) => {
    expect(cvCoversTerm(term, 'anything')).toBe(false);
  });

  it('returns false against an empty CV', () => {
    expect(cvCoversTerm('sql', '')).toBe(false);
  });
});

describe('atsScore', () => {
  it('scores a CV that echoes the advert far above one that does not', () => {
    const good = atsScore(
      'Business analyst with SQL, stakeholder management, requirements gathering, ' +
        'derivatives and regulatory reporting across investment banking programmes',
      ADVERT,
    );
    const poor = atsScore('Pastry chef. Bread, cakes, and a friendly manner.', ADVERT);
    expect(good.score).toBeGreaterThan(poor.score);
    expect(good.score).toBeGreaterThan(40);
  });

  it('reports the advert terms the CV uses in keywordMatches', () => {
    const result = atsScore('Strong SQL and stakeholder management experience', ADVERT);
    expect(result.keywordMatches).toContain('sql');
    expect(result.keywordMatches).toContain('stakeholder management');
  });

  it('reports the advert terms the CV omits in missingKeywords', () => {
    const result = atsScore('Strong SQL experience', ADVERT);
    expect(result.missingKeywords).toContain('stakeholder management');
    expect(result.missingKeywords).not.toContain('sql');
  });

  it('includes prose words the lexicon has never heard of', () => {
    // "derivatives" and "regulatory" are not lexicon skills. Without the prose
    // layer the ATS screen would be blind to most of a real advert.
    const result = atsScore('Strong SQL experience', ADVERT);
    expect(result.missingKeywords).toContain('derivatives');
  });

  it('does not double-count a word already consumed by a skill phrase', () => {
    // "management" belongs to "stakeholder management" and must not also
    // appear as a standalone prose keyword.
    const result = atsScore('Strong SQL experience', ADVERT);
    const standalone = result.missingKeywords.filter((word) => word === 'management');
    expect(standalone).toEqual([]);
  });

  it('excludes the stopwords', () => {
    const result = atsScore('nothing relevant', ADVERT);
    for (const word of result.missingKeywords) {
      expect(ATS_STOPWORDS.has(word)).toBe(false);
    }
  });

  it('ranks skill terms above prose terms in the missing list', () => {
    const result = atsScore('Pastry chef.', ADVERT);
    const firstProseIndex = result.missingKeywords.findIndex((word) => word === 'derivatives');
    const sqlIndex = result.missingKeywords.indexOf('sql');
    expect(sqlIndex).toBeGreaterThanOrEqual(0);
    expect(sqlIndex).toBeLessThan(firstProseIndex);
  });

  // BOUNDARY — the source caps these lists.
  it('caps the reported lists at the source limits', () => {
    const result = atsScore('Pastry chef.', ADVERT);
    expect(result.missingKeywords.length).toBeLessThanOrEqual(15);
    expect(result.keywordMatches.length).toBeLessThanOrEqual(20);
    expect(result.suggestions.length).toBeLessThanOrEqual(5);
  });

  // BOUNDARY — 0 and 100 are both genuinely reachable on this sub-score, even
  // though the headline match score is floored and capped.
  it('scores 0 when the CV shares nothing with the advert', () => {
    const result = atsScore('zzz', 'Kubernetes Terraform Ansible Prometheus');
    expect(result.score).toBe(0);
  });

  it('scores 100 when the CV contains every term the advert names', () => {
    const advert = 'Kubernetes and Terraform';
    const result = atsScore('Kubernetes and Terraform', advert);
    expect(result.score).toBe(100);
  });

  it('always returns an integer inside 0..100', () => {
    for (const [cv, jd] of [
      ['', ''],
      ['a', 'b'],
      ['sql', ADVERT],
      [ADVERT, ADVERT],
    ] as const) {
      const { score } = atsScore(cv, jd);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  // BOUNDARY — nothing to measure against must not throw or invent a number.
  it('scores 0 with no divisor rather than dividing by zero', () => {
    const result = atsScore('anything', '');
    expect(result.score).toBe(0);
    expect(result.keywordMatches).toEqual([]);
  });

  it('gives tiered advice that matches the score band', () => {
    const poor = atsScore('zzz', ADVERT);
    expect(poor.score).toBeLessThan(60);
    expect(poor.suggestions[0]).toMatch(/keywords/i);

    const strong = atsScore('Kubernetes and Terraform', 'Kubernetes and Terraform');
    expect(strong.score).toBe(100);
    expect(strong.suggestions.length).toBe(1);
  });

  it('is deterministic', () => {
    expect(atsScore('Strong SQL', ADVERT)).toEqual(atsScore('Strong SQL', ADVERT));
  });
});
