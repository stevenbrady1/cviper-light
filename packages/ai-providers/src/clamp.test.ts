/**
 * Clamping is a CLOSED, NAMED LIST. Every entry here is a deviation a small
 * model actually produces, and every entry reports itself in `applied` so a bad
 * result can be traced to the repair that let it through.
 *
 * The `does NOT clamp` block is the more important half: it pins the things we
 * refuse to guess at, where the right answer is to fail validation and spend
 * the one retry.
 */
import { CvAnalysisSchema } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import { clampAnalysis } from './clamp';

/** A minimal object that already satisfies the schema. */
function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    match_score: 70,
    verdict: 'possible',
    summary: 'A fair fit.',
    matched_skills: ['Python'],
    missing_skills: ['Kubernetes'],
    keyword_gaps: ['CI/CD'],
    matched_keywords: ['Python'],
    suggestions: [
      { section: 'Skills', issue: 'No Kubernetes', recommendation: 'Add it', priority: 'high' },
    ],
    ats_notes: ['Two columns will not parse.'],
    ...overrides,
  };
}

describe('clampAnalysis — match_score', () => {
  it('turns a numeric string into a number', () => {
    const { value, applied } = clampAnalysis(valid({ match_score: '87' }));
    expect(value).toMatchObject({ match_score: 87 });
    expect(applied).toContain('match_score:string-to-number');
  });

  it('tolerates whitespace and a percent sign', () => {
    expect(clampAnalysis(valid({ match_score: ' 87 % ' })).value).toMatchObject({
      match_score: 87,
    });
  });

  it('rounds a float', () => {
    const { value, applied } = clampAnalysis(valid({ match_score: 86.6 }));
    expect(value).toMatchObject({ match_score: 87 });
    expect(applied).toContain('match_score:rounded');
  });

  it('clamps above the ceiling', () => {
    const { value, applied } = clampAnalysis(valid({ match_score: 105 }));
    expect(value).toMatchObject({ match_score: 100 });
    expect(applied).toContain('match_score:clamped-to-ceiling');
  });

  it('clamps below the floor', () => {
    const { value, applied } = clampAnalysis(valid({ match_score: -3 }));
    expect(value).toMatchObject({ match_score: 0 });
    expect(applied).toContain('match_score:clamped-to-floor');
  });

  it('boundary: 0 and 100 pass through untouched', () => {
    for (const score of [0, 100]) {
      const { value, applied } = clampAnalysis(valid({ match_score: score }));
      expect(value).toMatchObject({ match_score: score });
      expect(applied.filter((name) => name.startsWith('match_score'))).toEqual([]);
    }
  });

  it('boundary: 101 and -1 are the first values to move', () => {
    expect(clampAnalysis(valid({ match_score: 101 })).value).toMatchObject({ match_score: 100 });
    expect(clampAnalysis(valid({ match_score: -1 })).value).toMatchObject({ match_score: 0 });
  });
});

describe('clampAnalysis — priority', () => {
  function priorityOf(raw: unknown): unknown {
    const { value } = clampAnalysis(
      valid({
        suggestions: [{ section: 'Skills', issue: 'x', recommendation: 'y', priority: raw }],
      }),
    );
    const suggestions = (value as { suggestions: Array<{ priority: unknown }> }).suggestions;
    return suggestions[0]?.priority;
  }

  it('normalises case and whitespace', () => {
    expect(priorityOf(' HIGH ')).toBe('high');
    expect(priorityOf('Medium')).toBe('medium');
  });

  it('maps synonyms to the nearest of high, medium, low', () => {
    expect(priorityOf('urgent')).toBe('high');
    expect(priorityOf('critical')).toBe('high');
    expect(priorityOf('moderate')).toBe('medium');
    expect(priorityOf('minor')).toBe('low');
    expect(priorityOf('nice to have')).toBe('low');
  });

  it('maps a numeric priority, which small models emit constantly', () => {
    expect(priorityOf(1)).toBe('high');
    expect(priorityOf('2')).toBe('medium');
    expect(priorityOf(3)).toBe('low');
  });

  it('falls back to medium for something unrecognisable, and says so', () => {
    const { value, applied } = clampAnalysis(
      valid({
        suggestions: [{ section: 'Skills', issue: 'x', recommendation: 'y', priority: 'banana' }],
      }),
    );
    expect((value as { suggestions: Array<{ priority: string }> }).suggestions[0]?.priority).toBe(
      'medium',
    );
    expect(applied).toContain('suggestions.priority:defaulted');
  });

  it('leaves a suggestion that is not an object alone rather than inventing one', () => {
    const { value } = clampAnalysis(valid({ suggestions: ['just add Kubernetes'] }));
    expect((value as { suggestions: unknown[] }).suggestions[0]).toBe('just add Kubernetes');
  });
});

describe('clampAnalysis — arrays', () => {
  it('fills in every absent array', () => {
    const { value, applied } = clampAnalysis({ match_score: 70, summary: 'Fair.' });
    expect(value).toMatchObject({
      matched_skills: [],
      missing_skills: [],
      keyword_gaps: [],
      matched_keywords: [],
      ats_notes: [],
      suggestions: [],
    });
    expect(applied).toContain('matched_skills:absent-to-empty');
    expect(applied).toContain('suggestions:absent-to-empty');
  });

  it('treats an explicit null the same as absent', () => {
    const { value } = clampAnalysis(valid({ ats_notes: null }));
    expect(value).toMatchObject({ ats_notes: [] });
  });

  it('splits a comma-separated string into an array', () => {
    const { value, applied } = clampAnalysis(valid({ matched_skills: 'Python, AWS , SQL' }));
    expect(value).toMatchObject({ matched_skills: ['Python', 'AWS', 'SQL'] });
    expect(applied).toContain('matched_skills:string-to-array');
  });

  it('splits a newline-separated string too, and drops the empties', () => {
    const { value } = clampAnalysis(valid({ ats_notes: 'Two columns\n\nNo dates\n' }));
    expect(value).toMatchObject({ ats_notes: ['Two columns', 'No dates'] });
  });

  it('boundary: a whitespace-only string becomes an empty array, not [""]', () => {
    expect(clampAnalysis(valid({ keyword_gaps: '   ' })).value).toMatchObject({ keyword_gaps: [] });
  });
});

describe('clampAnalysis — verdict', () => {
  it('fills in an absent verdict from the score, because it is overwritten anyway', () => {
    const { value, applied } = clampAnalysis(valid({ verdict: undefined }));
    expect(value).toMatchObject({ verdict: 'possible' });
    expect(applied).toContain('verdict:derived');
  });

  it('replaces a verdict outside the closed set', () => {
    const { value } = clampAnalysis(valid({ match_score: 90, verdict: 'excellent' }));
    expect(value).toMatchObject({ verdict: 'strong' });
  });

  it('does NOT report a clamp when the model happened to agree with the schema', () => {
    const { applied } = clampAnalysis(valid({ verdict: 'possible' }));
    expect(applied.filter((name) => name.startsWith('verdict'))).toEqual([]);
  });
});

describe('clampAnalysis — what it deliberately does NOT do', () => {
  it('does not invent a missing match_score', () => {
    // Without a score there is no analysis. Failing validation here is what
    // buys the retry; guessing a number would ship a fabricated result.
    const { value } = clampAnalysis({ summary: 'Looks fine.' });
    expect(value).not.toHaveProperty('match_score');
    expect(CvAnalysisSchema.safeParse(value).success).toBe(false);
  });

  it('does not invent a missing summary', () => {
    const withoutSummary = valid();
    delete withoutSummary['summary'];
    expect(CvAnalysisSchema.safeParse(clampAnalysis(withoutSummary).value).success).toBe(false);
  });

  it('does not rescale a 0-to-1 fraction into a percentage', () => {
    // 0.84 might mean "84%" — or it might be a genuine score of 1 that the
    // model wrote with a decimal point. Guessing turns a catastrophic match
    // into an excellent one. Rounding to 1 is honest and fails nothing.
    expect(clampAnalysis(valid({ match_score: 0.84 })).value).toMatchObject({ match_score: 1 });
  });

  it('does not coerce non-numeric nonsense into a score', () => {
    const { value } = clampAnalysis(valid({ match_score: 'very good' }));
    expect(value).toMatchObject({ match_score: 'very good' });
    expect(CvAnalysisSchema.safeParse(value).success).toBe(false);
  });

  it('does not strip non-string elements out of a string array', () => {
    const { value } = clampAnalysis(valid({ matched_skills: ['Python', 42] }));
    expect(value).toMatchObject({ matched_skills: ['Python', 42] });
    expect(CvAnalysisSchema.safeParse(value).success).toBe(false);
  });

  it('leaves unknown extra keys alone — the schema is loose on purpose', () => {
    const { value } = clampAnalysis(valid({ confidence: 0.9 }));
    expect(value).toMatchObject({ confidence: 0.9 });
    expect(CvAnalysisSchema.safeParse(value).success).toBe(true);
  });

  it('negative: a non-object input is returned untouched with no clamps', () => {
    for (const junk of [null, undefined, 42, 'text', [1, 2]]) {
      const { value, applied } = clampAnalysis(junk);
      expect(value).toEqual(junk);
      expect(applied).toEqual([]);
    }
  });

  it('does not mutate the object it was given', () => {
    const original = valid({ match_score: '87' });
    clampAnalysis(original);
    expect(original['match_score']).toBe('87');
  });
});

describe('clampAnalysis — the whole point', () => {
  it('turns a realistically sloppy 3B reply into something the schema accepts', () => {
    const sloppy = {
      match_score: '105',
      summary: 'Strong on Python, light on cloud.',
      matched_skills: 'Python, Django',
      suggestions: [
        { section: 'Skills', issue: 'No AWS', recommendation: 'Add AWS', priority: 'URGENT' },
      ],
    };
    const { value, applied } = clampAnalysis(sloppy);
    const parsed = CvAnalysisSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    expect(applied.length).toBeGreaterThan(3);
  });

  it('a clean reply needs no clamps at all', () => {
    const { applied } = clampAnalysis(valid());
    expect(applied).toEqual([]);
  });
});
