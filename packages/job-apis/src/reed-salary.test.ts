/**
 * The ported bug, as a test suite.
 *
 * Reed sends bare numbers. Everything here is about NOT losing the unit.
 */
import { describe, expect, it } from 'vitest';

import { DAY_RATE_CEILING, classifyReedSalaryPeriod } from './reed-salary';

describe('classifyReedSalaryPeriod — happy paths', () => {
  it('REGRESSION: a 457-550 advert is a DAY rate, not a dreadful annual salary', () => {
    // This is the bug. The original formatter turned the period into prose
    // ("£457 - £550 per day"), downstream normalisation lost the prose, read
    // 457 as an annual salary, and its "looks-like-thousands" guard inflated it
    // to £457k. The period is data now, so there is nothing to re-parse.
    expect(classifyReedSalaryPeriod(457, 550)).toBe('day');
  });

  it('a normal London salary band is annual', () => {
    expect(classifyReedSalaryPeriod(65_000, 85_000)).toBe('year');
  });

  it('reads only the larger of the two figures, as the source does', () => {
    // magnitude = max(min ?? 0, max ?? 0) — a low minimum next to an annual
    // maximum is still an annual advert.
    expect(classifyReedSalaryPeriod(500, 90_000)).toBe('year');
  });

  it('classifies from a minimum alone when there is no maximum', () => {
    expect(classifyReedSalaryPeriod(600, null)).toBe('day');
    expect(classifyReedSalaryPeriod(60_000, null)).toBe('year');
  });

  it('classifies from a maximum alone when there is no minimum', () => {
    expect(classifyReedSalaryPeriod(null, 750)).toBe('day');
  });
});

describe('classifyReedSalaryPeriod — boundaries', () => {
  it('the ceiling itself is annual and one below it is a day rate', () => {
    // The source is `magnitude < _DAY_RATE_CEILING`, so 2000 is NOT a day rate.
    expect(DAY_RATE_CEILING).toBe(2000);
    expect(classifyReedSalaryPeriod(0, DAY_RATE_CEILING - 1)).toBe('day');
    expect(classifyReedSalaryPeriod(0, DAY_RATE_CEILING)).toBe('year');
    expect(classifyReedSalaryPeriod(0, DAY_RATE_CEILING + 1)).toBe('year');
  });

  it('a magnitude of zero claims nothing — there are no figures to qualify', () => {
    expect(classifyReedSalaryPeriod(0, 0)).toBeNull();
  });

  it('a negative figure claims nothing rather than guessing', () => {
    expect(classifyReedSalaryPeriod(-100, -50)).toBeNull();
  });
});

describe('classifyReedSalaryPeriod — negative cases', () => {
  it('claims nothing when both figures are absent', () => {
    expect(classifyReedSalaryPeriod(null, null)).toBeNull();
    expect(classifyReedSalaryPeriod(undefined, undefined)).toBeNull();
  });

  it('claims nothing for values that are not finite numbers', () => {
    // Mirrors the source's `except (TypeError, ValueError): pass` — a figure it
    // cannot read leaves the unit unset rather than defaulting to annual.
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(classifyReedSalaryPeriod(bad, bad)).toBeNull();
    }
  });

  it('survives a provider sending a string, and never throws', () => {
    // Reed is a third-party feed. `"457"` is a number in disguise; `"lots"` is
    // not a number at all and must not become one.
    expect(classifyReedSalaryPeriod('457' as unknown as number, null)).toBe('day');
    expect(classifyReedSalaryPeriod('lots' as unknown as number, null)).toBeNull();
    expect(classifyReedSalaryPeriod({} as unknown as number, [] as unknown as number)).toBeNull();
  });
});
