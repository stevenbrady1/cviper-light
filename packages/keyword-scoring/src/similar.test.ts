/**
 * Ported from `backend/ai/keywords.py::KeywordService.get_similar_terms`
 * (line 334).
 */
import { describe, expect, it } from 'vitest';
import { getSimilarTerms } from './similar';

describe('getSimilarTerms', () => {
  it('returns the curated related terms for a canonical skill', () => {
    expect(getSimilarTerms('business analyst')).toContain('business analysis');
  });

  it('walks the alias index backwards to the canonical term and its siblings', () => {
    const related = getSimilarTerms('k8s');
    expect(related).toContain('kubernetes');
  });

  it.each([
    ['analyst', 'analysis'],
    ['developer', 'development'],
    ['engineer', 'engineering'],
    ['manager', 'management'],
    ['tester', 'testing'],
  ])('derives the noun form of %s -> %s', (role, noun) => {
    expect(getSimilarTerms(`data ${role}`)).toContain(`data ${noun}`);
  });

  it('derives the role form from the noun form', () => {
    expect(getSimilarTerms('data engineering')).toContain('data engineer');
  });

  // NEGATIVE — the term must never be its own related term, or coverage
  // checks would match everything against itself.
  it('never returns the term itself', () => {
    expect(getSimilarTerms('business analyst')).not.toContain('business analyst');
  });

  // NEGATIVE — stripping a suffix from a bare suffix leaves "", which would
  // match every text ever written.
  it('never returns an empty string', () => {
    expect(getSimilarTerms('analyst')).not.toContain('');
    expect(getSimilarTerms('engineer')).not.toContain('');
  });

  // BOUNDARY
  it.each(['', '   '])('returns nothing for the empty term %j', (term) => {
    expect(getSimilarTerms(term)).toEqual([]);
  });

  it('returns nothing for an unknown term with no derivable stem', () => {
    expect(getSimilarTerms('quidditch')).toEqual([]);
  });

  it('is deterministic — the same input gives the same order twice', () => {
    expect(getSimilarTerms('project management')).toEqual(getSimilarTerms('project management'));
  });

  it('de-duplicates', () => {
    const related = getSimilarTerms('business analysis');
    expect(new Set(related).size).toBe(related.length);
  });
});
