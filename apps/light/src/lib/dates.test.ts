import { describe, expect, it } from 'vitest';

import { daysBetweenDates, daysSinceTimestamp, toLocalIsoDate, todayIsoDate } from './dates';

describe('toLocalIsoDate — the user’s calendar day, not UTC’s', () => {
  it('formats a date as YYYY-MM-DD', () => {
    // Built from local parts, so this is the local calendar day whatever the
    // machine's timezone is.
    expect(toLocalIsoDate(new Date(2026, 7, 19, 12, 0, 0))).toBe('2026-08-19');
  });

  it('zero-pads single-digit months and days', () => {
    // Fixed width is not cosmetic: `YYYY-MM-DD` sorts correctly as a plain
    // string, which is what the `next_action_date` index in the database
    // depends on.
    expect(toLocalIsoDate(new Date(2026, 0, 5, 9, 30))).toBe('2026-01-05');
  });

  it('boundary: the first and last instant of a local day are the same date', () => {
    expect(toLocalIsoDate(new Date(2026, 7, 19, 0, 0, 0, 0))).toBe('2026-08-19');
    expect(toLocalIsoDate(new Date(2026, 7, 19, 23, 59, 59, 999))).toBe('2026-08-19');
  });

  it('negative: an unreadable date is null rather than "NaN-NaN-NaN"', () => {
    expect(toLocalIsoDate(new Date('not a date'))).toBeNull();
  });
});

describe('todayIsoDate', () => {
  it('takes the clock it is given, so callers can be deterministic', () => {
    expect(todayIsoDate(new Date(2026, 1, 28, 8, 0))).toBe('2026-02-28');
  });

  it('returns a well-formed date when given no clock at all', () => {
    expect(todayIsoDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('daysBetweenDates', () => {
  it('counts whole calendar days forward', () => {
    expect(daysBetweenDates('2026-08-19', '2026-08-26')).toBe(7);
  });

  it('counts backwards as a negative number', () => {
    expect(daysBetweenDates('2026-08-26', '2026-08-19')).toBe(-7);
  });

  it('boundary: the same day is zero', () => {
    expect(daysBetweenDates('2026-08-19', '2026-08-19')).toBe(0);
  });

  it('crosses a month and a year end', () => {
    expect(daysBetweenDates('2026-01-31', '2026-02-01')).toBe(1);
    expect(daysBetweenDates('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('counts a leap day', () => {
    expect(daysBetweenDates('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('edge: a clock change does not make a day 23 or 25 hours long', () => {
    // THE reason both dates are parsed as UTC midnight rather than local
    // midnight. In London, 2026-03-29 is a 23-hour day and 2026-10-25 is a
    // 25-hour one; dividing a local millisecond difference by 86,400,000 gives
    // 0.958 and 1.042, and `Math.floor` turns the spring one into ZERO DAYS.
    // A card would silently stop ageing for a day, once or twice a year, on
    // exactly the machines nobody tests on.
    expect(daysBetweenDates('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetweenDates('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('negative: an unparseable date is null, never a wrong number', () => {
    expect(daysBetweenDates('yesterday', '2026-08-19')).toBeNull();
    expect(daysBetweenDates('2026-08-19', '')).toBeNull();
    expect(daysBetweenDates('2026-13-45', '2026-08-19')).toBeNull();
  });
});

describe('daysSinceTimestamp — how long a card has sat still', () => {
  const now = new Date(2026, 7, 19, 9, 0, 0);

  it('reports zero for something touched earlier today', () => {
    expect(daysSinceTimestamp('2026-08-19T01:00:00.000Z', now)).toBe(0);
  });

  it('counts calendar days, not 24-hour periods', () => {
    // Touched at 23:00 last night and looked at at 09:00 today is ONE day, the
    // way a person counts it, even though only ten hours have passed.
    expect(daysSinceTimestamp('2026-08-18T22:00:00.000Z', now)).toBe(1);
  });

  it('counts a long silence', () => {
    expect(daysSinceTimestamp('2026-07-05T09:00:00.000Z', now)).toBe(45);
  });

  it('boundary: a timestamp in the future is zero, not a negative age', () => {
    // Clock skew, or a backup written on a machine set to tomorrow. Nothing has
    // gone stale in negative time.
    expect(daysSinceTimestamp('2026-08-25T09:00:00.000Z', now)).toBe(0);
  });

  it('negative: an unreadable timestamp is null, so the UI can stay quiet', () => {
    expect(daysSinceTimestamp('not a timestamp', now)).toBeNull();
    expect(daysSinceTimestamp('', now)).toBeNull();
  });
});
