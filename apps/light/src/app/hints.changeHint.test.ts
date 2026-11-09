/**
 * L-344: the hint on ▲ / ▼ beside an ATS score. A move of one point is the
 * smallest change there is, so it is a common one. Exact matches on purpose:
 * "1 points" contains "1 point", so `toContain` could not fail.
 */
import { describe, expect, it } from 'vitest';

import { changeHint } from './hints';

describe('changeHint — the count of points (L-344)', () => {
  it('boundary: up one says "1 point"', () => {
    expect(changeHint(1)).toBe('Up 1 point on your original CV: better.');
  });

  it('boundary: down one says "1 point"', () => {
    expect(changeHint(-1)).toBe('Down 1 point on your original CV: worse.');
  });

  it.each([1, -1])('negative: %i never says "1 points"', (value) => {
    expect(changeHint(value)).not.toMatch(/\b1 points\b/);
  });

  it('two points either way stay plural', () => {
    expect(changeHint(2)).toBe('Up 2 points on your original CV: better.');
    expect(changeHint(-2)).toBe('Down 2 points on your original CV: worse.');
  });
});
