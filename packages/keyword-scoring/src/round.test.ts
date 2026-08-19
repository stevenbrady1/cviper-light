/**
 * Python's `round()` and JavaScript's `Math.round()` are DIFFERENT FUNCTIONS,
 * and the scorer calls it four times on values that land on .5 in ordinary
 * use — a coverage of exactly 0.5 puts the missing penalty on 7.5.
 *
 * Python rounds half to EVEN (banker's rounding): round(7.5) == 8,
 * round(8.5) == 8, round(0.5) == 0.
 * JavaScript rounds half UP:                       Math.round(8.5) === 9.
 *
 * Left alone that is a one-point disagreement between CViper and CViper Light
 * on the same CV, appearing only on certain inputs — the kind of bug that gets
 * dismissed as a rounding quirk for a year.
 */
import { describe, expect, it } from 'vitest';
import { pythonRound } from './round';

describe('pythonRound', () => {
  it.each([
    [0.5, 0],
    [1.5, 2],
    [2.5, 2],
    [7.5, 8],
    [8.5, 8],
    [9.5, 10],
    [-0.5, 0], // Python returns the int 0, not a negative zero
    [-1.5, -2],
    [-2.5, -2],
  ])('rounds %d half-to-even, giving %d', (input, expected) => {
    expect(pythonRound(input)).toBe(expected);
  });

  it.each([
    [0.4, 0],
    [0.6, 1],
    [4.2857, 4],
    [10.714, 11],
    [43.75, 44],
    [26.25, 26],
    [94.999, 95],
  ])('rounds the non-half value %d to %d', (input, expected) => {
    expect(pythonRound(input)).toBe(expected);
  });

  it('differs from Math.round exactly where Python does', () => {
    expect(pythonRound(8.5)).not.toBe(Math.round(8.5));
    expect(pythonRound(2.5)).not.toBe(Math.round(2.5));
    expect(pythonRound(7.5)).toBe(Math.round(7.5));
  });

  // BOUNDARY
  it.each([0, -0, 100, 1e15])('passes the whole number %d through', (input) => {
    expect(pythonRound(input)).toBe(input);
  });

  // NEGATIVE — a NaN must not become a plausible-looking score.
  it('propagates NaN rather than inventing a number', () => {
    expect(Number.isNaN(pythonRound(Number.NaN))).toBe(true);
  });
});
