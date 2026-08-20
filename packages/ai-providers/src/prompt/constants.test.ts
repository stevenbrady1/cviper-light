/**
 * PORT FIDELITY — the prompt calibration must agree with the Python original.
 *
 * ============================================================================
 * EVERY EXPECTATION BELOW WAS MEASURED BY RUNNING THE PYTHON.
 * ============================================================================
 * The values are what `backend/ai/prompts/constants.py` (CViper repo,
 * @ 2f83a377) actually holds, read by importing that module — not what a
 * reasonable person would predict it says.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * `constants.ts` had no test. It is the single most load-bearing file in the
 * scoring path and the easiest to damage without noticing, because nothing it
 * exports is executable — it is all prompt text, and prompt text that has
 * quietly drifted still runs. Without worked examples a model scores almost
 * everything 75-85, which is where "reasonable-sounding number" lives. The
 * three anchors (84 / 52 / 71) are what pull the distribution apart. Lose them
 * and CViper and CViper Light hand the same CV two different numbers, with no
 * error anywhere.
 *
 * TWO KINDS OF ASSERTION, AND THE DIFFERENCE MATTERS
 * --------------------------------------------------
 *   VERBATIM  — `JSON_ONLY` and `FAIRNESS_GUARDRAIL` are ported unchanged, so
 *               they are asserted character for character against the Python.
 *   ADAPTED   — the anchors and weights carry ONE deliberate edit each (the
 *               sub-score lists and the weighted-sum sentence are removed,
 *               because this app returns a flat schema with no sub-scores).
 *               Asserting equality there would be wrong. What is asserted
 *               instead is that the CALIBRATION survived the edit, and that
 *               the removed parts stayed removed.
 *
 * If a case here starts failing, either the port drifted or the Python moved.
 * CViper's `docs/port-parity-manifest.yaml` pins that file and its guard fires
 * there when it changes. Re-measure before changing a single expectation.
 */
import { describe, expect, it } from 'vitest';

import {
  ATS_SCORE_ANCHORS,
  FAIRNESS_GUARDRAIL,
  FIT_SCORE_ANCHORS,
  FIT_SCORE_WEIGHTS,
  JSON_ONLY,
} from './constants';

// ── Verbatim ports: character for character ─────────────────────────────

describe('constants ported verbatim', () => {
  it('JSON_ONLY is exactly what the Python holds', () => {
    expect(JSON_ONLY).toBe('Return ONLY valid JSON.');
  });

  it('FAIRNESS_GUARDRAIL is exactly what the Python holds', () => {
    // The Python value is a parenthesised implicit string concat; this is the
    // joined result, measured by importing the module rather than by reading
    // the source and joining it by eye.
    expect(FAIRNESS_GUARDRAIL).toBe(
      'FAIRNESS CONSTRAINT: Score candidates solely on skills, experience, ' +
        'qualifications, and job-relevant competencies. Do NOT consider or infer ' +
        'age, gender, ethnicity, disability, nationality, religion, marital status, ' +
        'or any other protected characteristic. Treat all candidates equally ' +
        'regardless of name, university prestige, or employment gaps.',
    );
  });

  it('the fairness guardrail still names every protected characteristic', () => {
    // Spelled out separately from the equality check above: if somebody
    // "tidies" that string, this says which part mattered.
    for (const characteristic of [
      'age',
      'gender',
      'ethnicity',
      'disability',
      'nationality',
      'religion',
      'marital status',
    ]) {
      expect(FAIRNESS_GUARDRAIL).toContain(characteristic);
    }
  });
});

// ── Adapted ports: the calibration must survive the edit ────────────────

/** The five band definitions, verbatim from the Python. */
const PYTHON_BANDS = [
  '- 90-100: Near-perfect match — candidate meets ALL essential requirements and most desirable ones, with strong seniority and industry alignment.',
  '- 75-89: Strong match — meets most essential requirements, missing 1-2 desirable skills, seniority is appropriate.',
  '- 60-74: Moderate match — meets ~60% of essentials, has transferable skills for the rest, minor seniority or industry gap.',
  '- 40-59: Weak match — significant gaps in essential requirements, or notable seniority mismatch (e.g. mid-level candidate for a director role).',
  '- Below 40: Poor match — majority of essential skills missing, severe seniority mismatch, or fundamentally different career track.',
] as const;

describe('FIT_SCORE_ANCHORS — adapted, but the calibration is intact', () => {
  it.each(PYTHON_BANDS)('carries the band definition verbatim: %s', (band) => {
    expect(FIT_SCORE_ANCHORS).toContain(band);
  });

  it('keeps all three worked examples and their scores', () => {
    // These three numbers ARE the calibration. Without them a model regresses
    // to scoring almost everything 75-85.
    expect(FIT_SCORE_ANCHORS).toContain('EXAMPLE 1 (score: 84');
    expect(FIT_SCORE_ANCHORS).toContain('EXAMPLE 2 (score: 52');
    expect(FIT_SCORE_ANCHORS).toContain('EXAMPLE 3 (score: 71');
  });

  it('keeps the rationale behind each score', () => {
    expect(FIT_SCORE_ANCHORS).toContain('Why 84:');
    expect(FIT_SCORE_ANCHORS).toContain('Why 52:');
    expect(FIT_SCORE_ANCHORS).toContain('Why 71:');
  });

  it('negative: the sub-score lists stay deleted', () => {
    // The Python ends each worked example with a literal sub-score list
    // ("Sub-scores: skills=88, experience=90, ..."), three times. This app
    // returns a flat schema with no sub-scores, and naming fields a small
    // quantised model is not asked to return invites it to emit extra keys or
    // refuse the schema outright. Restoring them would be a regression, not a
    // parity fix.
    expect(FIT_SCORE_ANCHORS).not.toContain('Sub-scores:');
    expect(FIT_SCORE_ANCHORS).not.toMatch(/skills=\d+/);
  });
});

describe('FIT_SCORE_WEIGHTS — adapted, one deliberate deletion', () => {
  it('negative: the weighted-sum sentence stays deleted', () => {
    // The Python ends with "The match_score MUST equal the weighted sum of
    // sub-scores, rounded to the nearest integer." Telling a model to sum
    // fields it is not returning is exactly what makes a small model fail.
    expect(FIT_SCORE_WEIGHTS).not.toContain('weighted sum');
  });

  it('still describes the weighting the score should reflect', () => {
    expect(FIT_SCORE_WEIGHTS.length).toBeGreaterThan(80);
  });
});

describe('ATS_SCORE_ANCHORS — verbatim', () => {
  it('is exactly what the Python holds', () => {
    // Measured: the Python value is 176 characters and this is all of them.
    // In CViper these bands anchor a separate `ats_score` integer; here the
    // flat schema has no such field, so they are reused as the severity ladder
    // behind `ats_notes[]` (see build-prompt.ts, which wraps them in an
    // explicit "do NOT output a number for it"). The TEXT is unchanged — only
    // what surrounds it differs, which is why this can be an equality check.
    expect(ATS_SCORE_ANCHORS).toBe(
      'Score anchors: 90+ = strong keyword overlap, quantified bullets, perfect structure. ' +
        '60-70 = moderate gaps, some missing keywords. Below 50 = major structural or keyword issues.',
    );
  });

  it('keeps all three severity bands', () => {
    expect(ATS_SCORE_ANCHORS).toContain('90+');
    expect(ATS_SCORE_ANCHORS).toContain('60-70');
    expect(ATS_SCORE_ANCHORS).toContain('Below 50');
  });
});

// ── The guard against a hollowed-out file ───────────────────────────────

describe('nothing here is empty', () => {
  it.each([
    ['JSON_ONLY', JSON_ONLY],
    ['FAIRNESS_GUARDRAIL', FAIRNESS_GUARDRAIL],
    ['FIT_SCORE_ANCHORS', FIT_SCORE_ANCHORS],
    ['FIT_SCORE_WEIGHTS', FIT_SCORE_WEIGHTS],
    ['ATS_SCORE_ANCHORS', ATS_SCORE_ANCHORS],
  ])('%s is a non-empty string', (_name, value) => {
    expect(typeof value).toBe('string');
    expect(value.trim().length).toBeGreaterThan(0);
  });
});
