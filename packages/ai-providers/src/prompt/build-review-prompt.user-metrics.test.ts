/**
 * L-205 (review C4): the reviewer must not call the user's own approved
 * figures "unsupported claims".
 */
import { describe, expect, it } from 'vitest';

import { buildReviewPrompt } from './build-review-prompt';
import { untagged } from '../test/fence-tags';

const base = { draftText: 'draft', jobText: 'job', cvText: 'cv', kind: 'cv' as const };

describe('buildReviewPrompt with user-supplied metrics (L-205)', () => {
  it('happy: the section is present and item 4 accepts it as a source for numbers', () => {
    const { user } = buildReviewPrompt({
      ...base,
      userMetrics: [{ skill: 'dbt', text: 'Migrated 40 models' }],
    });
    expect(user).toContain('=== CANDIDATE-SUPPLIED ACHIEVEMENTS');
    expect(user).toContain('- [dbt] Migrated 40 models');
    expect(user).toContain(
      'that the ORIGINAL CV does not contain (a number exactly as given in the CANDIDATE-SUPPLIED ACHIEVEMENTS section is supported)',
    );
  });

  it.each([undefined, null, []])('negative: %j leaves the prompt unchanged', (value) => {
    const { user } = buildReviewPrompt({ ...base, userMetrics: value });
    expect(user).not.toContain('CANDIDATE-SUPPLIED');
    expect(untagged(user)).toBe(untagged(buildReviewPrompt(base).user));
  });
});
