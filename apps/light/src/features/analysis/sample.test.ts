/**
 * L-277 — the built-in sample a new user can check in one click.
 *
 * The sample is a demonstration of the free check, so it has to show what the
 * check is for: a believable partial match with real gaps, not a perfect 95
 * that teaches nothing and not a "weak" that reads as the app being broken.
 */
import { describe, expect, it } from 'vitest';
import { CvAnalysisSchema } from '@cviper/core-types';

import { SAMPLE_ADVERT_TEXT, SAMPLE_CV_TEXT, runSample } from './sample';

describe('runSample', () => {
  it('returns a result shaped exactly like a real check', () => {
    const sample = runSample();
    expect(sample).not.toBeNull();
    expect(CvAnalysisSchema.safeParse(sample?.analysis).success).toBe(true);
  });

  it('lands in the middle band, so it shows both matches and gaps', () => {
    const analysis = runSample()?.analysis;
    expect(analysis?.verdict).toBe('possible');
    expect(analysis?.matched_skills.length ?? 0).toBeGreaterThan(2);
    expect(analysis?.missing_skills).toContain('Tableau');
  });

  it('carries the keyword estimate the result screen shows', () => {
    const score = runSample()?.atsKeywordScore;
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('is the same every time — no clock, no randomness', () => {
    expect(runSample()).toEqual(runSample());
  });

  // NEGATIVE — a made-up person must not look like somebody's real details.
  it('contains no email address or phone number', () => {
    const text = `${SAMPLE_CV_TEXT}\n${SAMPLE_ADVERT_TEXT}`;
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\d{5}\s?\d{6}|\+44/);
  });
});
