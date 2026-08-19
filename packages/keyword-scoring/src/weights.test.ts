/**
 * Ported from `backend/ai/keywords.py::KeywordService.skill_weight` (line 284).
 *
 * ============================================================================
 * THIS IS THE FILE THAT MAKES THE SCORER BETTER THAN A WORD COUNT.
 * ============================================================================
 * If `skillWeight` ever returns a constant, every test in `match.test.ts` that
 * distinguishes a rare skill from a common one must fail. That is deliberate:
 * a constant here silently turns the whole package back into naive match
 * counting while every other test keeps passing.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SKILL_WEIGHT, skillWeight } from './weights';

describe('skillWeight', () => {
  // Ubiquitous skills. Everyone has them; they cannot carry a match.
  it.each([
    'agile',
    'scrum',
    'git',
    'jira',
    'communication',
    'teamwork',
    'leadership',
    'excel',
    'microsoft office',
    'attention to detail',
  ])('down-weights the ubiquitous skill %s', (term) => {
    expect(skillWeight(term)).toBe(0.4);
  });

  // Role-defining skills. Unlisted, so they carry full weight.
  it.each(['kubernetes', 'terraform', 'fpga', 'actuarial', 'phlebotomy'])(
    'gives the role-defining skill %s full weight',
    (term) => {
      expect(skillWeight(term)).toBe(DEFAULT_SKILL_WEIGHT);
    },
  );

  it('rates a rare skill strictly higher than a ubiquitous one', () => {
    // The single assertion the whole scoring model rests on.
    expect(skillWeight('kubernetes')).toBeGreaterThan(skillWeight('agile'));
  });

  it('is case- and whitespace-insensitive', () => {
    expect(skillWeight('  AGILE  ')).toBe(0.4);
  });

  // The alias branch: a synonym resolves to its canonical term before the
  // weight lookup, so "lean" is recognised as agile boilerplate rather than
  // being mistaken for a rare manufacturing skill.
  it('resolves an alias to its canonical term before weighting', () => {
    expect(skillWeight('lean')).toBe(0.4); // -> agile
    expect(skillWeight('sprint')).toBe(0.4); // -> scrum
  });

  // BOUNDARY
  it.each(['', '   '])('returns the default weight for the empty term %j', (term) => {
    expect(skillWeight(term)).toBe(DEFAULT_SKILL_WEIGHT);
  });

  // NEGATIVE — an unknown term must not be silently treated as boilerplate.
  it('gives an unknown term full weight rather than zero', () => {
    expect(skillWeight('quidditch')).toBe(DEFAULT_SKILL_WEIGHT);
    expect(skillWeight('quidditch')).toBeGreaterThan(0);
  });

  it('never returns zero, which would make a requirement free to miss', () => {
    for (const term of ['agile', 'kubernetes', '', 'unknown thing']) {
      expect(skillWeight(term)).toBeGreaterThan(0);
    }
  });
});
